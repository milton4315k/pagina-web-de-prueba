// Runner de tests: usa node:test sin dependencias externas.
// Para correr la suite completa necesita una base real configurada en .env.
// El stub de pool permite probar rutas sin BD.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
process.env.DATABASE_MIGRATION_URL ??= 'postgresql://u:p@localhost:5432/test';
process.env.CORS_ORIGINS ??= 'http://localhost:4173';
process.env.ADMIN_WHATSAPP ??= '5491128493108';
process.env.PUBLIC_SITE_URL ??= 'http://localhost:4173';
process.env.SESSION_SECRET ??= 'test-secret-esta-cadena-tiene-32-chars-minimo';

const { buildApp } = await import('../src/app.js');
const {
  formatPrice,
  generateOrderCode,
  buildOrderMessage,
  buildWhatsappUrl,
} = await import('../src/lib/whatsapp.js');
const { orderSchema, messageSchema } = await import('../src/schemas/pedido.schema.js');
const { hashToken, issueToken } = await import('../src/repositories/admin.repo.js');
const { isDatabaseError } = await import('../src/lib/db-errors.js');

test('isDatabaseError reconoce AggregateError de socket', () => {
  const aggregate = new AggregateError(
    [Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' })],
    '',
  );
  aggregate.code = 'ECONNREFUSED';
  assert.equal(isDatabaseError(aggregate), true);
});

test('isDatabaseError reconoce pooler saturado', () => {
  const error = Object.assign(new Error('too many connections'), { code: '53300' });
  assert.equal(isDatabaseError(error), true);
});

test('isDatabaseError no confunde otros errores', () => {
  assert.equal(isDatabaseError(Object.assign(new Error('boom'), { code: 'ERR_X' })), false);
  assert.equal(isDatabaseError(new Error('sin código')), false);
  assert.equal(isDatabaseError(null), false);
});

test('formatPrice usa separador de miles argentino', () => {
  assert.equal(formatPrice(15500), '$15.500');
  assert.equal(formatPrice(0), '$0');
});

test('generateOrderCode produce el prefijo NP- y 5 caracteres legibles', () => {
  const code = generateOrderCode();
  assert.match(code, /^NP-[A-HJ-NP-Z2-9]{5}$/);
  assert.notEqual(code, generateOrderCode());
});

test('buildOrderMessage incluye snapshot, total y código', () => {
  const message = buildOrderMessage({
    order: {
      orderCode: 'NP-ABCDE',
      totalAmount: 50500,
      fulfillmentType: 'delivery',
      address: 'Av. Corrientes 1234',
      notes: 'sin cebolla',
    },
    customer: { name: 'Juan', phone: '1128493108' },
    items: [
      { name: 'Margherita', unitPrice: 15500, quantity: 2 },
      { name: 'Parma', unitPrice: 19500, quantity: 1 },
    ],
  });

  assert.match(message, /Juan/);
  assert.match(message, /NP-ABCDE/);
  assert.match(message, /2x Margherita/);
  assert.match(message, /Total: \$50\.500/);
  assert.match(message, /Entrega a domicilio/);
  assert.match(message, /Av\. Corrientes 1234/);
});

test('buildWhatsappUrl escapa el mensaje', () => {
  const url = buildWhatsappUrl('5491128493108', 'hola & chau');
  assert.match(url, /^https:\/\/wa\.me\/5491128493108\?text=/);
  assert.match(url, /hola%20%26%20chau/);
});

test('orderSchema rechaza pedido sin items', () => {
  const result = orderSchema.safeParse({
    customer: { name: 'Juan', phone: '1128493108' },
    fulfillmentType: 'pickup',
    items: [],
  });
  assert.equal(result.success, false);
});

test('orderSchema exige dirección para entrega', () => {
  const result = orderSchema.safeParse({
    customer: { name: 'Juan', phone: '1128493108' },
    fulfillmentType: 'delivery',
    items: [{ pizzaId: 1, quantity: 2 }],
  });
  assert.equal(result.success, false);
});

test('orderSchema acepta un pedido válido', () => {
  const result = orderSchema.safeParse({
    customer: { name: 'Juan Pérez', phone: '+54 11 2849-3108', email: 'juan@ejemplo.com' },
    fulfillmentType: 'pickup',
    items: [{ pizzaId: 1, quantity: 2 }],
  });
  assert.equal(result.success, true);
});

test('orderSchema limita la cantidad por ítem', () => {
  const result = orderSchema.safeParse({
    customer: { name: 'Juan', phone: '1128493108' },
    fulfillmentType: 'pickup',
    items: [{ pizzaId: 1, quantity: 999 }],
  });
  assert.equal(result.success, false);
});

test('messageSchema exige mensaje', () => {
  assert.equal(messageSchema.safeParse({ name: 'Juan', message: '' }).success, false);
  assert.equal(
    messageSchema.safeParse({ name: 'Juan', message: 'Consulta por horarios' }).success,
    true,
  );
});

test('issueToken produce tokens únicos y hashToken es determinista', () => {
  const a = issueToken();
  const b = issueToken();
  assert.notEqual(a, b);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), hashToken(b));
  assert.equal(hashToken(a).length, 64);
});

test('health responde y reporta la base', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/health/' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().db, 'up');
  await app.close();
});

test('categorías responde con la lista', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/categories/' });
  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.json().categories));
  await app.close();
});

test('pizzas devuelve 404 para categoría inexistente', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/pizzas/?category=fantasma' });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test('ruta inexistente devuelve 404 en JSON', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'not_found');
  await app.close();
});

test('pedido inválido devuelve 400 con detalle de campos', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({
    method: 'POST',
    url: '/api/orders/',
    payload: { customer: { name: 'J' }, fulfillmentType: 'teletransporte', items: [] },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'validation_error');
  assert.ok(response.json().details.length > 0);
  await app.close();
});

test('/api/admin/orders exige sesión', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/api/admin/orders' });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('base caída responde 503 y no 500', async () => {
  const app = await buildApp({ logger: false });

  // El pool stub es un singleton a nivel de módulo: guardamos el original
  // para no contaminar los tests siguientes.
  const originalQuery = app.pool.query;
  const aggregate = new AggregateError(
    [Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' })],
    '',
  );
  aggregate.code = 'ECONNREFUSED';
  app.pool.query = async () => {
    throw aggregate;
  };

  try {
    const response = await app.inject({ method: 'GET', url: '/api/categories/' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'database_unavailable');

    const health = await app.inject({ method: 'GET', url: '/api/health/' });
    assert.equal(health.statusCode, 503);
    assert.equal(health.json().db, 'down');
  } finally {
    app.pool.query = originalQuery;
    await app.close();
  }
});

test('/api/admin/login/verify rechaza token inválido', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/login/verify',
    payload: { token: 'a'.repeat(43) },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});