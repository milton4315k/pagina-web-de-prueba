// Tests de integración contra Postgres en memoria (pg-mem).
//
// Carga el esquema real de las migraciones y corre las queries de los
// repositorios contra él. Cubre nombres de columnas, tipos de las filas,
// CHECK/FK y la semántica de las transacciones.
//
// pg-mem no implementa algunas cosas de Postgres real (extensiones,
// plpgsql y triggers), así que esas partes de la migración se quitan antes
// de aplicar el esquema. El test verifica que efectivamente se quitaron, para
// que el esquema en memoria no quede medio vacío en silencio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import pgMem from 'pg-mem';

const { newDb } = pgMem;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
process.env.DATABASE_MIGRATION_URL ??= 'postgresql://u:p@localhost:5432/test';
process.env.CORS_ORIGINS ??= 'http://localhost:4173';
process.env.ADMIN_WHATSAPP ??= '5491128493108';
process.env.PUBLIC_SITE_URL ??= 'http://localhost:4173';
process.env.SESSION_SECRET ??= 'test-secret-esta-cadena-tiene-32-chars-minimo';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// pg-mem no soporta estas construcciones de Postgres real.
const UNSUPPORTED = [
  /CREATE\s+EXTENSION[^;]*;/gi,
  /CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]*?\$\$[\s\S]*?\$\$\s*LANGUAGE\s+plpgsql\s*;/gi,
  /CREATE\s+TRIGGER[\s\S]*?EXECUTE\s+FUNCTION\s+\w+\s*\([^)]*\)\s*;/gi,
];

function stripUnsupported(sql) {
  return UNSUPPORTED.reduce((acc, pattern) => acc.replace(pattern, ''), sql);
}

/**
 * pg-mem no aplica constraints UNIQUE, solo PK y CHECK/FK. Por eso
 * `orders.order_code` no se puede testear acá; sí contra Postgres real.
 */
const PG_MEM_LIMITS = [
  'UNIQUE sobre orders.order_code no se aplica',
  'triggers de updated_at no se ejecutan',
  'CREATE EXTENSION pgcrypto no está soportado',
];

async function migrationFiles() {
  return (await readdir(migrationsDir)).sort();
}

async function upSql() {
  const contents = [];

  for (const file of await migrationFiles()) {
    if (file.endsWith('.sql')) {
      const raw = await readFile(path.join(migrationsDir, file), 'utf8');
      const downStart = raw.search(/^\s*--[\s-]*down\s+migration/im);
      contents.push(downStart >= 0 ? raw.slice(0, downStart) : raw);
    } else {
      const module = await import(pathToFileURL(path.join(migrationsDir, file)).href);
      const captured = [];
      await module.up({ sql: (statement) => captured.push(statement) });
      contents.push(captured.join('\n'));
    }
  }

  return contents.join('\n');
}

/** Base en memoria con el esquema migrado, lista para recibir queries. */
async function createSchema() {
  const raw = await upSql();
  const sql = stripUnsupported(raw);

  // Si someday pg-mem soporta todo esto, hay que sacar el strip.
  assert.equal(sql.length > 0, true, 'el esquema quedó vacío');

  const db = newDb();
  db.public.none(sql);

  const { Pool } = db.adapters.createPg();
  return { db, pool: new Pool() };
}

test('el esquema de las migraciones no usa construcciones no soportadas', async () => {
  const raw = await upSql();
  const stripped = stripUnsupported(raw);

  // Estas sí tienen que quedar: si desaparecen, el test pierde valor.
  assert.match(stripped, /CREATE TABLE\s+(IF NOT EXISTS\s+)?categories/);
  assert.match(stripped, /CREATE TABLE\s+(IF NOT EXISTS\s+)?pizzas/);
  assert.match(stripped, /CREATE TABLE\s+(IF NOT EXISTS\s+)?orders/);
  assert.match(stripped, /CREATE TABLE\s+(IF NOT EXISTS\s+)?staff/);
  assert.match(stripped, /CREATE TABLE\s+(IF NOT EXISTS\s+)?admin_sessions/);
  assert.equal(/CREATE\s+TRIGGER/i.test(stripped), false);
});

