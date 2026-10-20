/**
 * Nocturna Pizza — backend completo en un solo archivo.
 *
 * Qué hace:
 *   - Sirve el frontend estático que vive en public/.
 *   - Expone la API en /api/* contra Supabase Postgres (cliente pg).
 *   - Maneja el login con Google vía Supabase Auth (verifica el JWT de Supabase).
 *   - Da acceso al panel solo a los emails de ADMIN_EMAILS.
 *   - Expone un asistente que usa la API de OpenAI.
 *
 * Modos:
 *   node server.js            -> arranca el servidor
 *   node server.js migrate    -> crea/actualiza el esquema (idempotente)
 *   node server.js seed       -> carga categorías y pizzas del menú
 *
 * Dependencias: pg, dotenv, zod. El resto es Node nativo (node:http, fetch).
 */

import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

// ============================================================
// 1. Configuración
// ============================================================

const IS_PROD = process.env.NODE_ENV === 'production';

// Defaults solo para desarrollo: en producción, si falta algo, se avisa fuerte.
const DEV_DEFAULTS = IS_PROD
  ? {}
  : {
      PORT: '3000',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nocturna',
      DATABASE_MIGRATION_URL: 'postgresql://postgres:postgres@localhost:5432/nocturna',
      ADMIN_WHATSAPP: '5491128493108',
      PUBLIC_SITE_URL: 'http://localhost:3000',
      ADMIN_EMAILS: '',
    };

for (const [key, value] of Object.entries(DEV_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

const splitList = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '',
  PUBLIC_SITE_URL: (process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  ADMIN_WHATSAPP: process.env.ADMIN_WHATSAPP ?? '5491128493108',
  ADMIN_EMAILS: splitList(process.env.ADMIN_EMAILS),
  SUPABASE_URL: (process.env.SUPABASE_URL ?? '').replace(/\/$/, ''),
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};

if (!env.DATABASE_URL) {
  console.error('[config] Falta DATABASE_URL. Copiá .env.example a .env y completalo.');
  process.exit(1);
}

const supabaseAuthReady = () => Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
const openaiReady = () => Boolean(env.OPENAI_API_KEY);

// ============================================================
// 2. Base de datos
// ============================================================

const isLocalDb = /(^|\/\/)(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL);
const ssl = isLocalDb ? undefined : { rejectUnauthorized: false };

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 15_000,
  ssl,
});

pool.on('error', (error) => {
  console.error('[db] error en cliente ocioso:', error.message);
});

/** Ejecuta `fn` con un cliente dedicado dentro de una transacción. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] rollback falló:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Pool propio para migraciones (usa la conexión de sesión, no la de transacción). */
async function withMigrationClient(fn) {
  const client = new pg.Client({
    connectionString: env.DATABASE_MIGRATION_URL,
    ssl: /(^|\/\/)(localhost|127\.0\.0\.1)/.test(env.DATABASE_MIGRATION_URL)
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ============================================================
// 3. Errores
// ============================================================

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'validation_error', message, details);
const unauthorized = (message = 'Necesitás iniciar sesión.') =>
  new HttpError(401, 'unauthorized', message);
const forbidden = (message = 'No tenés permiso para esta acción.') =>
  new HttpError(403, 'forbidden', message);
const notFound = (message = 'No encontramos lo que buscás.') =>
  new HttpError(404, 'not_found', message);
const conflict = (code, message) => new HttpError(409, code, message);

const SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const PG_CODES = new Set([
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
]);

function isDatabaseError(error) {
  if (!error) return false;
  const codes = new Set();
  const walk = (node) => {
    if (!node) return;
    if (typeof node.code === 'string') codes.add(node.code);
    for (const nested of [node.errors, node.aggregateErrors, node.cause]) {
      if (Array.isArray(nested)) nested.forEach(walk);
      else if (nested && nested !== node) walk(nested);
    }
  };
  walk(error);
  if (codes.size === 0) return false;
  return [...codes].every((code) => SOCKET_CODES.has(code) || PG_CODES.has(code));
}

/** Convierte los errores de Zod en un 400 con el mismo formato que el frontend espera. */
function parseWith(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw badRequest(
    'Revisá los datos enviados.',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

// ============================================================
// 4. Reglas del Pase Nocturno (fuente única)
// ============================================================

const RULES = {
  welcomePoints: 20,
  pointsPerPeso: 1000,
  birthdayWindowBefore: 3,
  birthdayWindowAfter: 3,
};

const BENEFITS = [
  {
    key: 'welcome',
    threshold: 0,
    label: '10% OFF en tu primer pedido',
    description: 'Se aplica solo la primera vez, y no consume puntos.',
  },
  {
    key: 'drink',
    threshold: 50,
    label: 'Fainá o bebida a elección',
    description: 'Te lo agregamos al pedido que elijas.',
  },
  {
    key: 'margherita',
    threshold: 100,
    label: 'Margherita gratis',
    description: 'Canjeás los 100 puntos por una pizza.',
  },
  {
    key: 'birthday',
    threshold: null,
    label: 'Postre de la casa sin cargo',
    description: 'Válido durante la semana de tu cumpleaños.',
  },
];

const benefitsByKey = new Map(BENEFITS.map((benefit) => [benefit.key, benefit]));

const pointsForOrder = (totalAmount) => {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 0;
  return Math.floor(totalAmount / RULES.pointsPerPeso);
};

function nextBenefit(points) {
  return (
    BENEFITS.find(
      (benefit) => benefit.threshold !== null && points < benefit.threshold,
    ) ?? null
  );
}

function pointsToNextBenefit(points) {
  const next = nextBenefit(points);
  return next ? Math.max(0, next.threshold - points) : 0;
}

function progressToNextBenefit(points) {
  const next = nextBenefit(points);
  if (!next) return 1;
  const previous = [...BENEFITS]
    .filter((benefit) => benefit.threshold !== null && benefit.threshold < next.threshold)
    .at(-1);
  const from = previous?.threshold ?? 0;
  const span = next.threshold - from;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - from) / span));
}

function isBirthdayWindow(birthday, reference = new Date()) {
  if (!birthday) return false;
  const date = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );

  for (let day = -RULES.birthdayWindowBefore; day <= RULES.birthdayWindowAfter; day += 1) {
    const candidate = new Date(today);
    candidate.setUTCDate(candidate.getUTCDate() + day);
    if (
      candidate.getUTCMonth() === date.getUTCMonth() &&
      candidate.getUTCDate() === date.getUTCDate()
    ) {
      return true;
    }
  }
  return false;
}

