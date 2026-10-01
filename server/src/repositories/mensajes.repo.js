import { pool } from '../db/pool.js';

export async function create(message) {
  const { rows } = await pool.query(
    `INSERT INTO contact_messages (name, phone, email, subject, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [
      message.name,
      message.phone || null,
      message.email || null,
      message.subject || null,
      message.message,
    ],
  );
  return rows[0];
}