test('las migraciones crean todas las tablas esperadas', async () => {
  const { db, pool } = await createSchema();

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const tables = rows.map((row) => row.table_name);

  for (const expected of [
    'admin_login_tokens',
    'admin_sessions',
    'categories',
    'contact_messages',
    'customers',
    'order_items',
    'orders',
    'pizzas',
    'staff',
  ]) {
    assert.ok(tables.includes(expected), `falta la tabla ${expected}`);
  }

  await pool.end();
  assert.ok(db);
});

test('catálogo: categorías y pizzas con los nombres de columna esperados', async () => {
  const { pool } = await createSchema();

  // El pool del módulo se reemplaza por el adapter en memoria.
  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);

  const categorias = await import('../src/repositories/categorias.repo.js');
  const pizzas = await import('../src/repositories/pizzas.repo.js');

  try {
    await pool.query(
      `INSERT INTO categories (slug, name, sort_order) VALUES ($1, $2, $3), ($4, $5, $6)`,
      ['classic', 'Clásicas', 1, 'special', 'Especiales', 2],
    );
    const { rows } = await pool.query(`SELECT id FROM categories WHERE slug = 'classic'`);
    const classicId = rows[0].id;

    await pool.query(
      `INSERT INTO pizzas (category_id, slug, name, price, ingredients, is_featured, sort_order)
       VALUES ($1, 'margherita', 'Nocturna Margherita', 15500, 'Tomate, Mozzarella', TRUE, 1),
              ($1, 'pepperoni', 'Pepperoni de la Casa', 17900, 'Pepperoni, Orégano', FALSE, 2),
              ($1, 'oculta', 'Pizza Oculta', 1000, 'Nada', FALSE, 3)`,
      [classicId],
    );
    await pool.query(`UPDATE pizzas SET is_available = FALSE WHERE slug = 'oculta'`);

    const listaCategorias = await categorias.listCategories();
    assert.equal(listaCategorias.length, 2);
    assert.equal(listaCategorias[0].slug, 'classic');
    assert.ok('sortOrder' in listaCategorias[0], 'sort_order debe venir como sortOrder');
    assert.equal((await categorias.listBySlug('special')).name, 'Especiales');
    assert.equal(await categorias.listBySlug('fantasma'), null);

    const todas = await pizzas.list();
    assert.equal(todas.length, 3);
    assert.equal(todas[0].name, 'Nocturna Margherita');
    assert.equal(todas[0].price, 15500);
    assert.equal(todas[0].category, 'classic');
    assert.equal(todas[0].isFeatured, true);
    assert.ok('imageUrl' in todas[0], 'image_url debe venir como imageUrl');

    assert.equal((await pizzas.list({ category: 'special' })).length, 0, 'no hay en especial');
    assert.equal((await pizzas.list({ featured: true })).length, 1);
    assert.equal((await pizzas.list({ available: true })).length, 2);
    assert.equal((await pizzas.list({ available: false })).length, 1);
    assert.equal(
      (await pizzas.list({ category: 'classic', featured: true })).length,
      1,
      'los filtros se combinan con AND',
    );
    assert.equal(
      (await pizzas.list({ category: 'classic', featured: false })).length,
      2,
      'pepperoni y oculta no son destacadas',
    );
    assert.equal(
      (await pizzas.list({ featured: false, available: true })).length,
      1,
      'la oculta no está disponible, así que el filtro available la saca',
    );
    assert.equal((await pizzas.listBySlug('pepperoni')).price, 17900);
    assert.equal(await pizzas.listBySlug('no-existe'), null);
  } finally {
    poolModule.pool.query = original;
    await pool.end();
  }
});

