import { pool, withTransaction } from '../db/pool.js';
import { pointsForOrder } from '../lib/loyalty.js';

const STATUSES = [
  'new',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

export { STATUSES };

export async function list({ status, from, to, page = 1, perPage = 25 } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`o.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`o.created_at < ($${params.length}::date + interval '1 day')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * perPage;

  const countResult = await pool.query(`SELECT count(*)::int AS total FROM orders o ${where}`, params);
  const dataResult = await pool.query(
    `SELECT o.id,
            o.order_code      AS "orderCode",
            o.status,
            o.fulfillment_type AS "fulfillmentType",
            o.address,
            o.notes,
            o.total_amount    AS "totalAmount",
            o.created_at      AS "createdAt",
            o.updated_at      AS "updatedAt",
            c.name            AS "customerName",
            c.phone           AS "customerPhone",
            m.member_code     AS "memberCode",
            m.name            AS "memberName",
            COALESCE(sum(i.quantity), 0)::int AS "itemCount"
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_items i ON i.order_id = o.id
       LEFT JOIN members m ON m.id = o.member_id
       ${where}
      GROUP BY o.id, c.name, c.phone, m.member_code, m.name
      ORDER BY o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset],
  );

  return {
    orders: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    perPage,
  };
}

export async function getById(id) {
  const orderResult = await pool.query(
    `SELECT o.id,
            o.order_code      AS "orderCode",
            o.status,
            o.fulfillment_type AS "fulfillmentType",
            o.address,
            o.notes,
            o.total_amount    AS "totalAmount",
            o.created_at      AS "createdAt",
            o.updated_at      AS "updatedAt",
            c.name            AS "customerName",
            c.phone           AS "customerPhone",
            c.email           AS "customerEmail",
            m.member_code     AS "memberCode",
            m.name            AS "memberName",
            m.points          AS "memberPoints"
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN members m ON m.id = o.member_id
      WHERE o.id = $1`,
    [id],
  );

  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT id, name_snapshot AS "name", unit_price AS "unitPrice",
            quantity, subtotal
       FROM order_items WHERE order_id = $1 ORDER BY id`,
    [id],
  );

  return { ...order, items: itemsResult.rows };
}

/**
 * Cambia el estado de un pedido.
 *
 * Volver a un estado anterior (por ejemplo, de `delivered` a `preparing`)
 * revierte los puntos acreditados: si el pedido ya no está entregado, el
 * cliente no los mendigó. Los eventos quedan en la tabla, así que el saldo
 * siempre se puede reconstruir.
 */
export async function updateStatus(id, status) {
  return withTransaction(async (client) => {
    const before = await client.query(
      `SELECT id, member_id AS "memberId", total_amount AS "totalAmount", status
         FROM orders WHERE id = $1`,
      [id],
    );
    const order = before.rows[0];
    if (!order) return null;

    const { rows } = await client.query(
      `UPDATE orders SET status = $1, updated_at = now()
        WHERE id = $2
        RETURNING id, order_code AS "orderCode", status, member_id AS "memberId",
                  updated_at AS "updatedAt"`,
      [status, id],
    );
    const updated = rows[0];

    if (!order.memberId) return updated;

    const wasDelivered = order.status === 'delivered';
    const isDelivered = status === 'delivered';

    if (isDelivered && !wasDelivered) {
      await accrueForOrder(client, order, updated.orderCode);
    } else if (!isDelivered && wasDelivered) {
      await revertAccrual(client, order.memberId, id);
    }

    return updated;
  });
}

/** Acredita los puntos de un pedido recién entregado, si no se acreditaron. */
async function accrueForOrder(client, order, orderCode) {
  const points = pointsForOrder(order.totalAmount);
  if (points <= 0) return;

  const existing = await client.query(
    `SELECT id FROM loyalty_events
      WHERE member_id = $1 AND order_id = $2 AND kind = 'purchase'`,
    [order.memberId, order.id],
  );
  if (existing.rows.length) return;

  await client.query(
    `INSERT INTO loyalty_events (member_id, order_id, kind, points_delta, note)
     VALUES ($1, $2, 'purchase', $3, $4)`,
    [order.memberId, order.id, points, `Pedido ${orderCode}`],
  );
  await client.query(
    `UPDATE members SET points = points + $1 WHERE id = $2`,
    [points, order.memberId],
  );
}

/**
 * Si el pedido deja de estar entregado, se da de baja el movimiento y se
 * descuenta. Los canjes ya consumidos no se tocan.
 *
 * El saldo se calcula en JS a propósito: GREATEST() sobre columnas con
 * parámetros no se comporta igual en todos los motores, y el CHECK
 * (points >= 0) sigue siendo la última línea de defensa.
 */
async function revertAccrual(client, memberId, orderId) {
  const { rows } = await client.query(
    `DELETE FROM loyalty_events
      WHERE member_id = $1 AND order_id = $2 AND kind = 'purchase'
      RETURNING points_delta`,
    [memberId, orderId],
  );

  const reverted = rows.reduce((sum, row) => sum + row.points_delta, 0);
  if (reverted === 0) return;

  const current = await client.query(`SELECT points FROM members WHERE id = $1`, [memberId]);
  const saldo = Math.max(0, (current.rows[0]?.points ?? 0) - reverted);

  await client.query(`UPDATE members SET points = $1 WHERE id = $2`, [saldo, memberId]);
}

/** Contadores por estado, para el resumen del panel. */
export async function countsByStatus() {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS total FROM orders GROUP BY status`,
  );
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}