function daysUntilBirthday(birthday, reference = new Date()) {
  if (!birthday) return null;
  const date = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );
  let next = new Date(Date.UTC(today.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (next < today) {
    next = new Date(Date.UTC(today.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate()));
  }
  return Math.round((next - today) / 86400000);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(prefix) {
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}${suffix}`;
}

const generateMemberCode = () => randomCode('#SOCIO-');
const generateOrderCode = () => randomCode('NP-');
const memberCodeLabel = (memberCode) => String(memberCode ?? '').replace('#', '');

function normalizePhone(input) {
  const raw = String(input ?? '').replace(/\D/g, '');
  if (!raw) return null;
  const local = raw.startsWith('0') ? raw.slice(1) : raw;
  const rest = local.startsWith('54') ? local.slice(2) : local;
  return rest.startsWith('9') ? `54${rest}` : `549${rest}`;
}

const formatPrice = (value) => `$${new Intl.NumberFormat('es-AR').format(value)}`;

function formatBirthdayEs(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
}

// ============================================================
// 5. WhatsApp
// ============================================================

const METHOD_LABELS = {
  pickup: 'Retiro en el local',
  delivery: 'Entrega a domicilio',
};

function buildOrderMessage({ order, customer, items, member = null }) {
  const lines = [`Hola Nocturna Pizza, soy ${customer.name}.`, `Pedido: ${order.orderCode}`, ''];
  for (const item of items) {
    lines.push(`• ${item.quantity}x ${item.name} — ${formatPrice(item.unitPrice)} c/u`);
  }
  lines.push('', `Total: ${formatPrice(order.totalAmount)}`);
  lines.push(`Modalidad: ${METHOD_LABELS[order.fulfillmentType] ?? order.fulfillmentType}`);
  if (order.fulfillmentType === 'delivery' && order.address) lines.push(`Dirección: ${order.address}`);
  if (customer.phone) lines.push(`Contacto: ${customer.phone}`);
  if (order.notes) lines.push(`Detalle: ${order.notes}`);
  if (member) lines.push('', `Pase Nocturno: ${memberCodeLabel(member.member_code)}`);
  lines.push('', `Ref. ${order.orderCode}`);
  return lines.join('\n');
}

const buildWhatsappUrl = (phone, message) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

// ============================================================
// 6. Validación (Zod)
// ============================================================

const argPhone = /^[0-9+\-\s()]{8,20}$/;
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'Fecha inválida.');

const orderSchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(2, 'Falta el nombre.').max(120),
      phone: z.string().trim().min(8).max(20).regex(argPhone, 'Teléfono inválido.'),
      email: z.string().trim().email().max(160).optional().or(z.literal('')),
      notes: z.string().trim().max(500).optional(),
    }),
    fulfillmentType: z.enum(['pickup', 'delivery'], { message: 'Modalidad inválida.' }),
    address: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          pizzaId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().min(1).max(50),
        }),
      )
      .min(1, 'El pedido está vacío.')
      .max(30),
    memberCode: z.string().trim().max(24).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillmentType === 'delivery' && !value.address) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'Falta la dirección.' });
    }
  });

const messageSchema = z.object({
  name: z.string().trim().min(2, 'Falta el nombre.').max(120),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  subject: z.string().trim().max(160).optional().or(z.literal('')),
  message: z.string().trim().min(5, 'Contanos un poco más.').max(2000),
});

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Escribí tu nombre.').max(120).optional(),
  phone: z.string().trim().min(8, 'Necesitamos un WhatsApp válido.').max(25).optional().or(z.literal('')),
  birthday: dateOnly.optional().or(z.literal('')),
});

const redeemSchema = z.object({
  benefit: z.enum(['welcome', 'drink', 'margherita', 'birthday'], {
    message: 'Beneficio desconocido.',
  }),
  notes: z.string().trim().max(300).optional(),
});

const adjustPointsSchema = z.object({
  points: z.coerce.number().int().min(0).max(1_000_000),
  note: z.string().trim().min(3, 'Contanos el motivo.').max(300),
});

const memberListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  minPoints: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['points', 'newest', 'birthday']).default('points'),
});

const assistantSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1500),
      }),
    )
    .min(1)
    .max(20),
});

// ============================================================
// 7. Repositorios
// ============================================================

// --- Catálogo -------------------------------------------------

async function listCategories({ onlyActive = true } = {}) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, sort_order AS "sortOrder"
       FROM categories
      WHERE ($1::boolean IS FALSE OR is_active)
      ORDER BY sort_order ASC, name ASC`,
    [onlyActive],
  );
  return rows;
}

async function findCategoryBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, sort_order AS "sortOrder" FROM categories WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

const SELECT_PIZZA = `
  SELECT p.id, p.slug, p.name, p.description, p.price,
         p.image_url   AS "imageUrl",
         p.ingredients,
         p.is_available AS "isAvailable",
         p.is_featured  AS "isFeatured",
         p.sort_order   AS "sortOrder",
         c.slug          AS category,
         c.name          AS "categoryName"
    FROM pizzas p
    JOIN categories c ON c.id = p.category_id`;