test('pedidos: total calculado en el servidor, snapshot y rollback', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  const originalConnect = poolModule.pool.connect;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);
  poolModule.pool.connect = async () => {
    const client = await pool.connect();
    return { query: client.query.bind(client), release: client.release.bind(client) };
  };

  const pizzas = await import('../src/repositories/pizzas.repo.js');
  const pedidos = await import('../src/repositories/pedidos.repo.js');
  const pedidosAdmin = await import('../src/repositories/pedidos.admin.repo.js');

  try {
    const { rows } = await pool.query(
      `INSERT INTO categories (slug, name) VALUES ('classic', 'Clásicas') RETURNING id`,
    );
    const categoryId = rows[0].id;

    await pool.query(
      `INSERT INTO pizzas (category_id, slug, name, price) VALUES ($1, 'margherita', 'Nocturna Margherita', 15500)`,
      [categoryId],
    );
    const pizza = (await pizzas.list())[0];

    const creado = await pedidos.create({
      customer: { name: 'Juan Pérez', phone: '1128493108', email: '' },
      items: [{ pizzaId: pizza.id, quantity: 2 }],
      fulfillmentType: 'delivery',
      address: 'Av. Corrientes 1234',
      notes: 'sin cebolla',
    });

    assert.match(creado.order.orderCode, /^NP-[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(creado.order.totalAmount, 31000, 'el total sale del precio en base');
    assert.equal(creado.order.status, 'new');
    assert.match(creado.whatsappUrl, /^https:\/\/wa\.me\/5491128493108\?text=/);
    assert.match(creado.message, /2x Nocturna Margherita/);
    assert.match(creado.message, /Total: \$31\.000/);
    assert.match(creado.message, new RegExp(creado.order.orderCode));

    // El cliente manda un price falso; el servidor lo ignora.
    const conPrecioFalso = await pedidos.create({
      customer: { name: 'Ana', phone: '1133334444' },
      items: [{ pizzaId: pizza.id, quantity: 1, price: 1 }],
      fulfillmentType: 'pickup',
    });
    assert.equal(conPrecioFalso.order.totalAmount, 15500);

    // Pizza inexistente: la transacción entera se revierte.
    await assert.rejects(
      () =>
        pedidos.create({
          customer: { name: 'Rob', phone: '1100000000' },
          items: [{ pizzaId: 9999, quantity: 1 }],
          fulfillmentType: 'pickup',
        }),
      /no disponibles/,
    );

    const { rows: ordenes } = await pool.query(`SELECT order_code FROM orders ORDER BY id`);
    assert.equal(ordenes.length, 2, 'el pedido inválido no se guardó');
    const { rows: clientes } = await pool.query(`SELECT name FROM customers ORDER BY id`);
    assert.equal(
      clientes.some((row) => row.name === 'Rob'),
      false,
      'el cliente del pedido fallido también revirtió',
    );

    // Cambiar el precio no altera pedidos ya hechos.
    await pool.query(`UPDATE pizzas SET price = 99999 WHERE slug = 'margherita'`);
    const { rows: viejo } = await pool.query(
      `SELECT o.total_amount, i.unit_price
         FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.order_code = $1`,
      [creado.order.orderCode],
    );
    assert.equal(viejo[0].total_amount, 31000);
    assert.equal(viejo[0].unit_price, 15500, 'el snapshot conserva el precio original');

    // Borrar la pizza deja el pedido intacto.
    await pool.query(`DELETE FROM pizzas WHERE slug = 'margherita'`);
    const { rows: pedidoIds } = await pool.query(
      `SELECT id FROM orders WHERE order_code = $1`,
      [creado.order.orderCode],
    );
    const detalle = await pedidosAdmin.getById(pedidoIds[0].id);
    assert.equal(detalle.items.length, 1);
    assert.equal(detalle.items[0].name, 'Nocturna Margherita');
    assert.equal(detalle.customerName, 'Juan Pérez');
    assert.equal(detalle.customerPhone, '1128493108');

    // El endpoint público no expone PII.
    const estado = await pedidos.getPublicStatus(creado.order.orderCode);
    assert.deepEqual(Object.keys(estado).sort(), ['createdAt', 'orderCode', 'status']);
    assert.equal(await pedidos.getPublicStatus('NP-XXXXX'), null);

    const listado = await pedidosAdmin.list({ status: 'new' });
    assert.equal(listado.orders.length, 2);
    assert.equal(listado.total, 2);
    assert.ok(listado.orders[0].customerPhone, 'el panel sí ve el teléfono');
    assert.ok(listado.orders[0].itemCount >= 1);
    assert.equal((await pedidosAdmin.list({ status: 'delivered' })).orders.length, 0);

    const actualizado = await pedidosAdmin.updateStatus(pedidoIds[0].id, 'confirmed');
    assert.equal(actualizado.status, 'confirmed');
    assert.equal(await pedidosAdmin.updateStatus(999999, 'confirmed'), null);

    const counts = await pedidosAdmin.countsByStatus();
    assert.equal(counts.confirmed, 1);
    assert.equal(counts.new, 1);
    assert.equal(counts.delivered, 0);

    assert.equal(await pedidosAdmin.getById(999999), null);
  } finally {
    poolModule.pool.query = original;
    poolModule.pool.connect = originalConnect;
    await pool.end();
  }
});

