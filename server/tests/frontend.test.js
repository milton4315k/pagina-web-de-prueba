// Tests del frontend: el módulo de mensajes de WhatsApp tiene que producir el
// mismo texto que server/src/lib/whatsapp.js, porque es el fallback que se usa
// cuando la API no responde.

import test from 'node:test';
import assert from 'node:assert/strict';

const wa = await import('../../js/wa.js');
const server = await import('../src/lib/whatsapp.js');

test('el número de WhatsApp coincide con el del server', () => {
  assert.equal(wa.WHATSAPP_NUMBER, '5491128493108');
});

test('whatsappUrl arma y escapa el mensaje', () => {
  const url = wa.whatsappUrl('hola & chau');
  assert.match(url, /^https:\/\/wa\.me\/5491128493108\?text=/);
  assert.match(url, /hola%20%26%20chau/);
});

test('whatsappUrl acepta otro número', () => {
  assert.match(wa.whatsappUrl('hola', '5499999999999'), /wa\.me\/5499999999999/);
});

test('buildContactMessage incluye todos los datos cargados', () => {
  const message = wa.buildContactMessage({
    name: 'Juan',
    order: '2 pepperonis',
    method: 'entrega',
    contact: '1128493108',
    notes: 'sin cebolla',
  });

  assert.match(message, /soy Juan/);
  assert.match(message, /2 pepperonis/);
  assert.match(message, /Entrega a domicilio/);
  assert.match(message, /Contacto: 1128493108/);
  assert.match(message, /sin cebolla/);
});

test('buildContactMessage omite los campos vacíos', () => {
  const message = wa.buildContactMessage({
    name: 'Juan',
    order: 'una margherita',
    method: 'consulta',
    contact: '',
    notes: '',
  });

  assert.match(message, /Modalidad: Consulta/);
  assert.equal(message.includes('Contacto:'), false);
  assert.equal(message.includes('Detalle:'), false);
});

test('buildContactMessage traduce las modalidades conocidas', () => {
  const retiro = wa.buildContactMessage({ name: 'A', order: 'B', method: 'retiro' });
  assert.match(retiro, /Retiro en el local/);

  const desconocida = wa.buildContactMessage({ name: 'A', order: 'B', method: 'inventada' });
  assert.match(desconocida, /Modalidad: inventada/);

  const vacia = wa.buildContactMessage({ name: 'A', order: 'B', method: '' });
  assert.match(vacia, /Modalidad: una consulta/);
});

test('los precios se formatean igual que en el server', () => {
  for (const value of [0, 15500, 19500, 1234567]) {
    assert.equal(wa.formatPrice(value), server.formatPrice(value), `precio ${value}`);
  }
  assert.equal(wa.formatPrice(15500), '$15.500');
});
