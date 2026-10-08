// Cliente del Pase Nocturno para el frontend público.
//
// El device_token se guarda en localStorage, pero NO es la fuente de verdad:
// los puntos siempre se leen de la API. Editar localStorage no cambia el saldo.

const STORAGE_KEY = 'nocturna_pase';
const API_BASE = '/api/members';
const TIMEOUT = 8000;

/** Configuración pública del pase. La usa la UI, no la lógica de negocio. */
export const PASSE_RULES = {
  welcomePoints: 20,
  pointsPerPeso: 1000,
  benefits: [
    { key: 'welcome', threshold: 0, label: '10% OFF en tu primer pedido' },
    { key: 'drink', threshold: 50, label: 'Fainá o bebida a elección' },
    { key: 'margherita', threshold: 100, label: 'Nocturna Margherita gratis' },
    { key: 'birthday', threshold: null, label: 'Postre de la casa sin cargo' },
  ],
};

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

/** Igual que server/src/lib/whatsapp.js: incluye el signo. */
export const formatPrice = (value) =>
  `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)}`;

export const formatBirthday = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
};

// --- Token local ---------------------------------------------------------

/** Guarda solo el token. El nombre y los puntos nunca se guardan. */
export function saveToken(token) {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Modo privado o sin permiso: el pase funciona igual en esta sesión.
  }
}

export function getToken() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada que hacer.
  }
}

export const hasToken = () => Boolean(getToken());

// --- API -----------------------------------------------------------------

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
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

/**
 * Registra al cliente. Si el teléfono ya estaba dado de alta, la API devuelve
 * el pase existente: el token se guarda igual y el saldo real se ve después.
 */
export async function register({ name, phone, birthday }) {
  const data = await request('/', {
    method: 'POST',
    body: {
      name,
      phone,
      birthday: birthday || '',
      deviceLabel: navigator.userAgent.slice(0, 120),
    },
  });

  saveToken(data.token);
  return { pass: data.pass, created: data.created };
}

/** Trae el pase real. Devuelve null si el token no sirve o la API está caída. */
export async function fetchPass() {
  if (!getToken()) return null;
  try {
    const { pass } = await request('/me', { auth: true });
    return pass;
  } catch (error) {
    // 401: el token no corresponde a nadie. Lo sacamos para no reintentar.
    if (error.status === 401) clearToken();
    return null;
  }
}

/**
 * Igual que fetchPass pero no limpia el token ante un 401.
 * Para armar un mensaje de pedido aunque el pase ya no exista.
 */
export async function loadPassForOrder() {
  if (!getToken()) return null;
  try {
    const { pass } = await request('/me', { auth: true });
    return pass;
  } catch {
    return null;
  }
}

/** Pide un beneficio. No lo consume: lo confirmás vos desde el panel. */
export async function requestRedemption(benefitKey, notes = '') {
  return request('/redeem', {
    method: 'POST',
    auth: true,
    body: { benefit: benefitKey, notes },
  });
}

/** Reenvía el código de socio por WhatsApp, útil si perdió el dispositivo. */
export async function resendCode() {
  return request('/request-code', { method: 'POST', auth: true });
}

// --- Mensaje de pedido con el pase ---------------------------------------

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
    benefit('birthday')?.available
      ? 'Hoy es mi cumpleaños, quiero el postre sin cargo.'
      : '',
    contact ? `Contacto: ${contact}.` : '',
    notes ? `Detalle: ${notes}` : '',
    '¿Me confirmás disponibilidad y forma de pago?',
  ]
    .filter(Boolean)
    .join('\n');
}