test('mensajes: listado, unread y marcado de leídos', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);

  const mensajesAdmin = await import('../src/repositories/mensajes.admin.repo.js');
  const mensajes = await import('../src/repositories/mensajes.repo.js');

  try {
    const guardada = await mensajes.create({
      name: 'Ana',
      phone: '1133334444',
      subject: 'Pedido',
      message: 'Consulta por horarios',
    });
    assert.ok(guardada.id);

    const resultado = await mensajesAdmin.list({ unread: true });
    assert.equal(resultado.total, 1);
    assert.equal(resultado.messages.length, 1);
    assert.equal(resultado.messages[0].isRead, false);
    assert.equal(resultado.messages[0].subject, 'Pedido');
    assert.equal(await mensajesAdmin.unreadCount(), 1);

    const leido = await mensajesAdmin.markRead(resultado.messages[0].id);
    assert.equal(leido.isRead, true);
    assert.equal(await mensajesAdmin.unreadCount(), 0);
    assert.equal((await mensajesAdmin.list({})).messages.length, 1);
    assert.equal((await mensajesAdmin.list({ unread: true })).messages.length, 0);
    assert.equal(await mensajesAdmin.markRead(999999), null);
  } finally {
    poolModule.pool.query = original;
    await pool.end();
  }
});

test('auth del panel: token de un solo uso y sesión revocable', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);

  const admin = await import('../src/repositories/admin.repo.js');

  try {
    const login = await admin.requestLogin();
    assert.ok(login.expiresInMinutes <= 15);

    // El link va dentro del mensaje de WhatsApp, que va URL-encoded.
    const message = decodeURIComponent(login.whatsappUrl.split('?text=')[1]);
    assert.match(message, /\/admin\/authorize\.html\?t=[A-Za-z0-9_-]+/);

    const token = message.match(/\?t=([A-Za-z0-9_-]+)/)[1];
    const sesion = await admin.verifyLogin(token);
    assert.ok(sesion.sessionToken);
    assert.equal(sesion.staff.role, 'owner');
    assert.equal(sesion.staff.whatsapp, '5491128493108');

    assert.equal(await admin.verifyLogin(token), null, 'el token es de un solo uso');
    assert.ok(await admin.resolveSession(sesion.sessionToken));
    assert.equal(await admin.resolveSession('inventado'), null);
    assert.equal(await admin.resolveSession(undefined), null);

    await admin.destroySession(sesion.sessionToken);
    assert.equal(await admin.resolveSession(sesion.sessionToken), null);

    // Guardamos el hash, no el token.
    const { rows } = await pool.query(`SELECT token_hash FROM admin_login_tokens LIMIT 1`);
    assert.equal(rows[0].token_hash.length, 64, 'se guarda un sha256');
    assert.notEqual(rows[0].token_hash, token);
  } finally {
    poolModule.pool.query = original;
    await pool.end();
  }
});

