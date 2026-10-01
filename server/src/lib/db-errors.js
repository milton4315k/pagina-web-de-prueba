/**
 * Detecta fallos de conexión a Postgres para responder 503 en vez de 500.
 *
 * Cubre los códigos de error del socket (la base no está escuchando) y los de
 * pg cuando la conexión existe pero no se puede usar (pooler saturado, timeout,
 * DNS caído en Supabase).
 */
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
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001',
  '08004',
]);

function collectCodes(error, found = new Set()) {
  if (!error) return found;

  if (typeof error.code === 'string') found.add(error.code);
  for (const nested of error.errors ?? [error.aggregateErrors, error.cause]) {
    if (Array.isArray(nested)) nested.forEach((item) => collectCodes(item, found));
    else if (nested && nested !== error) collectCodes(nested, found);
  }

  return found;
}

export function isDatabaseError(error) {
  if (!error) return false;
  const codes = collectCodes(error);

  if (codes.size === 0) return false;
  return [...codes].every((code) => SOCKET_CODES.has(code) || PG_CODES.has(code));
}