async function listPizzas(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.category) {
    params.push(filters.category);
    conditions.push(`c.slug = $${params.length}`);
  }
  if (typeof filters.featured === 'boolean') {
    params.push(filters.featured);
    conditions.push(`p.is_featured = $${params.length}`);
  }
  if (typeof filters.available === 'boolean') {
    params.push(filters.available);
    conditions.push(`p.is_available = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `${SELECT_PIZZA} ${where} ORDER BY p.sort_order ASC, p.name ASC`,
    params,
  );
  return rows;
}

async function findPizzaBySlug(slug) {
  const { rows } = await pool.query(`${SELECT_PIZZA} WHERE p.slug = $1`, [slug]);
  return rows[0] ?? null;
}

async function getPizzasByIds(ids, client) {
  if (!ids.length) return [];
  const runner = client ?? pool;
  const { rows } = await runner.query(
    `SELECT id, name, price FROM pizzas WHERE id = ANY($1::int[])`,
    [ids],
  );
  return rows;
}

// --- Pedidos --------------------------------------------------

async function createOrder({ customer, items, fulfillmentType, address, notes, memberCode, authMember = null }) {
  return withTransaction(async (client) => {
    const pizzaIds = [...new Set(items.map((item) => item.pizzaId))];
    const pizzas = await getPizzasByIds(pizzaIds, client);
    const byId = new Map(pizzas.map((pizza) => [pizza.id, pizza]));

    const faltantes = pizzaIds.filter((id) => !byId.has(id));
    if (faltantes.length) {
      throw new HttpError(422, 'pizza_unavailable', `Pizzas no disponibles: ${faltantes.join(', ')}`);
    }

    const orderItems = items.map((item) => {
      const pizza = byId.get(item.pizzaId);
      return {
        pizzaId: pizza.id,
        name: pizza.name,
        unitPrice: pizza.price,
        quantity: item.quantity,
        subtotal: pizza.price * item.quantity,
      };
    });

    const totalAmount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);

    const customerResult = await client.query(
      `INSERT INTO customers (name, phone, email, notes, source)
       VALUES ($1, $2, $3, $4, 'whatsapp') RETURNING id`,
      [customer.name, customer.phone, customer.email || null, customer.notes || null],
    );

    // El socio logueado tiene prioridad; si no, se busca por código. Un código
    // desconocido nunca rompe el pedido.
    let memberId = authMember?.id ?? null;
    if (!memberId && memberCode) {
      const found = await client.query(
        `SELECT id FROM members WHERE member_code = $1 AND is_active = TRUE`,
        [String(memberCode).trim().toUpperCase()],
      );
      memberId = found.rows[0]?.id ?? null;
    }

    let order = null;
    for (let attempt = 0; attempt < 3 && !order; attempt += 1) {
      try {
        const result = await client.query(
          `INSERT INTO orders (order_code, customer_id, member_id, status, fulfillment_type, address, notes, total_amount)
           VALUES ($1, $2, $3, 'new', $4, $5, $6, $7)
           RETURNING id, order_code, fulfillment_type, address, notes, total_amount, created_at`,
          [
            generateOrderCode(),
            customerResult.rows[0].id,
            memberId,
            fulfillmentType,
            address || null,
            notes || null,
            totalAmount,
          ],
        );
        order = result.rows[0];
      } catch (error) {
        if (error.code !== '23505' || attempt === 2) throw error;
      }
    }

    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, pizza_id, name_snapshot, unit_price, quantity, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.pizzaId, item.name, item.unitPrice, item.quantity, item.subtotal],
      );
    }

    const memberResult = memberId
      ? await client.query(`SELECT member_code, points FROM members WHERE id = $1`, [memberId])
      : { rows: [] };
    const member = memberResult.rows[0];

    const message = buildOrderMessage({
      order: {
        orderCode: order.order_code,
        totalAmount: order.total_amount,
        fulfillmentType: order.fulfillment_type,
        address: order.address,
        notes: order.notes,
      },
      customer,
      items: orderItems,
      member,
    });

    return {
      order: {
        orderCode: order.order_code,
        status: 'new',
        totalAmount: order.total_amount,
        createdAt: order.created_at,
      },
      member: member
        ? { memberCode: memberCodeLabel(member.member_code), points: member.points }
        : null,
      whatsappUrl: buildWhatsappUrl(env.ADMIN_WHATSAPP, message),
      message,
    };
  });
}

async function getPublicOrderStatus(orderCode) {
  const { rows } = await pool.query(
    `SELECT order_code, status, created_at FROM orders WHERE order_code = $1`,
    [orderCode],
  );
  const row = rows[0];
  if (!row) return null;
  return { orderCode: row.order_code, status: row.status, createdAt: row.created_at };
}

// --- Pedidos (panel) ------------------------------------------

const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

async function listOrdersAdmin({ status, from, to, page = 1, perPage = 25 } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`o.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`o.created_at < ($${params.length}::date + interval '1 day')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * perPage;

  const countResult = await pool.query(`SELECT count(*)::int AS total FROM orders o ${where}`, params);
  const dataResult = await pool.query(
    `SELECT o.id, o.order_code AS "orderCode", o.status,
            o.fulfillment_type AS "fulfillmentType", o.address, o.notes,
            o.total_amount AS "totalAmount", o.created_at AS "createdAt",
            o.updated_at AS "updatedAt",
            c.name AS "customerName", c.phone AS "customerPhone",
            m.member_code AS "memberCode", m.name AS "memberName",
            COALESCE(sum(i.quantity), 0)::int AS "itemCount"
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_items i ON i.order_id = o.id
       LEFT JOIN members m ON m.id = o.member_id
       ${where}
      GROUP BY o.id, c.name, c.phone, m.member_code, m.name
      ORDER BY o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset],
  );

  return { orders: dataResult.rows, total: countResult.rows[0].total, page, perPage };
}

async function getOrderAdmin(id) {
  const orderResult = await pool.query(
    `SELECT o.id, o.order_code AS "orderCode", o.status,
            o.fulfillment_type AS "fulfillmentType", o.address, o.notes,
            o.total_amount AS "totalAmount", o.created_at AS "createdAt",
            o.updated_at AS "updatedAt",
            c.name AS "customerName", c.phone AS "customerPhone", c.email AS "customerEmail",
            m.member_code AS "memberCode", m.name AS "memberName", m.points AS "memberPoints"
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN members m ON m.id = o.member_id
      WHERE o.id = $1`,
    [id],
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT id, name_snapshot AS "name", unit_price AS "unitPrice", quantity, subtotal
       FROM order_items WHERE order_id = $1 ORDER BY id`,
    [id],
  );
  return { ...order, items: itemsResult.rows };
}

async function updateOrderStatus(id, status) {
  return withTransaction(async (client) => {
    const before = await client.query(
      `SELECT id, member_id AS "memberId", total_amount AS "totalAmount", status
         FROM orders WHERE id = $1`,
      [id],
    );
    const order = before.rows[0];
    if (!order) return null;

    const { rows } = await client.query(
      `UPDATE orders SET status = $1, updated_at = now()
        WHERE id = $2
        RETURNING id, order_code AS "orderCode", status, member_id AS "memberId",
                  updated_at AS "updatedAt"`,
      [status, id],
    );
    const updated = rows[0];

    if (!order.memberId) return updated;

    const wasDelivered = order.status === 'delivered';
    const isDelivered = status === 'delivered';

    if (isDelivered && !wasDelivered) {
      const points = pointsForOrder(order.totalAmount);
      if (points > 0) {
        const existing = await client.query(
          `SELECT id FROM loyalty_events WHERE member_id = $1 AND order_id = $2 AND kind = 'purchase'`,
          [order.memberId, order.id],
        );
        if (!existing.rows.length) {
          await client.query(
            `INSERT INTO loyalty_events (member_id, order_id, kind, points_delta, note)
             VALUES ($1, $2, 'purchase', $3, $4)`,
            [order.memberId, order.id, points, `Pedido ${updated.orderCode}`],
          );
          await client.query(`UPDATE members SET points = points + $1 WHERE id = $2`, [
            points,
            order.memberId,
          ]);
        }
      }
    } else if (!isDelivered && wasDelivered) {
      const deleted = await client.query(
        `DELETE FROM loyalty_events
          WHERE member_id = $1 AND order_id = $2 AND kind = 'purchase'
          RETURNING points_delta`,
        [order.memberId, order.id],
      );
      const reverted = deleted.rows.reduce((sum, row) => sum + row.points_delta, 0);
      if (reverted !== 0) {
        const current = await client.query(`SELECT points FROM members WHERE id = $1`, [order.memberId]);
        const saldo = Math.max(0, (current.rows[0]?.points ?? 0) - reverted);
        await client.query(`UPDATE members SET points = $1 WHERE id = $2`, [saldo, order.memberId]);
      }
    }

    return updated;
  });
}

async function orderCountsByStatus() {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS total FROM orders GROUP BY status`,
  );
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

// --- Mensajes de contacto -------------------------------------

async function createContactMessage(message) {
  const { rows } = await pool.query(
    `INSERT INTO contact_messages (name, phone, email, subject, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [
      message.name,
      message.phone || null,
      message.email || null,
      message.subject || null,
      message.message,
    ],
  );
  return rows[0];
}

async function listMessagesAdmin({ unread = false, page = 1, perPage = 25 } = {}) {
  const offset = (page - 1) * perPage;
  const where = unread ? 'WHERE is_read = FALSE' : '';
  const countResult = await pool.query(`SELECT count(*)::int AS total FROM contact_messages ${where}`);
  const dataResult = await pool.query(
    `SELECT id, name, phone, email, subject, message, is_read AS "isRead", created_at AS "createdAt"
       FROM contact_messages ${where}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [perPage, offset],
  );
  return { messages: dataResult.rows, total: countResult.rows[0].total, page, perPage };
}

async function markMessageRead(id) {
  const { rows } = await pool.query(
    `UPDATE contact_messages SET is_read = TRUE WHERE id = $1 RETURNING id, is_read AS "isRead"`,
    [id],
  );
  return rows[0] ?? null;
}

async function unreadMessageCount() {
  const { rows } = await pool.query(`SELECT count(*)::int AS total FROM contact_messages WHERE is_read = FALSE`);
  return rows[0].total;
}

// --- Socios ---------------------------------------------------

const SELECT_MEMBER = `
  SELECT m.id,
         m.member_code      AS "memberCode",
         m.name,
         m.phone,
         m.email,
         m.avatar_url       AS "avatarUrl",
         m.auth_user_id     AS "authUserId",
         m.birthday,
         m.points,
         m.welcome_redeemed AS "welcomeRedeemed",
         m.is_active        AS "isActive",
         m.created_at       AS "createdAt"
    FROM members m`;

async function findMemberById(id, client) {
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE m.id = $1`, [id]);
  return rows[0] ?? null;
}

async function findMemberByAuthId(authUserId, client) {
  if (!authUserId) return null;
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE m.auth_user_id = $1`, [authUserId]);
  return rows[0] ?? null;
}

