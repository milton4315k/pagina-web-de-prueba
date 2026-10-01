/**
 * Reglas del Pase Nocturno.
 *
 * Todo el cálculo de puntos vive acá. Si un umbral o una regla cambia, se
 * cambia en este archivo y en ningún otro lado.
 */

export const RULES = {
  /** Puntos de bienvenida al registrarse. El 10% es aparte. */
  welcomePoints: 20,
  /** $1.000 consumidos = 1 punto. */
  pointsPerPeso: 1000,
  /**
   * La "semana del cumpleaños" va de 3 días antes a 3 días después.
   * Simétrica para que al cliente no le sirva de nada esperar al día exacto.
   */
  birthdayWindowBefore: 3,
  birthdayWindowAfter: 3,
};

/**
 * Beneficios ordenados de menor a mayor umbral. `birthday` no tiene umbral:
 * depende de la fecha, no del saldo.
 */
export const BENEFITS = [
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
    label: 'Nocturna Margherita gratis',
    description: 'Canjeás los 100 puntos por una pizza.',
  },
  {
    key: 'birthday',
    threshold: null,
    label: 'Postre de la casa sin cargo',
    description: 'Válido durante la semana de tu cumpleaños.',
  },
];

/** Puntos que otorga un pedido. Redondea hacia abajo. */
export function pointsForOrder(totalAmount) {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 0;
  return Math.floor(totalAmount / RULES.pointsPerPeso);
}

/** Beneficios que el saldo actual alcanza, en orden. */
export function unlockedBenefits(points) {
  return BENEFITS.filter(
    (benefit) => benefit.threshold !== null && points >= benefit.threshold,
  );
}

/** El próximo beneficio por saldo, o null si ya están todos. */
export function nextBenefit(points) {
  return (
    BENEFITS.find(
      (benefit) => benefit.threshold !== null && points < benefit.threshold,
    ) ?? null
  );
}

/** Puntos que faltan para el próximo umbral, o 0 si no hay más. */
export function pointsToNextBenefit(points) {
  const next = nextBenefit(points);
  return next ? Math.max(0, next.threshold - points) : 0;
}

/** Progreso 0..1 hacia el próximo umbral. */
export function progressToNextBenefit(points) {
  const next = nextBenefit(points);
  if (!next) return 1;
  // El primer tramo no arranca en 0: 0 puntos ya tiene el beneficio de
  // bienvenida, así que la barra arranca en ese umbral.
  const previous = [...BENEFITS]
    .filter((benefit) => benefit.threshold !== null && benefit.threshold < next.threshold)
    .at(-1);
  const from = previous?.threshold ?? 0;
  const span = next.threshold - from;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - from) / span));
}

/**
 * ¿Está dentro de la ventana de cumpleaños?
 *
 * Compara mes y día, no año: un cumpleaños no caduca, se repite cada año.
 * `reference` es inyectable para poder testear sin depender de la fecha.
 */
export function isBirthdayWindow(birthday, reference = new Date()) {
  if (!birthday) return false;

  const date = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );

  // Probamos cada día de la ventana, en ambos sentidos.
  const offsets = [];
  for (let day = -RULES.birthdayWindowBefore; day <= RULES.birthdayWindowAfter; day += 1) {
    offsets.push(day);
  }

  return offsets.some((offset) => {
    const candidate = new Date(today);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    return (
      candidate.getUTCMonth() === date.getUTCMonth() &&
      candidate.getUTCDate() === date.getUTCDate()
    );
  });
}

/** Días que faltan para el próximo cumpleaños (0 si es hoy). */
export function daysUntilBirthday(birthday, reference = new Date()) {
  if (!birthday) return null;

  const date = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );
  let next = new Date(
    Date.UTC(today.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  if (next < today) {
    next = new Date(
      Date.UTC(today.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate()),
    );
  }

  return Math.round((next - today) / 86400000);
}

/** Código de socio legible y no adivinable: #SOCIO-4F2A9 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMemberCode() {
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `#SOCIO-${suffix}`;
}

/** Código con el prefijo para hablar con el cliente: "SOCIO-4F2A9" */
export const memberCodeLabel = (memberCode) => memberCode.replace('#', '');

/**
 * Normaliza un teléfono a dígitos con prefijo 54.
 * Los clientes escriben "+54 9 11 2849-3108" o "11 2849-3108" o lo que sea.
 */
export function normalizePhone(input) {
  const raw = String(input ?? '').replace(/\D/g, '');
  if (!raw) return null;

  // 011-2849-3108 y 01128493108 son el mismo número que 1128493108.
  const local = raw.startsWith('0') ? raw.slice(1) : raw;

  // Sacamos el código de país si está.
  const rest = local.startsWith('54') ? local.slice(2) : local;

  // Los móviles argentinos llevan un 9 después del 54: 549 11 ...
  // Como el prefijo identifica igual a la persona, lo normalizamos siempre
  // para que "11 2849-3108" y "+54 9 11 2849-3108" den el mismo socio.
  return rest.startsWith('9') ? `54${rest}` : `549${rest}`;
}
