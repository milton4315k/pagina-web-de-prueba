// Migración 002: staff y sesiones del panel.
// Se ejecuta con: npx node-pg-migrate up

export const shorthands = undefined;

export async function up(pgm) {
  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS staff (
      id           SERIAL PRIMARY KEY,
      whatsapp     TEXT NOT NULL UNIQUE,
      display_name TEXT,
      role         TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_login_tokens (
      id         SERIAL PRIMARY KEY,
      staff_id   INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS admin_login_tokens_expires_idx
      ON admin_login_tokens (expires_at DESC);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id         SERIAL PRIMARY KEY,
      staff_id   INTEGER NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
      ON admin_sessions (expires_at DESC);
  `);
}

export async function down(pgm) {
  await pgm.sql(`
    DROP TABLE IF EXISTS admin_sessions;
    DROP TABLE IF EXISTS admin_login_tokens;
    DROP TABLE IF EXISTS staff;
  `);
}