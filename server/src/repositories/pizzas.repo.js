import { pool } from '../db/pool.js';

const SELECT_PIZZA = `
  SELECT p.id,
         p.slug,
         p.name,
         p.description,
         p.price,
         p.image_url   AS "imageUrl",
         p.ingredients,
         p.is_available AS "isAvailable",
         p.is_featured  AS "isFeatured",
         p.sort_order   AS "sortOrder",
         c.slug          AS category,
         c.name          AS "categoryName"
    FROM pizzas p
    JOIN categories c ON c.id = p.category_id`;

/**
 * @param {{ category?: string, featured?: boolean, available?: boolean }} filters
 */
export async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.category) {
    params.push(filters.category);
    conditions.push(`c.slug = $${params.length}`);
  }
  if (typeof filters.featured === 'boolean') {
    params.push(filters.featured);
    conditions.push(`p.is_featured = $${params.length}`);
  }
  if (typeof filters.available === 'boolean') {
    params.push(filters.available);
    conditions.push(`p.is_available = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `${SELECT_PIZZA} ${where} ORDER BY p.sort_order ASC, p.name ASC`,
    params,
  );
  return rows;
}

/**
 * Precios y disponibilidad de varias pizzas, dentro de una transacción.
 *
 * Usa placeholders generados (`IN ($1, $2, ...)`) en vez de `= ANY($1)`:
 * los ids siempre vienen de una consulta previa o del body ya validado por
 * zod, y así el plan de Postgres no cambia con la cantidad de pizzas.
 */
export async function getManyByIds(ids, client) {
  if (!ids.length) return [];
  const runner = client ?? pool;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const { rows } = await runner.query(
    `${SELECT_PIZZA} WHERE p.id IN (${placeholders}) AND p.is_available = TRUE`,
    ids,
  );
  return rows;
}

export async function listBySlug(slug) {
  const { rows } = await pool.query(`${SELECT_PIZZA} WHERE p.slug = $1`, [slug]);
  return rows[0] ?? null;
}