async function findMemberByEmail(email, client) {
  if (!email) return null;
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE lower(m.email) = lower($1)`, [email]);
  return rows[0] ?? null;
}

async function findMemberByPhone(phone, client) {
  if (!phone) return null;
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE m.phone = $1`, [phone]);
  return rows[0] ?? null;
}

/**
 * Devuelve el socio de este usuario de Supabase, creándolo la primera vez.
 * Si ya existe una fila con el mismo email (por ejemplo cargada a mano),
 * la vincula en vez de duplicarla.
 */
async function resolveMemberForUser(user) {
  const existing = await findMemberByAuthId(user.id);
  if (existing) return existing;

  const email = user.email ? user.email.trim().toLowerCase() : null;
  const name = displayName(user);
  const avatar = avatarOf(user);

  if (email) {
    const byEmail = await findMemberByEmail(email);
    if (byEmail) {
      await pool.query(
        `UPDATE members SET auth_user_id = $1, avatar_url = COALESCE($2, avatar_url) WHERE id = $3`,
        [user.id, avatar, byEmail.id],
      );
      return findMemberById(byEmail.id);
    }
  }

  try {
    const member = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO members (member_code, name, email, auth_user_id, avatar_url, points)
         VALUES ($1, $2, $3, $4, $5, 0)
         RETURNING id`,
        [generateMemberCode(), name, email, user.id, avatar],
      );
      const id = rows[0].id;
      await client.query(
        `INSERT INTO loyalty_events (member_id, kind, points_delta, note)
         VALUES ($1, 'welcome', $2, $3)`,
        [id, RULES.welcomePoints, 'Puntos de bienvenida por registro'],
      );
      await client.query(`UPDATE members SET points = points + $1 WHERE id = $2`, [
        RULES.welcomePoints,
        id,
      ]);
      return { id };
    });
    const created = await findMemberById(member.id);
    return { ...created, created: true };
  } catch (error) {
    // Carrera: otro request lo creó primero.
    if (error.code === '23505') {
      const again = await findMemberByAuthId(user.id);
      if (again) return again;
    }
    throw error;
  }
}

async function updateMemberProfile(memberId, { name, phone, birthday }) {
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const sets = [];
  const params = [];

  if (name !== undefined) {
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  if (phone !== undefined) {
    params.push(normalizedPhone);
    sets.push(`phone = $${params.length}`);
  }
  if (birthday !== undefined) {
    params.push(birthday || null);
    sets.push(`birthday = $${params.length}`);
  }

  if (!sets.length) return findMemberById(memberId);

  params.push(memberId);
  try {
    await pool.query(
      `UPDATE members SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
      params,
    );
  } catch (error) {
    if (error.code === '23505') {
      throw conflict('phone_taken', 'Ese WhatsApp ya está asociado a otro pase.');
    }
    throw error;
  }
  return findMemberById(memberId);
}

async function addPoints({ memberId, delta, kind, note, orderId = null, createdBy = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE members SET points = points + $1 WHERE id = $2 RETURNING id, points`,
      [delta, memberId],
    );
    if (!rows[0]) throw notFound('Socio inexistente.');

    await client.query(
      `INSERT INTO loyalty_events (member_id, order_id, kind, points_delta, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, orderId, kind, delta, note ?? null, createdBy],
    );
    return rows[0].points;
  });
}

async function markWelcomeRedeemed(memberId) {
  const { rows } = await pool.query(
    `UPDATE members SET welcome_redeemed = TRUE
      WHERE id = $1 AND welcome_redeemed = FALSE RETURNING id`,
    [memberId],
  );
  return rows.length > 0;
}

async function recordRedemption(memberId, note, createdBy) {
  await pool.query(
    `INSERT INTO loyalty_events (member_id, kind, points_delta, note, created_by)
     VALUES ($1, 'redemption', 0, $2, $3)`,
    [memberId, note, createdBy],
  );
}

async function loadRedemptions(memberId) {
  const { rows } = await pool.query(
    `SELECT note, created_at FROM loyalty_events
      WHERE member_id = $1 AND kind = 'redemption'
      ORDER BY created_at DESC`,
    [memberId],
  );
  const byLabel = new Map(BENEFITS.map((benefit) => [benefit.label, benefit.key]));
  return rows.map((row) => ({ key: byLabel.get(row.note) ?? 'other', note: row.note }));
}

function buildPass(member) {
  const points = member.points ?? 0;
  const birthdayActive = isBirthdayWindow(member.birthday);
  const redeemed = new Set((member.redemptions ?? []).map((event) => event.key));

  const benefits = BENEFITS.map((benefit) => {
    if (benefit.key === 'birthday') {
      return {
        ...benefit,
        available: birthdayActive && !redeemed.has('birthday'),
        reason: birthdayActive
          ? redeemed.has('birthday')
            ? 'Ya usaste el postre de este año.'
            : '¡Feliz cumpleaños! Tenés postre sin cargo.'
          : member.birthday
            ? `Tu cumpleaños es el ${formatBirthdayEs(member.birthday)}.`
            : 'Agregá tu fecha de cumpleaños para recibirlo.',
        redeemed: redeemed.has('birthday'),
      };
    }

    if (benefit.key === 'welcome') {
      return {
        ...benefit,
        available: !member.welcomeRedeemed,
        reason: member.welcomeRedeemed
          ? 'Ya lo usaste en tu primer pedido.'
          : 'Se aplica en tu próximo pedido.',
        redeemed: member.welcomeRedeemed,
      };
    }

    const unlocked = points >= benefit.threshold;
    return {
      ...benefit,
      available: unlocked && !redeemed.has(benefit.key),
      redeemed: redeemed.has(benefit.key),
      reason: redeemed.has(benefit.key)
        ? 'Canjeado.'
        : unlocked
          ? 'Listo para canjear.'
          : `Te faltan ${benefit.threshold - points} pts.`,
    };
  });

  return {
    memberCode: member.memberCode,
    memberCodeLabel: memberCodeLabel(member.memberCode),
    name: member.name,
    email: member.email ?? null,
    avatarUrl: member.avatarUrl ?? null,
    phone: member.phone ?? null,
    points,
    nextBenefit: nextBenefit(points),
    pointsToNext: pointsToNextBenefit(points),
    progress: progressToNextBenefit(points),
    birthday: member.birthday,
    birthdayActive,
    daysToBirthday: daysUntilBirthday(member.birthday),
    benefits,
    createdAt: member.createdAt,
  };
}

