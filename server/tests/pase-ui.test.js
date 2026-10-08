// El Pase Nocturno del lado del navegador: los mismos umbrales y el mismo
// formato de precios que server/src/lib/loyalty.js.
//
// Si cambiás una regla, cambiala en los dos lados.

import test from 'node:test';
import assert from 'node:assert/strict';

const loyalty = await import('../src/lib/loyalty.js');
const whatsapp = await import('../src/lib/whatsapp.js');
const { RULES: SERVER_RULES, BENEFITS: SERVER_BENEFITS, pointsForOrder } = loyalty;

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};

const pase = await import('../../js/pase.js');

const STORAGE_KEY = 'nocturna_pase';

test('las reglas del pase coinciden con las del server', () => {
  assert.equal(pase.PASSE_RULES.welcomePoints, SERVER_RULES.welcomePoints);
  assert.equal(pase.PASSE_RULES.pointsPerPeso, SERVER_RULES.pointsPerPeso);

  const server = SERVER_BENEFITS.map((b) => [b.key, b.threshold, b.label]);
  const browser = pase.PASSE_RULES.benefits.map((b) => [b.key, b.threshold, b.label]);
  assert.deepEqual(browser, server);
});

test('el localStorage guarda solo el token, no el saldo', () => {
  storage.clear();
  pase.saveToken('token-secreto-123');

  const guardado = localStorage.getItem(STORAGE_KEY);
  assert.equal(guardado, 'token-secreto-123');

  // Lo que se guarda es un string opaco: ni nombre, ni puntos, ni código.
  assert.equal(guardado.includes('puntos'), false);
  assert.equal(guardado.includes('points'), false);
  assert.equal(pase.hasToken(), true);

  pase.clearToken();
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
  assert.equal(pase.hasToken(), false);
});

test('sin token no hay pase, y fetchPass no rompe', async () => {
  storage.clear();
  assert.equal(pase.hasToken(), false);
  assert.equal(await pase.fetchPass(), null);
  assert.equal(await pase.loadPassForOrder(), null);
});

test('el precio se formatea con separador de miles, igual que en el server', () => {
  for (const value of [0, 1000, 15500, 18400, 1234567]) {
    assert.equal(pase.formatPrice(value), whatsapp.formatPrice(value), `precio ${value}`);
  }
  assert.equal(pase.formatPrice(1000), '$1.000');
});