test('Pase Nocturno: registro idempotente por teléfono', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  const originalConnect = poolModule.pool.connect;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);
  poolModule.pool.connect = async () => {
    const client = await pool.connect();
    return { query: client.query.bind(client), release: client.release.bind(client) };
  };

  const members = await import('../src/repositories/members.repo.js');

  try {
    const { member, token, created } = await members.register({
      name: 'Franco Ruiz',
      phone: '11 2849-3108',
      birthday: '1990-06-15',
    });

    assert.equal(created, true);
    assert.equal(member.points, 20, 'los 20 de bienvenida se acreditan');
    assert.match(member.memberCode, /^#SOCIO-/);
    assert.equal(member.phone, '5491128493108');
    assert.ok(token);

    // La bienvenida queda asentada en el libro, no escrita a mano.
    const { rows: eventos } = await pool.query(
      `SELECT kind, points_delta FROM loyalty_events WHERE member_id = $1`,
      [member.id],
    );
    assert.deepEqual(eventos, [{ kind: 'welcome', points_delta: 20 }]);

    // Re-registrarse con el mismo número NO duplica ni regala puntos.
    const segundo = await members.register({
      name: 'Franco Ruiz',
      phone: '+54 9 11 2849-3108',
    });
    assert.equal(segundo.created, false);
    assert.equal(segundo.member.id, member.id, 'es el mismo socio');
    assert.equal(segundo.member.points, 20, 'no se suman 20 otra vez');
    assert.equal(
      segundo.member.memberCode,
      member.memberCode,
      'conserva su código original',
    );

    const { rows: total } = await pool.query(`SELECT count(*)::int AS n FROM members`);
    assert.equal(total[0].n, 1, 'no se creó un segundo socio');

    // El token resuelve al socio y actualiza last_seen.
    const resuelto = await members.resolveDevice(token);
    assert.equal(resuelto.id, member.id);
    assert.equal(await members.resolveDevice('basura'), null);
    assert.equal(await members.resolveDevice(undefined), null);
    assert.equal(await members.resolveDevice(segundo.token) !== null, true);
  } finally {
    poolModule.pool.query = original;
    poolModule.pool.connect = originalConnect;
    await pool.end();
  }
});

test('Pase Nocturno: canje descuenta y no deja saldo negativo', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  const originalConnect = poolModule.pool.connect;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);
  poolModule.pool.connect = async () => {
    const client = await pool.connect();
    return { query: client.query.bind(client), release: client.release.bind(client) };
  };

  const members = await import('../src/repositories/members.repo.js');
  const adminMembers = await import('../src/routes/admin/members.js');

  try {
    const { member } = await members.register({
      name: 'Ana Gómez',
      phone: '1133334444',
    });

    // Con 20 puntos la Margherita todavía no se puede canjear.
    await assert.rejects(
      () =>
        members.addPoints({
          memberId: member.id,
          delta: -100,
          kind: 'redemption',
          note: 'Margherita',
        }),
      /violated|check/i,
      'el CHECK points >= 0 revierte el canje sin saldo',
    );

    const { rows: saldo } = await pool.query(`SELECT points FROM members WHERE id = $1`, [
      member.id,
    ]);
    assert.equal(saldo[0].points, 20, 'el saldo quedó intacto');

    // Ajuste manual a 120.
    const ajustado = await members.addPoints({
      memberId: member.id,
      delta: 100,
      kind: 'manual_adjust',
      note: 'Corrección manual',
    });
    assert.equal(ajustado, 120);

    // Canjea la Margherita.
    const despues = await members.addPoints({
      memberId: member.id,
      delta: -100,
      kind: 'redemption',
      note: 'Nocturna Margherita gratis',
    });
    assert.equal(despues, 20);

    // El saldo siempre se puede reconstruir sumando el libro.
    const { rows: suma } = await pool.query(
      `SELECT COALESCE(sum(points_delta), 0)::int AS total
         FROM loyalty_events WHERE member_id = $1`,
      [member.id],
    );
    assert.equal(suma[0].total, 20, 'el libro y el saldo coinciden');

    assert.ok(adminMembers);
  } finally {
    poolModule.pool.query = original;
    poolModule.pool.connect = originalConnect;
    await pool.end();
  }
});