async function listMembersAdmin({ search = '', minPoints = null, sort = 'points' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(
      `(lower(m.name) LIKE $${params.length} OR m.phone LIKE $${params.length}
        OR lower(m.member_code) LIKE $${params.length} OR lower(coalesce(m.email,'')) LIKE $${params.length})`,
    );
  }
  if (minPoints !== null && !Number.isNaN(minPoints)) {
    params.push(minPoints);
    conditions.push(`m.points >= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order =
    sort === 'newest'
      ? 'm.created_at DESC'
      : sort === 'birthday'
        ? 'm.birthday ASC NULLS LAST'
        : 'm.points DESC, m.created_at DESC';

  const { rows } = await pool.query(
    `SELECT m.id, m.member_code AS "memberCode", m.name, m.phone, m.email,
            m.avatar_url AS "avatarUrl", m.birthday, m.points,
            m.welcome_redeemed AS "welcomeRedeemed", m.is_active AS "isActive",
            m.created_at AS "createdAt",
            (SELECT count(*)::int FROM orders o WHERE o.member_id = m.id) AS "orderCount"
       FROM members m
       ${where}
      ORDER BY ${order}
      LIMIT 200`,
    params,
  );

  const { rows: totals } = await pool.query(
    `SELECT count(*)::int AS members, COALESCE(sum(points), 0)::int AS points
       FROM members WHERE is_active = TRUE`,
  );

  return { members: rows, totals: totals[0] };
}

async function memberHistory(memberId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.kind, e.points_delta AS "pointsDelta", e.note,
            e.created_at AS "createdAt", e.created_by AS "createdBy",
            o.order_code AS "orderCode"
       FROM loyalty_events e
       LEFT JOIN orders o ON o.id = e.order_id
      WHERE e.member_id = $1
      ORDER BY e.created_at DESC
      LIMIT 100`,
    [memberId],
  );
  return rows;
}

async function upcomingBirthdays({ days = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, member_code AS "memberCode", name, phone, email, birthday, points
       FROM members
      WHERE is_active = TRUE AND birthday IS NOT NULL
      ORDER BY birthday`,
  );
  const today = new Date();
  return rows
    .map((member) => ({ ...member, daysUntil: daysUntilBirthday(member.birthday, today) }))
    .filter((member) => member.daysUntil !== null && member.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

// ============================================================
// 8. Autenticación (Supabase Auth)
// ============================================================

const tokenCache = new Map();

async function verifySupabaseToken(token) {
  if (!supabaseAuthReady()) {
    throw new HttpError(503, 'auth_unconfigured', 'El login todavía no está configurado.');
  }

  const key = crypto.createHash('sha256').update(token).digest('hex');
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;

  let response;
  try {
    response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new HttpError(503, 'auth_unreachable', 'No pudimos validar tu sesión. Probá de nuevo.');
  }

  if (!response.ok) return null;

  const user = await response.json();
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(key, { user, expires: Date.now() + 60_000 });
  return user;
}

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

async function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return verifySupabaseToken(token);
}

const displayName = (user) =>
  user?.user_metadata?.full_name ||
  user?.user_metadata?.name ||
  user?.email?.split('@')[0] ||
  'Socio';

const avatarOf = (user) => user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;

const isAdminEmail = (email) =>
  Boolean(email) && env.ADMIN_EMAILS.includes(String(email).toLowerCase());

const publicUser = (user) =>
  user
    ? { id: user.id, email: user.email ?? null, name: displayName(user), avatarUrl: avatarOf(user) }
    : null;

// ============================================================
// 9. Rate limiting en memoria
// ============================================================

const buckets = new Map();

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (hits.length >= max) throw new HttpError(429, 'rate_limited', 'Demasiados intentos. Esperá un momento.');
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  'unknown';

// ============================================================
// 10. Router
// ============================================================

const routes = [];

function route(method, pattern, handler, options = {}) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/:[^/]+/g, (token) => {
      keys.push(token.slice(1));
      return '([^/]+)';
    })}/?$`,
  );
  routes.push({ method, regex, keys, handler, options });
}

function matchRoute(method, pathname) {
  for (const item of routes) {
    if (item.method !== method) continue;
    const match = item.regex.exec(pathname);
    if (!match) continue;
    const params = {};
    item.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { ...item, params };
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

async function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);

  // "/" -> index.html ; "/admin" -> admin/index.html ; "/menu" -> menu.html
  if (relative === '/') relative = '/index.html';
  else if (relative.endsWith('/')) relative += 'index.html';

  let filePath = path.join(PUBLIC_DIR, relative);

  // Sin extensión: probamos .html
  if (!path.extname(filePath)) filePath += '.html';

  // Evita salir de public/.
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: 'forbidden', message: 'Ruta inválida.' });
  }

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    return null; // deja que el caller decida el 404
  }
  if (stat.isDirectory()) return null;

  const ext = path.extname(resolved).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  };

  applySecurityHeaders(res);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(resolved)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'payload_too_large', 'El cuerpo es demasiado grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('El cuerpo no es JSON válido.');
  }
}

// ============================================================
// 11. Rutas de la API
// ============================================================

// --- Health ---------------------------------------------------

route('GET', '/api/health', async () => {
  try {
    const started = Date.now();
    await pool.query('SELECT 1');
    return { status: 'ok', db: 'up', latencyMs: Date.now() - started };
  } catch {
    throw new HttpError(503, 'database_unavailable', 'Base de datos no disponible.');
  }
});

// --- Config pública para el frontend --------------------------

route('GET', '/api/config', async () => ({
  supabaseUrl: env.SUPABASE_URL || null,
  supabaseAnonKey: env.SUPABASE_ANON_KEY || null,
  whatsappNumber: env.ADMIN_WHATSAPP,
  loyaltyRules: { welcomePoints: RULES.welcomePoints, pointsPerPeso: RULES.pointsPerPeso },
  assistantEnabled: openaiReady(),
}));

// --- Catálogo -------------------------------------------------

route('GET', '/api/categories', async () => ({ categories: await listCategories() }));

route('GET', '/api/pizzas', async ({ query }) => {
  const filters = {};
  if (query.category) filters.category = query.category;
  if (query.featured === 'true') filters.featured = true;
  if (query.featured === 'false') filters.featured = false;
  if (query.available === 'true') filters.available = true;
  if (query.available === 'false') filters.available = false;

  if (filters.category && !(await findCategoryBySlug(filters.category))) {
    throw notFound(`No existe la categoría "${filters.category}".`);
  }
  return { pizzas: await listPizzas(filters) };
});

