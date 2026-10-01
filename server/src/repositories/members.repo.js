import crypto from 'node:crypto';
import { pool, withTransaction } from '../db/pool.js';
import {
  RULES,
  BENEFITS,
  pointsForOrder,
  unlockedBenefits,
  nextBenefit,
  pointsToNextBenefit,
  progressToNextBenefit,
  isBirthdayWindow,
  daysUntilBirthday,
  generateMemberCode,
  memberCodeLabel,
  normalizePhone,
} from '../lib/loyalty.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const SELECT_MEMBER = `
  SELECT m.id,
         m.member_code      AS "memberCode",
         m.name,
         m.phone,
         m.birthday,
         m.points,
         m.welcome_redeemed AS "welcomeRedeemed",
         m.is_active        AS "isActive",
         m.created_at       AS "createdAt",
         c.name             AS "customerName",
         c.id               AS "customerId"
    FROM members m
    LEFT JOIN orders o ON o.member_id = m.id
    LEFT JOIN customers c ON c.id = o.customer_id`;

/**
 * Registra un socio, o devuelve el existente si el teléfono ya está dado de
 * alta. Nunca lanza 409: re-registrarse es un caso normal, no un error.
 */
export async function register({ name, phone, birthday }, deviceLabel) {
  const normalized = normalizePhone(phone);
  const existing = await findByPhone(normalized);
  if (existing) {
    const token = await issueDevice(existing.id, deviceLabel);
    return { member: existing, token, created: false };
  }

  const { memberId, created } = await withTransaction(async (client) => {
    // El código es aleatorio: reintentamos ante una colisión improbable.
    let id = null;
    for (let attempt = 0; attempt < 4 && !id; attempt += 1) {
      try {
        const { rows } = await client.query(
          `INSERT INTO members (member_code, name, phone, birthday, points)
           VALUES ($1, $2, $3, $4, 0)
           RETURNING id`,
          [generateMemberCode(), name, normalized, birthday || null],
        );
        id = rows[0].id;
      } catch (error) {
        // 23505 en phone: dos registros con el mismo número a la vez.
        if (error.code !== '23505') throw error;
        const found = await findByPhone(normalized, client);
        if (found) return { memberId: found.id, created: false };
      }
    }

    // Los 20 puntos de bienvenida van al libro, no escritos a mano.
    await client.query(
      `INSERT INTO loyalty_events (member_id, kind, points_delta, note)
       VALUES ($1, 'welcome', $2, $3)`,
      [id, RULES.welcomePoints, 'Puntos de bienvenida por registro'],
    );
    await client.query(
      `UPDATE members SET points = points + $1 WHERE id = $2`,
      [RULES.welcomePoints, id],
    );

    return { memberId: id, created: true };
  });

  // El token se emite fuera de la transacción anterior para que el camino de
  // carrera (el socio ya existía) también reciba uno.
  const token = await issueDevice(memberId, deviceLabel);
  return { member: await findById(memberId), token, created };
}

export async function findById(id, client) {
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE m.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findByPhone(phone, client) {
  if (!phone) return null;
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE m.phone = $1`, [phone]);
  return rows[0] ?? null;
}

export async function findByCode(code, client) {
  if (!code) return null;
  const runner = client ?? pool;
  const { rows } = await runner.query(`${SELECT_MEMBER} WHERE m.member_code = $1`, [
    String(code).trim().toUpperCase(),
  ]);
  return rows[0] ?? null;
}

/**
 * Vincula un pedido a un socio por código. Devuelve null si el código no
 * existe o el socio está inactivo: el pedido sigue siendo válido.
 */
export async function findForOrder(code) {
  const member = await findByCode(code);
  if (!member || !member.isActive) return null;
  return member;
}

// --- Dispositivos --------------------------------------------------------

export async function issueDevice(memberId, label, client) {
  const runner = client ?? pool;
  const token = crypto.randomBytes(32).toString('base64url');
  await runner.query(
    `INSERT INTO member_devices (member_id, token_hash, label) VALUES ($1, $2, $3)`,
    [memberId, hashToken(token), label ?? null],
  );
  return token;
}

