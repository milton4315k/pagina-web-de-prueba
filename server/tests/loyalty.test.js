// Reglas del Pase Nocturno: umbrales, redondeo de puntos, ventana de
// cumpleaños y formato de teléfono. Sin base de datos.

import test from 'node:test';
import assert from 'node:assert/strict';

const loyalty = await import('../src/lib/loyalty.js');
const { RULES, BENEFITS } = loyalty;

test('los umbrales son los de la tabla de beneficios', () => {
  const porClave = Object.fromEntries(BENEFITS.map((b) => [b.key, b.threshold]));
  assert.equal(porClave.welcome, 0);
  assert.equal(porClave.drink, 50);
  assert.equal(porClave.margherita, 100);
  assert.equal(porClave.birthday, null, 'el cumpleaños no depende del saldo');
  assert.equal(RULES.welcomePoints, 20);
  assert.equal(RULES.pointsPerPeso, 1000);
});

test('los beneficios están ordenados de menor a mayor umbral', () => {
  const umbrales = BENEFITS.filter((b) => b.threshold !== null).map((b) => b.threshold);
  assert.deepEqual(umbrales, [...umbrales].sort((a, b) => a - b));
});

test('un peso es un punto cada mil, redondeando hacia abajo', () => {
  assert.equal(loyalty.pointsForOrder(999), 0);
  assert.equal(loyalty.pointsForOrder(1000), 1);
  assert.equal(loyalty.pointsForOrder(18400), 18, '$18.400 da 18, no 19');
  assert.equal(loyalty.pointsForOrder(15500), 15);
  assert.equal(loyalty.pointsForOrder(99999), 99);
});

test('un pedido sin plata o inválido no otorga puntos', () => {
  assert.equal(loyalty.pointsForOrder(0), 0);
  assert.equal(loyalty.pointsForOrder(-100), 0);
  assert.equal(loyalty.pointsForOrder(NaN), 0);
  assert.equal(loyalty.pointsForOrder(undefined), 0);
});

test('los beneficios se desbloquean por umbral de saldo', () => {
  assert.deepEqual(loyalty.unlockedBenefits(0).map((b) => b.key), ['welcome']);
  assert.deepEqual(loyalty.unlockedBenefits(20).map((b) => b.key), ['welcome']);
  assert.deepEqual(
    loyalty.unlockedBenefits(50).map((b) => b.key),
    ['welcome', 'drink'],
  );
  assert.deepEqual(
    loyalty.unlockedBenefits(100).map((b) => b.key),
    ['welcome', 'drink', 'margherita'],
  );
  assert.equal(loyalty.unlockedBenefits(500).length, 3, 'el cumpleaños no es por saldo');
});

test('el próximo beneficio es el primer umbral que falta', () => {
  assert.equal(loyalty.nextBenefit(0)?.key, 'drink');
  assert.equal(loyalty.nextBenefit(20)?.key, 'drink');
  assert.equal(loyalty.nextBenefit(49)?.key, 'drink');
  assert.equal(loyalty.nextBenefit(50)?.key, 'margherita');
  assert.equal(loyalty.nextBenefit(99)?.key, 'margherita');
  assert.equal(loyalty.nextBenefit(100), null, 'ya no queda nada por saldo');
  assert.equal(loyalty.nextBenefit(500), null);
});

test('los puntos que faltan son la distancia al próximo umbral', () => {
  assert.equal(loyalty.pointsToNextBenefit(0), 50);
  assert.equal(loyalty.pointsToNextBenefit(20), 30);
  assert.equal(loyalty.pointsToNextBenefit(50), 50);
  assert.equal(loyalty.pointsToNextBenefit(100), 0);
});

test('la barra va de 0 a 1 y sube entre umbrales', () => {
  // El primer tramo arranca en el umbral de bienvenida, no en cero.
  assert.equal(loyalty.progressToNextBenefit(0), 0);
  assert.ok(loyalty.progressToNextBenefit(25) > 0 && loyalty.progressToNextBenefit(25) < 1);
  assert.equal(loyalty.progressToNextBenefit(50), 0, 'recién cambió de tramo');
  assert.equal(loyalty.progressToNextBenefit(75), 0.5);
  assert.equal(loyalty.progressToNextBenefit(100), 1, 'no queda nada por alcanzar');
  assert.equal(loyalty.progressToNextBenefit(9999), 1);
});