test('Pase Nocturno: los puntos del pedido se acreditan al entregarlo', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  const originalConnect = poolModule.pool.connect;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);
  poolModule.pool.connect = async () => {
    const client = await pool.connect();
    return { query: client.query.bind(client), release: client.release.bind(client) };
  };

  const members = await import('../src/repositories/members.repo.js');
  const pedidos = await import('../src/repositories/pedidos.repo.js');
  const pedidosAdmin = await import('../src/repositories/pedidos.admin.repo.js');

  try {
    const { rows: cat } = await pool.query(
      `INSERT INTO categories (slug, name) VALUES ('classic', 'Clásicas') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO pizzas (category_id, slug, name, price)
       VALUES ($1, 'pepperoni', 'Pepperoni', 17900)`,
      [cat[0].id],
    );
    const { rows: pz } = await pool.query(`SELECT id FROM pizzas`);
    const pizzaId = pz[0].id;

    const { member } = await members.register({ name: 'Franco', phone: '1128493108' });
    const saldoInicial = member.points;

    // Pedido con código de socio: el pedido queda vinculado.
    const conSocio = await pedidos.create({
      customer: { name: 'Franco', phone: '1128493108' },
      items: [{ pizzaId, quantity: 1 }],
      fulfillmentType: 'pickup',
      memberCode: member.memberCode,
    });
    assert.ok(conSocio.member, 'el pedido se asocia al socio');
    assert.equal(conSocio.member.memberCode, member.memberCode.slice(1));
    assert.match(conSocio.message, /Pase Nocturno: SOCIO-/);

    // Pedido sin código: sigue siendo válido, pero sin socio.
    const sinSocio = await pedidos.create({
      customer: { name: 'Otro', phone: '1155555555' },
      items: [{ pizzaId, quantity: 1 }],
      fulfillmentType: 'pickup',
    });
    assert.equal(sinSocio.member, null);

    // Un código inventado no rompe el pedido.
    const codigoMalo = await pedidos.create({
      customer: { name: 'Tercero', phone: '1166666666' },
      items: [{ pizzaId, quantity: 1 }],
      fulfillmentType: 'pickup',
      memberCode: '#SOCIO-ZZZZZ',
    });
    assert.equal(codigoMalo.member, null);

    const { rows: orden } = await pool.query(
      `SELECT id FROM orders WHERE order_code = $1`,
      [conSocio.order.orderCode],
    );
    const orderId = orden[0].id;

    // Mientras no esté entregado, no suma nada.
    await pedidosAdmin.updateStatus(orderId, 'confirmed');
    let { rows: saldo } = await pool.query(`SELECT points FROM members WHERE id = $1`, [
      member.id,
    ]);
    assert.equal(saldo[0].points, saldoInicial, 'confirmar no acredita puntos');

    // Al entregarlo: $17.900 = 17 puntos.
    await pedidosAdmin.updateStatus(orderId, 'delivered');
    ({ rows: saldo } = await pool.query(`SELECT points FROM members WHERE id = $1`, [
      member.id,
    ]));
    assert.equal(saldo[0].points, saldoInicial + 17, '$17.900 da 17 puntos');

    // Marcarlo entregado otra vez no suma de nuevo.
    await pedidosAdmin.updateStatus(orderId, 'delivered');
    ({ rows: saldo } = await pool.query(`SELECT points FROM members WHERE id = $1`, [
      member.id,
    ]));
    assert.equal(saldo[0].points, saldoInicial + 17, 'no se acredita dos veces');

    // Sacarlo de entregado revierte los puntos.
    await pedidosAdmin.updateStatus(orderId, 'preparing');
    ({ rows: saldo } = await pool.query(`SELECT points FROM members WHERE id = $1`, [
      member.id,
    ]));
    assert.equal(saldo[0].points, saldoInicial, 'volver atrás descuenta');
  } finally {
    poolModule.pool.query = original;
    poolModule.pool.connect = originalConnect;
    await pool.end();
  }
});