export async function resolveDevice(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT d.id AS device_id, m.*
       FROM member_devices d
       JOIN members m ON m.id = d.member_id
      WHERE d.token_hash = $1 AND m.is_active = TRUE`,
    [hashToken(token)],
  );
  if (!rows[0]) return null;

  await pool.query(
    `UPDATE member_devices SET last_seen = now() WHERE id = $1`,
    [rows[0].device_id],
  );
  return findById(rows[0].id);
}

// --- Saldo ---------------------------------------------------------------

/**
 * Suma o resta puntos y deja el movimiento en el libro, en una transacción.
 * El CHECK (points >= 0) hace que un canje sin saldo revierta todo.
 */
export async function addPoints({ memberId, delta, kind, note, orderId = null, staffId = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE members SET points = points + $1 WHERE id = $2
       RETURNING id, points`,
      [delta, memberId],
    );
    if (!rows[0]) {
      const error = new Error('Socio inexistente.');
      error.statusCode = 404;
      error.expose = true;
      throw error;
    }

    await client.query(
      `INSERT INTO loyalty_events (member_id, order_id, kind, points_delta, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, orderId, kind, delta, note ?? null, staffId],
    );

    return rows[0].points;
  });
}

/**
 * Acredita los puntos de un pedido entregado.
 *
 * Devuelve null si el pedido no tiene socio, o si ya se acreditó: el índice
 * único parcial sobre (order_id, kind) evita el doble conteo.
 */
export async function creditOrder(orderId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT o.id, o.member_id, o.total_amount, o.order_code
         FROM orders o
        WHERE o.id = $1 AND o.member_id IS NOT NULL`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return null;

    const points = pointsForOrder(order.total_amount);
    if (points <= 0) return { points: 0, credited: false, orderCode: order.order_code };

    try {
      await client.query(
        `INSERT INTO loyalty_events (member_id, order_id, kind, points_delta, note)
         VALUES ($1, $2, 'purchase', $3, $4)`,
        [order.member_id, orderId, points, `Pedido ${order.order_code}`],
      );
    } catch (error) {
      // 23505: ya había un evento de compra para este pedido.
      if (error.code === '23505') return { points: 0, credited: false, orderCode: order.order_code };
      throw error;
    }

    await client.query(`UPDATE members SET points = points + $1 WHERE id = $2`, [
      points,
      order.member_id,
    ]);

    return { points, credited: true, orderCode: order.order_code };
  });
}

export async function markWelcomeRedeemed(memberId) {
  const { rows } = await pool.query(
    `UPDATE members SET welcome_redeemed = TRUE
      WHERE id = $1 AND welcome_redeemed = FALSE
      RETURNING id`,
    [memberId],
  );
  return rows.length > 0;
}

// --- Vista del pase ------------------------------------------------------

/** Arma el pase: saldo, progreso, beneficios y estado del cumpleaños. */
export function buildPass(member) {
  const points = member.points ?? 0;
  const birthdayActive = isBirthdayWindow(member.birthday);
  const redeemed = new Set(
    member.redemptions?.map((event) => event.key) ?? [],
  );

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
            ? `Tu cumpleaños es el ${formatBirthday(member.birthday)}.`
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

const formatBirthday = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
};

/** Canjes ya usados, agrupados por beneficio. */
export async function loadRedemptions(memberId) {
  const { rows } = await pool.query(
    `SELECT note, created_at FROM loyalty_events
      WHERE member_id = $1 AND kind = 'redemption'
      ORDER BY created_at DESC`,
    [memberId],
  );

  const byLabel = new Map(BENEFITS.map((benefit) => [benefit.label, benefit.key]));
  return rows.map((row) => ({ key: byLabel.get(row.note) ?? 'other', note: row.note }));
}

// --- Panel ---------------------------------------------------------------

export async function list({ search = '', minPoints = null, sort = 'points' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(
      `(lower(m.name) LIKE $${params.length} OR m.phone LIKE $${params.length}
        OR lower(m.member_code) LIKE $${params.length})`,
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
    `SELECT m.id,
            m.member_code      AS "memberCode",
            m.name,
            m.phone,
            m.birthday,
            m.points,
            m.welcome_redeemed AS "welcomeRedeemed",
            m.is_active        AS "isActive",
            m.created_at       AS "createdAt",
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

export async function history(memberId) {
  const { rows } = await pool.query(
    `SELECT e.id,
            e.kind,
            e.points_delta AS "pointsDelta",
            e.note,
            e.created_at  AS "createdAt",
            o.order_code  AS "orderCode"
       FROM loyalty_events e
       LEFT JOIN orders o ON o.id = e.order_id
      WHERE e.member_id = $1
      ORDER BY e.created_at DESC
      LIMIT 100`,
    [memberId],
  );
  return rows;
}

/** Cumpleaños dentro de los próximos días. Compara mes/día, no año. */
export async function upcomingBirthdays({ days = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, member_code AS "memberCode", name, phone, birthday, points
       FROM members
      WHERE is_active = TRUE
        AND birthday IS NOT NULL
      ORDER BY birthday`,
  );

  const today = new Date();
  return rows
    .map((member) => ({
      ...member,
      daysUntil: daysUntilBirthday(member.birthday, today),
    }))
    .filter((member) => member.daysUntil !== null && member.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}
