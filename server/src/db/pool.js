import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Stub para los tests: responde lo mínimo que necesitan las rutas sin tocar
 * una base real. Las agregaciones devuelven una fila con `total: 0`.
 */
function createStubPool() {
  const stubResult = (sql = '') => ({
    rows: /count\(/.test(sql) ? [{ total: 0 }] : [],
  });

  return {
    query: async (sql) => stubResult(sql),
    connect: async () => ({
      query: async (sql) => stubResult(sql),
      release() {},
    }),
    end: async () => {},
    on() {},
  };
}

export const pool =
  env.NODE_ENV === 'test'
    ? createStubPool()
    : new pg.Pool({
        connectionString: env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        // Supavisor en modo transaction no soporta prepared statements.
        options: '-c statement_mode=direct',
      });

if (env.NODE_ENV !== 'test') {
  pool.on('error', (error) => {
    console.error('[db] error en cliente ocioso:', error.message);
  });
}

/**
 * Ejecuta `fn` con un cliente dedicado envuelto en una transacción.
 * Revierte ante cualquier error y libera siempre el cliente.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] rollback falló:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}