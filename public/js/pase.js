// Cliente del Pase Nocturno para el frontend público.
//
// La identidad ahora es la cuenta de Google del usuario (Supabase Auth). El
// navegador manda el access token de Supabase en el header Authorization y el
// servidor lo valida. Los puntos SIEMPRE se leen de la API: el navegador no es
// fuente de verdad.

import {
  getAccessToken,
  getSession,
  loadConfig,
  signInWithGoogle,
  signOut,
} from './supabase.js';

const API_BASE = '/api/members';
const TIMEOUT = 12000;

/** Configuración pública del pase. La usa la UI, no la lógica de negocio. */
export const PASSE_RULES = {
  welcomePoints: 20,
  pointsPerPeso: 1000,
  benefits: [
    { key: 'welcome', threshold: 0, label: '10% OFF en tu primer pedido' },
    { key: 'drink', threshold: 50, label: 'Fainá o bebida a elección' },
    { key: 'margherita', threshold: 100, label: 'Margherita gratis' },
    { key: 'birthday', threshold: null, label: 'Mini torta de la casa (el día de tu cumple, con tu compra)' },
  ],
};

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

/** Igual que el servidor: incluye el signo. */
export const formatPrice = (value) =>
  `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)}`;

export const formatBirthday = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
};

export { signInWithGoogle, signOut };

export async function isLoggedIn() {
  return Boolean(await getSession());
}

/** ¿Está configurado el login en el servidor? */
export async function loginConfigured() {
  const config = await loadConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

// --- API -----------------------------------------------------------------

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = new Error(data.message || `Error ${response.status}`);
      error.status = response.status;
      error.code = data.error;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('La conexión tardó demasiado. Probá de nuevo.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Trae el pase del usuario logueado. Devuelve null si no hay sesión o falla. */
export async function fetchPass() {
  if (!(await getSession())) return null;
  try {
    const data = await request('/me');
    return { pass: data.pass, created: Boolean(data.created) };
  } catch (error) {
    if (error.status === 401) await signOut().catch(() => {});
    return null;
  }
}

/** Completa o corrige el perfil del socio (nombre, WhatsApp, cumpleaños). */
export async function updateProfile({ name, phone, birthday }) {
  const data = await request('/me', {
    method: 'PATCH',
    body: { name, phone, birthday: birthday || '' },
  });
  return data.pass;
}

/** Pide un beneficio. No lo consume: lo confirmás vos desde el panel. */
export async function requestRedemption(benefitKey, notes = '') {
  return request('/redeem', { method: 'POST', body: { benefit: benefitKey, notes } });
}

/** Manda el código de socio al WhatsApp del local. */
export async function resendCode() {
  return request('/request-code', { method: 'POST' });
}

// --- Mensaje de pedido con el pase ---------------------------------------

/**
 * Igual que fetchPass pero sin cerrar sesión ante un error.
 * Para armar un mensaje de pedido aunque el pase no cargue.
 */
export async function loadPassForOrder() {
  if (!(await getSession())) return null;
  try {
    const data = await request('/me');
    return data.pass;
  } catch {
    return null;
  }
}

/**
 * Arma el mensaje de pedido del cliente, con su código de socio.
 * Lo usa el formulario de contacto si el cliente tiene pase.
 */
export function buildOrderMessageWithPass({ pass, name, order, method, contact, notes }) {
  const METHOD_LABELS = {
    retiro: 'Retiro en el local',
    entrega: 'Entrega a domicilio',
    consulta: 'Consulta',
  };

  const benefit = (key) => pass.benefits?.find((item) => item.key === key);

  return [
    `Hola! Soy ${name} (#${pass.memberCodeLabel}).`,
    `Quiero pedir: ${order}.`,
    `Modalidad: ${METHOD_LABELS[method] || method || 'una consulta'}.`,
    benefit('welcome')?.available ? 'Quiero canjear mi 10% OFF de bienvenida.' : '',
    benefit('birthday')?.available ? 'Hoy es mi cumpleaños, quiero la mini torta de regalo.' : '',
    contact ? `Contacto: ${contact}.` : '',
    notes ? `Detalle: ${notes}` : '',
    '¿Me confirmás disponibilidad y forma de pago?',
  ]
    .filter(Boolean)
    .join('\n');
}
