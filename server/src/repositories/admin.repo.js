import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { buildLoginMessage, buildWhatsappUrl } from '../lib/whatsapp.js';

const TOKEN_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 7;
export const SESSION_COOKIE = 'nocturna_session';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function issueToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Crea un token de un solo uso y devuelve el link wa.me para que el owner
 * se lo mande a sí mismo. Guardamos solo el hash.
 */
export async function requestLogin() {
  const staffResult = await pool.query(
    `INSERT INTO staff (whatsapp, display_name, role)
     VALUES ($1, 'Owner', 'owner')
     ON CONFLICT (whatsapp) DO UPDATE SET whatsapp = EXCLUDED.whatsapp
     RETURNING id`,
    [env.ADMIN_WHATSAPP],
  );
  const staff = staffResult.rows[0];

  const token = issueToken();

  await pool.query(
    `INSERT INTO admin_login_tokens (staff_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [staff.id, hashToken(token), String(TOKEN_TTL_MINUTES)],
  );

  // Limpieza oportunista de tokens vencidos.
  await pool.query(
    `DELETE FROM admin_login_tokens WHERE expires_at < now() - interval '1 day'`,
  );

  return {
    whatsappUrl: buildWhatsappUrl(env.ADMIN_WHATSAPP, buildLoginMessage({ token })),
    expiresInMinutes: TOKEN_TTL_MINUTES,
  };
}

/** Canjea un token válido por una sesión. */
export async function verifyLogin(token) {
  const tokenHash = hashToken(token);

  const result = await pool.query(
    `UPDATE admin_login_tokens
        SET used_at = now()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING staff_id`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;

  const sessionToken = issueToken();
  await pool.query(
    `INSERT INTO admin_sessions (staff_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [row.staff_id, hashToken(sessionToken), String(SESSION_TTL_DAYS)],
  );

  const staffResult = await pool.query(
    `SELECT id, whatsapp, display_name, role FROM staff WHERE id = $1`,
    [row.staff_id],
  );

  return { sessionToken, staff: staffResult.rows[0] };
}

/** Resuelve la sesión desde la cookie o el header Bearer (para curl). */
export async function resolveSession(rawToken) {
  if (!rawToken) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.expires_at, st.id AS staff_id, st.whatsapp,
            st.display_name, st.role
       FROM admin_sessions s
       JOIN staff st ON st.id = s.staff_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(rawToken)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.id,
    staff: {
      id: row.staff_id,
      whatsapp: row.whatsapp,
      displayName: row.display_name,
      role: row.role,
    },
  };
}

export async function destroySession(rawToken) {
  if (!rawToken) return;
  await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(rawToken)]);
}

export function sessionCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}