test('el cumpleaños está activo en la semana del cumple, ni antes ni después', () => {
  const cumple = '1990-06-15';
  const year = 2026;

  assert.equal(loyalty.isBirthdayWindow(cumple, new Date(`${year}-06-15`)), true);
  assert.equal(loyalty.isBirthdayWindow(cumple, new Date(`${year}-06-12`)), true);
  assert.equal(loyalty.isBirthdayWindow(cumple, new Date(`${year}-06-18`)), true);
  assert.equal(loyalty.isBirthdayWindow(cumple, new Date(`${year}-06-11`)), false);
  assert.equal(loyalty.isBirthdayWindow(cumple, new Date(`${year}-06-19`)), false);
});

test('el cumpleaños se repite cada año y cruza el cambio de año', () => {
  assert.equal(loyalty.isBirthdayWindow('1990-01-02', new Date('2026-01-02')), true);
  assert.equal(loyalty.isBirthdayWindow('1990-12-31', new Date('2026-01-01')), true);
  assert.equal(loyalty.isBirthdayWindow('1990-01-01', new Date('2026-12-25')), false);
});

test('sin cumpleaños no hay beneficio de cumpleaños', () => {
  assert.equal(loyalty.isBirthdayWindow(null), false);
  assert.equal(loyalty.isBirthdayWindow('no-es-fecha'), false);
  assert.equal(loyalty.daysUntilBirthday(null), null);
  assert.equal(loyalty.daysUntilBirthday('no-es-fecha'), null);
});

test('los días hasta el cumpleaños hoy, mañana y el año que viene', () => {
  const year = 2026;
  assert.equal(loyalty.daysUntilBirthday('1990-06-15', new Date(`${year}-06-15`)), 0);
  assert.equal(loyalty.daysUntilBirthday('1990-06-20', new Date(`${year}-06-15`)), 5);
  assert.equal(loyalty.daysUntilBirthday('1990-06-10', new Date(`${year}-06-15`)), 360);
});

test('el código de socio es aleatorio y no sale del teléfono', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i += 1) codes.add(loyalty.generateMemberCode());

  assert.equal(codes.size, 200, 'no se repite en 200 intentos');
  for (const code of codes) {
    assert.match(code, /^#SOCIO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    // Sin 0, O, 1, I: son los que se confunden al dictatedor.
    assert.equal(/[01OI]/.test(code.slice(6)), false);
  }
});

test('el código se muestra sin el # para hablar con el cliente', () => {
  assert.equal(loyalty.memberCodeLabel('#SOCIO-4F2A9'), 'SOCIO-4F2A9');
});

test('los teléfonos se normalizan a 54 + número', () => {
  assert.equal(loyalty.normalizePhone('11 2849-3108'), '5491128493108');
  assert.equal(loyalty.normalizePhone('+54 9 11 2849-3108'), '5491128493108');
  assert.equal(loyalty.normalizePhone('+54 11 2849-3108'), '5491128493108');
  assert.equal(loyalty.normalizePhone('5491128493108'), '5491128493108');
  assert.equal(loyalty.normalizePhone('(011) 2849-3108'), '5491128493108');
  assert.equal(loyalty.normalizePhone('91128493108'), '5491128493108');
});

test('un teléfono vacío o sin dígitos se rechaza', () => {
  assert.equal(loyalty.normalizePhone(''), null);
  assert.equal(loyalty.normalizePhone('   '), null);
  assert.equal(loyalty.normalizePhone('abc'), null);
  assert.equal(loyalty.normalizePhone(null), null);
  assert.equal(loyalty.normalizePhone(undefined), null);
});

test('el mismo número escrito de tres formas da el mismo socio', () => {
  const formas = ['11 2849-3108', '+54 9 11 2849-3108', '5491128493108'];
  const normalizados = formas.map(loyalty.normalizePhone);
  assert.equal(new Set(normalizados).size, 1);
});
