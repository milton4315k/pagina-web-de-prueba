import { pool } from './pool.js';

/** Verifica que la base responde. Usado por /api/health y por el login. */
export async function checkDatabase() {
  const startedAt = process.hrtime.bigint();
  await pool.query('SELECT 1');
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return Math.round(latencyMs * 100) / 100;
}