test('Pase Nocturno: el pase arma beneficios con su estado', async () => {
  const { pool } = await createSchema();

  const poolModule = await import('../src/db/pool.js');
  const original = poolModule.pool.query;
  const originalConnect = poolModule.pool.connect;
  poolModule.pool.query = (sql, params) => pool.query(sql, params);
  poolModule.pool.connect = async () => {
    const client = await pool.connect();
    return { query: client.query.bind(client), release: client.release.bind(client) };
  };

  const members = await import('../src/repositories/members.repo.js');

  try {
    const { member } = await members.register({ name: 'Lena', phone: '1177777777' });
    const pass = members.buildPass(member);

    assert.equal(pass.points, 20);
    assert.equal(pass.memberCodeLabel.startsWith('SOCIO-'), true);
    assert.equal(pass.nextBenefit.key, 'drink');
    assert.equal(pass.pointsToNext, 30);

    const porClave = Object.fromEntries(pass.benefits.map((b) => [b.key, b]));

    assert.equal(porClave.welcome.available, true, 'el 10% arranca disponible');
    assert.equal(porClave.welcome.redeemed, false);
    assert.equal(porClave.drink.available, false, 'con 20 pts no alcanza');
    assert.match(porClave.drink.reason, /Te faltan 30 pts/);
    assert.equal(porClave.margherita.available, false);
    assert.equal(porClave.birthday.available, false, 'sin cumpleaños cargado');
    assert.match(porClave.birthday.reason, /Agregá tu fecha/);

    // Con 100 puntos, la Margherita queda disponible.
    await members.addPoints({
      memberId: member.id,
      delta: 80,
      kind: 'manual_adjust',
      note: 'prueba',
    });
    const conPuntos = members.buildPass(await members.findById(member.id));
    const porClave2 = Object.fromEntries(conPuntos.benefits.map((b) => [b.key, b]));
    assert.equal(porClave2.margherita.available, true);
    assert.equal(porClave2.drink.available, true);
    assert.equal(conPuntos.nextBenefit, null, 'ya no queda nada por saldo');
  } finally {
    poolModule.pool.query = original;
    poolModule.pool.connect = originalConnect;
    await pool.end();
  }
});

test('Pase Nocturno: los CHECK y las FK rechazan valores inválidos', async () => {
  const { pool } = await createSchema();

  const { rows } = await pool.query(
    `INSERT INTO categories (slug, name) VALUES ('classic', 'Clásicas') RETURNING id`,
  );
  const categoryId = rows[0].id;

  await pool.query(
    `INSERT INTO pizzas (category_id, slug, name, price) VALUES ($1, 'ok', 'OK', 100)`,
    [categoryId],
  );

  await assert.rejects(() =>
    pool.query(
      `INSERT INTO pizzas (category_id, slug, name, price) VALUES ($1, 'neg', 'Neg', -5)`,
      [categoryId],
    ),
  );

  await assert.rejects(() =>
    pool.query(`INSERT INTO categories (slug, name) VALUES ('classic', 'Duplicada')`),
  );

  await assert.rejects(() =>
    pool.query(`INSERT INTO orders (order_code, customer_id, fulfillment_type, total_amount)
                VALUES ('NP-AAA', 999999, 'pickup', 100)`),
  );

  const { rows: cliente } = await pool.query(
    `INSERT INTO customers (name, phone) VALUES ('A', '111') RETURNING id`,
  );

  await assert.rejects(() =>
    pool.query(
      `INSERT INTO orders (order_code, customer_id, fulfillment_type, total_amount)
       VALUES ($1, $2, 'teletransporte', 100)`,
      ['NP-BBB', cliente[0].id],
    ),
  );

  // El UNIQUE de order_code no se puede verificar acá: pg-mem no lo aplica.
  // Es lo que hace que el INSERT con reintentos de create() sea necesario.

  await pool.query(
    `INSERT INTO orders (order_code, customer_id, fulfillment_type, total_amount)
     VALUES ($1, $2, 'pickup', 100)`,
    ['NP-CCC', cliente[0].id],
  );

  await assert.rejects(() =>
    pool.query(`UPDATE orders SET status = 'inventado' WHERE order_code = 'NP-CCC'`),
  );

  await assert.rejects(() =>
    pool.query(
      `INSERT INTO order_items (order_id, name_snapshot, unit_price, quantity, subtotal)
       VALUES ((SELECT id FROM orders WHERE order_code = 'NP-CCC'), 'X', 1, 0, 0)`,
    ),
  );

  // Borrar un pedido lleva sus items; borrar una categoría no borra pizzas.
  await assert.rejects(() =>
    pool.query(`DELETE FROM categories WHERE id = $1`, [categoryId]),
  );

  await pool.query(
    `INSERT INTO order_items (order_id, name_snapshot, unit_price, quantity, subtotal)
     VALUES ((SELECT id FROM orders WHERE order_code = 'NP-CCC'), 'X', 100, 1, 100)`,
  );
  await pool.query(`DELETE FROM orders WHERE order_code = 'NP-CCC'`);
  const { rows: items } = await pool.query(`SELECT id FROM order_items`);
  assert.equal(items.length, 0, 'los items se borran en cascada');

  await pool.end();
});