route('GET', '/api/pizzas/:slug', async ({ params }) => {
  const pizza = await findPizzaBySlug(params.slug);
  if (!pizza) throw notFound('Esa pizza no existe.');
  return { pizza };
});

// --- Pedidos --------------------------------------------------

route(
  'POST',
  '/api/orders',
  async ({ body, user }) => {
    const parsed = parseWith(orderSchema, body);
    const authMember = user ? await resolveMemberForUser(user) : null;
    return createOrder({ ...parsed, authMember });
  },
  { rate: { max: 10, windowMs: 60_000 } },
);

route('GET', '/api/orders/:orderCode', async ({ params }) => {
  const status = await getPublicOrderStatus(params.orderCode);
  if (!status) throw notFound('No encontramos ese pedido.');
  return { order: status };
});

// --- Mensajes de contacto -------------------------------------

route(
  'POST',
  '/api/messages',
  async ({ body }) => {
    const parsed = parseWith(messageSchema, body);
    const saved = await createContactMessage(parsed);
    return { message: 'Recibido. Te respondemos a la brevedad.', id: saved.id, createdAt: saved.created_at };
  },
  { rate: { max: 10, windowMs: 60_000 } },
);

// --- Pase Nocturno --------------------------------------------

route('GET', '/api/members/me', async ({ user }) => {
  const member = await resolveMemberForUser(user);
  const redemptions = await loadRedemptions(member.id);
  return { pass: buildPass({ ...member, redemptions }), created: Boolean(member.created) };
}, { auth: true });

route('PATCH', '/api/members/me', async ({ user, body }) => {
  const member = await resolveMemberForUser(user);
  const parsed = parseWith(profileSchema, body);
  const updated = await updateMemberProfile(member.id, parsed);
  const redemptions = await loadRedemptions(updated.id);
  return { pass: buildPass({ ...updated, redemptions }) };
}, { auth: true });

