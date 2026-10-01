import { pool } from '../db/pool.js';

export async function list({ unread = false, page = 1, perPage = 25 } = {}) {
  const offset = (page - 1) * perPage;
  const where = unread ? 'WHERE is_read = FALSE' : '';

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM contact_messages ${where}`,
  );
  const dataResult = await pool.query(
    `SELECT id, name, phone, email, subject, message,
            is_read AS "isRead", created_at AS "createdAt"
       FROM contact_messages ${where}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [perPage, offset],
  );

  return { messages: dataResult.rows, total: countResult.rows[0].total, page, perPage };
}

export async function markRead(id) {
  const { rows } = await pool.query(
    `UPDATE contact_messages SET is_read = TRUE WHERE id = $1
     RETURNING id, is_read AS "isRead"`,
    [id],
  );
  return rows[0] ?? null;
}

export async function unreadCount() {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM contact_messages WHERE is_read = FALSE',
  );
  return rows[0].total;
}