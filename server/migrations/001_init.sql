-- Up Migration
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------

CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pizzas (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- Pesos argentinos, sin centavos: entero.
  price        INTEGER NOT NULL CHECK (price >= 0),
  image_url    TEXT,
  ingredients  TEXT NOT NULL DEFAULT '',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pizzas_category_id_idx ON pizzas (category_id);
CREATE INDEX pizzas_available_order_idx ON pizzas (is_available, sort_order);

-- ---------------------------------------------------------------
-- Clientes y pedidos
-- ---------------------------------------------------------------

CREATE TABLE customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT,
  source     TEXT NOT NULL DEFAULT 'whatsapp'
               CHECK (source IN ('whatsapp', 'contact_form')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customers_phone_idx ON customers (phone);

CREATE TABLE orders (
  id               SERIAL PRIMARY KEY,
  order_code       TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'confirmed', 'preparing',
                                       'out_for_delivery', 'delivered', 'cancelled')),
  fulfillment_type TEXT NOT NULL
                     CHECK (fulfillment_type IN ('pickup', 'delivery')),
  address          TEXT,
  notes            TEXT,
  total_amount     INTEGER NOT NULL CHECK (total_amount >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  -- NULL si la pizza se elimina del menú: el snapshot conserva el pedido.
  pizza_id      INTEGER REFERENCES pizzas (id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  unit_price    INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  subtotal      INTEGER NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);

-- ---------------------------------------------------------------
-- Mensajes del formulario de contacto
-- ---------------------------------------------------------------

CREATE TABLE contact_messages (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  subject    TEXT,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX contact_messages_unread_idx ON contact_messages (is_read, created_at DESC);

-- ---------------------------------------------------------------
-- Actualización automática de updated_at
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pizzas_set_updated_at
  BEFORE UPDATE ON pizzas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
DROP TRIGGER IF EXISTS pizzas_set_updated_at ON pizzas;
DROP FUNCTION IF EXISTS set_updated_at();

DROP TABLE IF EXISTS contact_messages;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS pizzas;
DROP TABLE IF EXISTS categories;