route('POST', '/api/members/redeem', async ({ user, body }) => {
  const member = await resolveMemberForUser(user);
  const { benefit: key, notes } = parseWith(redeemSchema, body);
  const benefit = benefitsByKey.get(key);
  if (!benefit) throw badRequest('Ese beneficio no existe.');

  const redemptions = await loadRedemptions(member.id);
  const estado = buildPass({ ...member, redemptions }).benefits.find((item) => item.key === key);

  if (estado.redeemed) throw conflict('already_redeemed', 'Ese beneficio ya lo canjeaste.');
  if (!estado.available) throw conflict('not_available', estado.reason);

  const message = [
    'Hola Nocturna Pizza.',
    'Quiero canjear un beneficio de mi Pase Nocturno.',
    '',
    `Código: ${memberCodeLabel(member.memberCode)}`,
    `Socio: ${member.name}`,
    `Beneficio: ${benefit.label}`,
    `Puntos: ${member.points}`,
    notes ? `Detalle: ${notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    status: 'requested',
    message: 'Le escribimos al local para confirmar. Tus puntos quedan hasta que lo confirmemos.',
    whatsappUrl: buildWhatsappUrl(env.ADMIN_WHATSAPP, message),
    benefit: key,
    points: member.points,
  };
}, { auth: true, rate: { max: 10, windowMs: 3_600_000 } });

route('POST', '/api/members/request-code', async ({ user }) => {
  const member = await resolveMemberForUser(user);
  const message = [
    '¡Hola Nocturna Pizza!',
    `Soy ${member.name} y uso la web.`,
    `Mi código es ${memberCodeLabel(member.memberCode)}.`,
    '',
    'Quiero consultar por mis puntos del Pase Nocturno.',
  ].join('\n');
  return {
    whatsappUrl: buildWhatsappUrl(env.ADMIN_WHATSAPP, message),
    memberCode: memberCodeLabel(member.memberCode),
  };
}, { auth: true, rate: { max: 5, windowMs: 3_600_000 } });

// --- Asistente virtual (OpenAI) -------------------------------

async function askOpenAI(conversation, extraContext = '') {
  if (!openaiReady()) {
    throw new HttpError(503, 'assistant_unconfigured', 'El asistente todavía no está configurado.');
  }

  const pizzas = await listPizzas({ available: true });
  const menu = pizzas
    .map((pizza) => `- ${pizza.name} (${pizza.categoryName}): ${formatPrice(pizza.price)}. ${pizza.ingredients}`)
    .join('\n');

  const system = [
    'Sos el asistente virtual de Nocturna Pizza, una pizzería. Respondés en español rioplatense,',
    'cordial y breve (máximo 5 oraciones). Solo hablás de Nocturna Pizza: menú, precios,',
    'modalidades de pedido (retiro en el local o entrega a domicilio), horarios si te los dan,',
    'y el Pase Nocturno (programa de puntos). Si te preguntan algo que no sabés, ofrecé',
    'continuar por WhatsApp. Nunca inventes promociones ni precios que no estén en el menú.',
    'No pidas ni reveles datos personales de terceros.',
    '',
    'Menú disponible:',
    menu,
    '',
    `Para pedidos, el WhatsApp del local es +${env.ADMIN_WHATSAPP}.`,
    'El Pase Nocturno da 20 puntos de regalo, 1 punto por cada $1.000 gastados, y premios a los 50',
    'y 100 puntos. El ingreso al Pase es con la cuenta de Google.',
    extraContext,
  ]
    .filter(Boolean)
    .join('\n');

  const body = {
    model: env.OPENAI_MODEL,
    temperature: 0.5,
    max_tokens: 400,
    messages: [{ role: 'system', content: system }, ...conversation],
  };

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, 'assistant_unreachable', 'El asistente no está disponible ahora.');
  }

  if (!response.ok) {
    const detail = await response.text();
    console.error('[openai] error', response.status, detail.slice(0, 300));
    throw new HttpError(502, 'assistant_error', 'El asistente tuvo un problema. Probá de nuevo.');
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new HttpError(502, 'assistant_empty', 'El asistente no devolvió respuesta.');
  return reply;
}

route(
  'POST',
  '/api/assistant',
  async ({ body }) => {
    const { messages } = parseWith(assistantSchema, body);

    // Si el último mensaje trae un código de pedido, le pasamos el estado real.
    let extra = '';
    const lastUser = [...messages].reverse().find((msg) => msg.role === 'user');
    const codeMatch = lastUser?.content.match(/\bNP-[A-Z0-9]{5}\b/i);
    if (codeMatch) {
      const status = await getPublicOrderStatus(codeMatch[0].toUpperCase());
      if (status) extra = `Dato real: el pedido ${status.orderCode} está en estado "${status.status}".`;
      else extra = `Aviso: no existe un pedido con el código ${codeMatch[0].toUpperCase()}.`;
    }

    const reply = await askOpenAI(messages, extra);
    return { reply };
  },
  { rate: { max: 30, windowMs: 3_600_000 } },
);

// --- Panel: sesión --------------------------------------------

route('GET', '/api/admin/session', async ({ user }) => ({
  authenticated: Boolean(user),
  isAdmin: Boolean(user && isAdminEmail(user.email)),
  user: publicUser(user),
}));

// --- Panel: pedidos -------------------------------------------

route('GET', '/api/admin/orders', async ({ query }) => {
  const status = query.status;
  if (status && !ORDER_STATUSES.includes(status)) throw badRequest(`Estado inválido: ${status}`);
  const result = await listOrdersAdmin({
    status,
    from: query.from,
    to: query.to,
    page: query.page ? Number(query.page) : 1,
  });
  return { ...result, counts: await orderCountsByStatus() };
}, { admin: true });

route('GET', '/api/admin/orders/:id', async ({ params }) => {
  const order = await getOrderAdmin(Number(params.id));
  if (!order) throw notFound('Pedido inexistente.');
  return { order };
}, { admin: true });

route('PATCH', '/api/admin/orders/:id/status', async ({ params, body }) => {
  const { status } = parseWith(z.object({ status: z.enum(ORDER_STATUSES) }), body);
  const order = await updateOrderStatus(Number(params.id), status);
  if (!order) throw notFound('Pedido inexistente.');
  return { order };
}, { admin: true });

// --- Panel: mensajes ------------------------------------------

route('GET', '/api/admin/messages', async ({ query }) => {
  const unread = query.unread === 'true';
  const page = query.page ? Number(query.page) : 1;
  return { ...(await listMessagesAdmin({ unread, page })), unreadCount: await unreadMessageCount() };
}, { admin: true });

route('PATCH', '/api/admin/messages/:id/read', async ({ params }) => {
  const message = await markMessageRead(Number(params.id));
  if (!message) throw notFound('Mensaje inexistente.');
  return { message };
}, { admin: true });

// --- Panel: socios --------------------------------------------

route('GET', '/api/admin/members/birthdays', async () => ({
  birthdays: await upcomingBirthdays({ days: 30 }),
}), { admin: true });

route('GET', '/api/admin/members', async ({ query }) => {
  const parsed = parseWith(memberListQuerySchema, {
    search: query.search,
    minPoints: query.minPoints,
    sort: query.sort,
  });
  return listMembersAdmin(parsed);
}, { admin: true });

route('GET', '/api/admin/members/:id', async ({ params }) => {
  const member = await findMemberById(Number(params.id));
  if (!member) throw notFound('Socio inexistente.');
  const redemptions = await loadRedemptions(member.id);
  return {
    member,
    pass: buildPass({ ...member, redemptions }),
    history: await memberHistory(member.id),
  };
}, { admin: true });

route('PATCH', '/api/admin/members/:id/points', async ({ params, body, user }) => {
  const member = await findMemberById(Number(params.id));
  if (!member) throw notFound('Socio inexistente.');

  const { points, note } = parseWith(adjustPointsSchema, body);
  const delta = points - member.points;

  if (delta !== 0) {
    await addPoints({
      memberId: member.id,
      delta,
      kind: delta > 0 ? 'manual_adjust' : 'manual_revoke',
      note,
      createdBy: user.email,
    });
  }
  return { member: await findMemberById(member.id) };
}, { admin: true });

route('POST', '/api/admin/members/:id/redeem', async ({ params, body, user }) => {
  const member = await findMemberById(Number(params.id));
  if (!member) throw notFound('Socio inexistente.');

  const { benefit: key, notes } = parseWith(redeemSchema, body);
  const benefit = benefitsByKey.get(key);
  if (!benefit) throw badRequest('Ese beneficio no existe.');

  const redemptions = await loadRedemptions(member.id);
  const estado = buildPass({ ...member, redemptions }).benefits.find((item) => item.key === key);

  if (estado.redeemed) throw conflict('already_redeemed', 'Ese beneficio ya está canjeado.');
  if (!estado.available) throw conflict('not_available', estado.reason);

  if (key === 'welcome') {
    await markWelcomeRedeemed(member.id);
    await recordRedemption(member.id, benefit.label, user.email);
    return { member: await findMemberById(member.id), remainingPoints: member.points };
  }

  const pointsAfter = await addPoints({
    memberId: member.id,
    delta: -benefit.threshold,
    kind: 'redemption',
    note: benefit.label,
    createdBy: user.email,
  });
  return { member: await findMemberById(member.id), remainingPoints: pointsAfter };
}, { admin: true });

// ============================================================
// 12. Servidor HTTP
// ============================================================

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  // CORS de cortesía para desarrollo (frontend servido aparte).
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    const matched = matchRoute(req.method, pathname);

    if (matched) {
      const { handler, options, params } = matched;

      if (options.rate) {
        rateLimit(`${clientIp(req)}:${pathname}`, options.rate.max, options.rate.windowMs);
      }

      let user = null;
      if (options.auth || options.admin) {
        user = await currentUser(req);
        if (!user) throw unauthorized();
      }
      if (options.admin && !isAdminEmail(user.email)) {
        throw forbidden('Esta cuenta no tiene acceso al panel.');
      }

      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};
      const result = await handler({ req, res, params, query, body, user });
      if (res.writableEnded) return;
      return sendJson(res, 200, result ?? {});
    }

    // Archivos estáticos.
    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = await serveStatic(req, res, pathname);
      if (served) return;
      if (!pathname.startsWith('/api/')) {
        // Fallback al index para rutas del sitio.
        const fallback = await serveStatic(req, res, '/index.html');
        if (fallback) return;
      }
    }

    return sendJson(res, 404, { error: 'not_found', message: `Ruta inexistente: ${req.method} ${pathname}` });
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(res, error.status, {
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    if (isDatabaseError(error)) {
      console.error('[http] base de datos inaccesible:', error.message);
      return sendJson(res, 503, {
        error: 'database_unavailable',
        message: 'No pudimos conectar con la base. Probá en un momento.',
      });
    }

    console.error('[http] error no manejado:', error);
    return sendJson(res, 500, { error: 'internal_error', message: 'Algo falló de nuestro lado.' });
  }
});

function startServer() {
  server.listen(env.PORT, () => {
    console.log(`Nocturna Pizza escuchando en http://localhost:${env.PORT}`);
    console.log(`  Entorno:        ${env.NODE_ENV}`);
    console.log(`  Supabase Auth:  ${supabaseAuthReady() ? 'configurado' : 'FALTA (login con Google deshabilitado)'}`);
    console.log(`  OpenAI:         ${openaiReady() ? 'configurado' : 'FALTA (asistente deshabilitado)'}`);
    console.log(`  Admins:         ${env.ADMIN_EMAILS.length ? env.ADMIN_EMAILS.join(', ') : 'ninguno (revisá ADMIN_EMAILS)'}`);
  });

  const shutdown = async () => {
    console.log('\nCerrando…');
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ============================================================
// 13. Migraciones y seed
// ============================================================

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pizzas (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price        INTEGER NOT NULL CHECK (price >= 0),
  image_url    TEXT,
  ingredients  TEXT NOT NULL DEFAULT '',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pizzas_category_id_idx ON pizzas (category_id);
CREATE INDEX IF NOT EXISTS pizzas_available_order_idx ON pizzas (is_available, sort_order);

CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT,
  source     TEXT NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'contact_form')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);

CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  order_code       TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('pickup', 'delivery')),
  address          TEXT,
  notes            TEXT,
  total_amount     INTEGER NOT NULL CHECK (total_amount >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  pizza_id      INTEGER REFERENCES pizzas (id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  unit_price    INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  subtotal      INTEGER NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  subject    TEXT,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_messages_unread_idx ON contact_messages (is_read, created_at DESC);

-- --- Pase Nocturno -------------------------------------------------

CREATE TABLE IF NOT EXISTS members (
  id               SERIAL PRIMARY KEY,
  member_code      TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  phone            TEXT UNIQUE,
  email            TEXT,
  avatar_url       TEXT,
  auth_user_id     UUID,
  birthday         DATE,
  points           INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  welcome_redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Actualización de bases creadas con el esquema viejo.
ALTER TABLE members ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE members ALTER COLUMN phone DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_auth_user_id_key
  ON members (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_email_key
  ON members (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS members_points_idx ON members (points DESC);
CREATE INDEX IF NOT EXISTS members_birthday_idx ON members (birthday);

CREATE TABLE IF NOT EXISTS loyalty_events (
  id           SERIAL PRIMARY KEY,
  member_id    INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  order_id     INTEGER REFERENCES orders (id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'welcome', 'purchase', 'redemption',
                 'birthday', 'manual_adjust', 'manual_revoke'
               )),
  points_delta INTEGER NOT NULL,
  note         TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- En bases viejas, created_by era FK a staff (INTEGER): la pasamos a TEXT (email).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'loyalty_events'::regclass
       AND contype = 'f'
       AND conname <> 'loyalty_events_member_id_fkey'
       AND conname <> 'loyalty_events_order_id_fkey'
  LOOP
    EXECUTE format('ALTER TABLE loyalty_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'loyalty_events' AND column_name = 'created_by'
       AND data_type <> 'text'
  ) THEN
    ALTER TABLE loyalty_events ALTER COLUMN created_by TYPE TEXT USING created_by::text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS loyalty_events_member_idx ON loyalty_events (member_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_events_order_unique
  ON loyalty_events (order_id, kind) WHERE order_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_member_idx ON orders (member_id);

-- --- Tablas del esquema viejo que ya no se usan --------------------
DROP TABLE IF EXISTS member_devices;
DROP TABLE IF EXISTS admin_login_tokens;
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS staff;

-- --- Vínculo con Supabase Auth -------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_auth_user_id_fkey') THEN
    ALTER TABLE members ADD CONSTRAINT members_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
END $$;

-- --- updated_at ----------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pizzas_set_updated_at ON pizzas;
CREATE TRIGGER pizzas_set_updated_at BEFORE UPDATE ON pizzas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS members_set_updated_at ON members;
CREATE TRIGGER members_set_updated_at BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function runMigrations() {
  console.log('[migrate] Aplicando esquema…');
  await withMigrationClient(async (client) => {
    await client.query(SCHEMA_SQL);
  });
  console.log('[migrate] Listo.');
}

const SEED_CATEGORIES = [
  { slug: 'classic', name: 'Clásicas', sortOrder: 1 },
  { slug: 'special', name: 'Especiales', sortOrder: 2 },
  { slug: 'vegetarian', name: 'Vegetales', sortOrder: 3 },
];

const SEED_PIZZAS = [
  { slug: 'nocturna-margherita', name: 'Margherita', category: 'classic', price: 15500, imageUrl: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=800&q=85', ingredients: 'Masa casa, mozzarella, tomate, albahaca, aceite de oliva', sortOrder: 1 },
  { slug: 'napoles-tradicional', name: 'Napolitana', category: 'classic', price: 17200, imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=85', ingredients: 'Masa napolitana, tomate San Marzano, mozzarella, orégano', sortOrder: 2 },
  { slug: 'pepperoni-de-la-casa', name: 'Pepperoni', category: 'special', price: 17900, imageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=85', ingredients: 'Pepperoni, mozzarella, tomate, orégano, pimentón dulce', sortOrder: 3 },
  { slug: 'parma-nocturna', name: 'Jamón y Rúcula', category: 'special', price: 19500, imageUrl: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=800&q=85', ingredients: 'Prosciutto, rúcula, parmesano, miel de higos, mozzarella', sortOrder: 4 },
  { slug: 'jardin-de-la-casa', name: 'Vegetariana', category: 'vegetarian', price: 16800, imageUrl: 'https://images.unsplash.com/photo-1571997478779-2adcbbe9ab2f?auto=format&fit=crop&w=800&q=85', ingredients: 'Zucchini, champiñones, rúcula, tomate, mozzarella', sortOrder: 5 },
  { slug: 'calabresa-picante', name: 'Calabresa', category: 'special', price: 18400, imageUrl: 'https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=800&q=85', ingredients: 'Salame picante, chili en aceite, mozzarella, orégano', sortOrder: 6 },
  { slug: 'cuatro-quesos', name: 'Cuatro Quesos', category: 'vegetarian', price: 17500, imageUrl: 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=800&q=85', ingredients: 'Mozzarella, gorgonzola, parmesano, azul, albahaca', sortOrder: 7 },
  { slug: 'tricot-funghi', name: 'Champiñones', category: 'classic', price: 17000, imageUrl: 'https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=800&q=85', ingredients: 'Mozzarella, champiñones, jamón cocido, trufa', sortOrder: 8 },
];

const SEED_FEATURED = new Set([
  'nocturna-margherita',
  'pepperoni-de-la-casa',
  'parma-nocturna',
  'cuatro-quesos',
]);

async function runSeed() {
  console.log('[seed] Cargando menú…');
  await withTransaction(async (client) => {
    const categoryIds = new Map();
    for (const category of SEED_CATEGORIES) {
      const { rows } = await client.query(
        `INSERT INTO categories (slug, name, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [category.slug, category.name, category.sortOrder],
      );
      categoryIds.set(category.slug, rows[0].id);
    }

    for (const pizza of SEED_PIZZAS) {
      await client.query(
        `INSERT INTO pizzas (category_id, slug, name, description, price, image_url, ingredients, is_featured, sort_order)
         VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET
           category_id = EXCLUDED.category_id,
           name        = EXCLUDED.name,
           price       = EXCLUDED.price,
           image_url   = EXCLUDED.image_url,
           ingredients = EXCLUDED.ingredients,
           is_featured = EXCLUDED.is_featured,
           sort_order  = EXCLUDED.sort_order`,
        [
          categoryIds.get(pizza.category),
          pizza.slug,
          pizza.name,
          pizza.price,
          pizza.imageUrl,
          pizza.ingredients,
          SEED_FEATURED.has(pizza.slug),
          pizza.sortOrder,
        ],
      );
    }

    await client.query(
      `INSERT INTO members (member_code, name, phone, points, welcome_redeemed)
       VALUES ('#SOCIO-DEMO1', 'Socio de Prueba', '5491100000000', 65, FALSE)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name`,
    );
  });
  console.log(`[seed] Listo: ${SEED_CATEGORIES.length} categorías, ${SEED_PIZZAS.length} pizzas, 1 socio demo.`);
}

// ============================================================
// 14. Arranque
// ============================================================

const mode = process.argv[2];

if (mode === 'migrate') {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('[migrate] Falló:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
} else if (mode === 'seed') {
  runSeed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('[seed] Falló:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
} else {
  startServer();
}
