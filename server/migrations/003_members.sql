-- Up Migration
-- Pase Nocturno: socios, tokens de dispositivo y libro de movimientos.

CREATE TABLE members (
  id         SERIAL PRIMARY KEY,
  -- Aleatorio, no derivado del teléfono: si no, el código es adivinable.
  member_code TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  -- La identidad real del socio: es UNIQUE para que re-registrarse con el
  -- mismo número devuelva el pase existente en vez de duplicarlo.
  phone      TEXT NOT NULL UNIQUE,
  birthday   DATE,
  points     INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  -- El 10% de bienvenida se canjea una vez, aparte de los 20 puntos.
  welcome_redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX members_points_idx ON members (points DESC);
CREATE INDEX members_birthday_idx ON members (birthday);

-- Tokens de dispositivo. Guardamos el hash, nunca el token.
-- El token solo permite LEER el pase: los saldos se mueven por el panel.
CREATE TABLE member_devices (
  id         SERIAL PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX member_devices_member_idx ON member_devices (member_id);

-- Libro de movimientos. El saldo sin historial no es auditable.
CREATE TABLE loyalty_events (
  id           SERIAL PRIMARY KEY,
  member_id    INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  order_id     INTEGER REFERENCES orders (id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'welcome', 'purchase', 'redemption',
                 'birthday', 'manual_adjust', 'manual_revoke'
               )),
  points_delta INTEGER NOT NULL,
  note         TEXT,
  created_by   INTEGER REFERENCES staff (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX loyalty_events_member_idx ON loyalty_events (member_id, created_at DESC);
CREATE UNIQUE INDEX loyalty_events_order_unique
  ON loyalty_events (order_id, kind)
  WHERE order_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN member_id INTEGER REFERENCES members (id) ON DELETE SET NULL;

CREATE INDEX orders_member_idx ON orders (member_id);

-- Reusa set_updated_at() de la migración 001, no hace falta otra.
CREATE TRIGGER members_set_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS members_set_updated_at ON members;

DROP INDEX IF EXISTS orders_member_idx;
ALTER TABLE orders DROP COLUMN IF EXISTS member_id;

DROP TABLE IF EXISTS loyalty_events;
DROP TABLE IF EXISTS member_devices;
DROP TABLE IF EXISTS members;