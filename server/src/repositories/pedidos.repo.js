import crypto from 'node:crypto';
import { pool, withTransaction } from '../db/pool.js';
import * as pizzasRepo from './pizzas.repo.js';
import { buildOrderMessage, buildWhatsappUrl, generateOrderCode } from '../lib/whatsapp.js';
import { memberCodeLabel } from '../lib/loyalty.js';
import { env } from '../config/env.js';

const BUSINESS_WHATSAPP = env.ADMIN_WHATSAPP;

/**
 * Crea cliente + pedido + items en una sola transacción y devuelve el link wa.me.
 *
 * Si viene `memberCode`, el pedido queda asociado al socio para que sus puntos
 * se acrediten al marcarlo entregado. Un código inválido no invalida el pedido.
 */
export async function create({ customer, items, fulfillmentType, address, notes, memberCode }) {
  return withTransaction(async (client) => {
    const pizzaIds = [...new Set(items.map((item) => item.pizzaId))];
    const pizzas = await pizzasRepo.getManyByIds(pizzaIds, client);
    const byId = new Map(pizzas.map((pizza) => [pizza.id, pizza]));

    const faltantes = pizzaIds.filter((id) => !byId.has(id));
    if (faltantes.length) {
      const error = new Error(`Pizzas no disponibles: ${faltantes.join(', ')}`);
      error.statusCode = 422;
      error.expose = true;
      throw error;
    }

    // Snapshot de precio y nombre desde la base, nunca desde el cliente.
    const orderItems = items.map((item) => {
      const pizza = byId.get(item.pizzaId);
      return {
        pizzaId: pizza.id,
        name: pizza.name,
        unitPrice: pizza.price,
        quantity: item.quantity,
        subtotal: pizza.price * item.quantity,
      };
    });

    const totalAmount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);

    const customerResult = await client.query(
      `INSERT INTO customers (name, phone, email, notes, source)
       VALUES ($1, $2, $3, $4, 'whatsapp')
       RETURNING id`,
      [customer.name, customer.phone, customer.email || null, customer.notes || null],
    );

    // Un código de socio desconocido no puede romper el pedido: se ignora.
    let memberId = null;
    if (memberCode) {
      const memberResult = await client.query(
        `SELECT id FROM members
          WHERE member_code = $1 AND is_active = TRUE`,
        [String(memberCode).trim().toUpperCase()],
      );
      memberId = memberResult.rows[0]?.id ?? null;
    }

    // Colisión de order_code es extremadamente improbable, pero la reintentamos.
    let order = null;
    for (let attempt = 0; attempt < 3 && !order; attempt += 1) {
      try {
        const result = await client.query(
          `INSERT INTO orders (order_code, customer_id, member_id, status, fulfillment_type, address, notes, total_amount)
           VALUES ($1, $2, $3, 'new', $4, $5, $6, $7)
           RETURNING id, order_code, fulfillment_type, address, notes, total_amount, created_at`,
          [
            generateOrderCode(),
            customerResult.rows[0].id,
            memberId,
            fulfillmentType,
            address || null,
            notes || null,
            totalAmount,
          ],
        );
        order = result.rows[0];
      } catch (error) {
        if (error.code !== '23505' || attempt === 2) throw error;
      }
    }

    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, pizza_id, name_snapshot, unit_price, quantity, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.pizzaId, item.name, item.unitPrice, item.quantity, item.subtotal],
      );
    }

    // Si el cliente es socio, el mensaje al local lleva su código: así el
    // pedido se ubica de un vistazo sin buscar por teléfono.
    const memberResult = memberId
      ? await client.query(`SELECT member_code, points FROM members WHERE id = $1`, [memberId])
      : { rows: [] };
    const member = memberResult.rows[0];

    const message = buildOrderMessage({
      order: {
        orderCode: order.order_code,
        totalAmount: order.total_amount,
        fulfillmentType: order.fulfillment_type,
        address: order.address,
        notes: order.notes,
      },
      customer,
      items: orderItems,
      member,
    });

    return {
      order: {
        orderCode: order.order_code,
        status: 'new',
        totalAmount: order.total_amount,
        createdAt: order.created_at,
      },
      member: member
        ? {
            memberCode: memberCodeLabel(member.member_code),
            points: member.points,
          }
        : null,
      // Se manda al número configurado como ADMIN_WHATSAPP, que actúa como central.
      whatsappUrl: buildWhatsappUrl(BUSINESS_WHATSAPP, message),
      message,
    };
  });
}

/** Solo estado: el endpoint público no expone PII. */
export async function getPublicStatus(orderCode) {
  const { rows } = await pool.query(
    `SELECT order_code, status, created_at FROM orders WHERE order_code = $1`,
    [orderCode],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    orderCode: row.order_code,
    status: row.status,
    createdAt: row.created_at,
  };
}