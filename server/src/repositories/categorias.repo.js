import { pool } from '../db/pool.js';

export async function listCategories({ onlyActive = true } = {}) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, sort_order AS "sortOrder"
       FROM categories
      WHERE ($1::boolean IS FALSE OR is_active)
      ORDER BY sort_order ASC, name ASC`,
    [onlyActive],
  );
  return rows;
}

export async function listBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, sort_order AS "sortOrder" FROM categories WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}