test('escapeHtml escapa lo que puede romper el HTML', () => {
  assert.equal(pase.escapeHtml('<img src=x>'), '&lt;img src=x&gt;');
  assert.equal(pase.escapeHtml('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
  assert.equal(pase.escapeHtml(null), '');
});

test('el mensaje con pase incluye el código del socio', () => {
  const message = pase.buildOrderMessageWithPass({
    pass: {
      memberCodeLabel: 'SOCIO-4F2A9',
      name: 'Franco',
      birthdayActive: false,
      benefits: [{ key: 'welcome', available: true }],
    },
    name: 'Franco',
    order: '1 pepperoni',
    method: 'entrega',
    contact: '1128493108',
    notes: 'sin cebolla',
  });

  assert.match(message, /Hola! Soy Franco \(#SOCIO-4F2A9\)/);
  assert.match(message, /Quiero pedir: 1 pepperoni/);
  assert.match(message, /Entrega a domicilio/);
  assert.match(message, /10% OFF de bienvenida/);
  assert.equal(message.includes('cumpleaños'), false);
});

test('el mensaje pide el postre si es el cumpleaños del socio', () => {
  const message = pase.buildOrderMessageWithPass({
    pass: {
      memberCodeLabel: 'SOCIO-4F2A9',
      name: 'Ana',
      birthdayActive: true,
      benefits: [
        { key: 'welcome', available: false },
        { key: 'birthday', available: true },
      ],
    },
    name: 'Ana',
    order: 'una margherita',
    method: 'retiro',
  });

  assert.match(message, /postre sin cargo/);
  assert.equal(message.includes('10% OFF'), false, 'el 10% ya canjeado no se pide');
});

test('sin beneficio disponible el mensaje solo lleva el pedido', () => {
  const message = pase.buildOrderMessageWithPass({
    pass: { memberCodeLabel: 'SOCIO-1', name: 'Luis', birthdayActive: false, benefits: [] },
    name: 'Luis',
    order: '2 funghi',
    method: 'consulta',
  });

  assert.match(message, /#SOCIO-1/);
  assert.equal(message.includes('OFF'), false);
  assert.equal(message.includes('postre'), false);
});

test('los mensajes no dejan líneas vacías', () => {
  const message = pase.buildOrderMessageWithPass({
    pass: { memberCodeLabel: 'SOCIO-2', name: 'Sol', birthdayActive: false, benefits: [] },
    name: 'Sol',
    order: 'una',
    method: '',
    contact: '',
    notes: '',
  });

  assert.equal(message.includes('\n\n'), false);
  assert.equal(message.includes('undefined'), false);
});

test('el botón del pase está en el HTML de las tres páginas', async () => {
  // Sin JS el pase tiene que seguir siendo visible: el botón es estático.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );

  for (const page of ['index.html', 'menu.html', 'contacto.html']) {
    const html = await readFile(path.join(root, page), 'utf8');

    assert.match(html, /data-pase-trigger/, `${page} no tiene el botón del pase`);
    assert.match(html, /nav-actions/, `${page} no tiene el contenedor .nav-actions`);

    // El botón tiene que estar FUERA de .nav-links, que en celular es el
    // desplegable del hamburguesa y arranca oculto.
    const navLinks = html.slice(html.indexOf('class="nav-links"'));
    const navLinksEnd = navLinks.indexOf('</div>');
    assert.equal(
      navLinks.slice(0, navLinksEnd).includes('data-pase-trigger'),
      false,
      `${page}: el botón del pase quedó dentro del desplegable de mobile`,
    );
  }
});

test('las tres páginas ofrecen el pase sin JavaScript', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  for (const page of ['index.html', 'menu.html', 'contacto.html']) {
    const html = await readFile(path.join(root, page), 'utf8');
    assert.match(html, /<noscript>[\s\S]*Pase Nocturno/, `${page} sin fallback noscript`);
  }
});

test('js/pase-ui.js y js/contacto.js se pueden importar enteros', async () => {
  // Si un import pide un nombre que pase.js no exporta, el navegador aborta el
  // módulo ANTES de ejecutar una línea: el botón del pase queda mudo y el único
  // rastro es un SyntaxError en la consola. Importarlos acá resuelve el link,
  // así que un nombre que falta hace fallar este test.
  globalThis.document ??= {
    createElement: () => ({}),
    head: { append: () => {} },
    body: { append: () => {} },
    querySelector: () => null,
  };
  // api.js decide la base de la API con window.location.
  globalThis.window ??= { location: { hostname: 'localhost', port: '4173' } };

  await import('../../js/pase-ui.js');
  await import('../../js/contacto.js');
});

test('el botón del pase tiene fallback a WhatsApp si el módulo no carga', async () => {
  // El contrato entre script.js y js/pase-ui.js: el módulo marca el botón
  // como propio solo cuando quedó montado; sin esa marca, script.js manda
  // a WhatsApp en vez de dejar el botón mudo.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  const script = await readFile(path.join(root, 'script.js'), 'utf8');
  const paseUi = await readFile(path.join(root, 'js', 'pase-ui.js'), 'utf8');

  assert.match(script, /nocturnaPaseFallback/, 'script.js no expone el fallback');
  assert.match(script, /data-pase-ready/, 'script.js no chequea la marca del módulo');
  assert.match(paseUi, /nocturnaPaseFallback/, 'pase-ui.js no usa el fallback');
  assert.match(paseUi, /data-pase-ready/, 'pase-ui.js no marca el botón como propio');
});

test('la UI calcula los mismos puntos por pedido', () => {
  // La barra del pase y la acreditación usan la misma regla.
  assert.equal(pointsForOrder(18400), 18);
  assert.equal(SERVER_RULES.pointsPerPeso, pase.PASSE_RULES.pointsPerPeso);
});
