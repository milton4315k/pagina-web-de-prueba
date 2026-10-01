import { env } from '../config/env.js';

const METHOD_LABELS = {
  pickup: 'Retiro en el local',
  delivery: 'Entrega a domicilio',
};

export const formatPrice = (value) => `$${new Intl.NumberFormat('es-AR').format(value)}`;

/** Código corto para que el local pueda rastrear el pedido en el chat. */
export function generateOrderCode() {
  // Sin 0/O/1/I para evitar confusiones al dictatedor.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `NP-${suffix}`;
}

/**
 * Arma el texto que el cliente ve en WhatsApp.
 * El total lo calcula el servidor; el cliente nunca manda precios.
 *
 * Si `member` viene, se incluye el código de socio para que el local lo
 * ubique de un vistazo y sepa que hay puntos acumulados.
 */
export function buildOrderMessage({ order, customer, items, member = null }) {
  const lines = [
    `Hola Nocturna Pizza, soy ${customer.name}.`,
    `Pedido: ${order.orderCode}`,
    '',
  ];

  for (const item of items) {
    lines.push(`• ${item.quantity}x ${item.name} — ${formatPrice(item.unitPrice)} c/u`);
  }

  lines.push('', `Total: ${formatPrice(order.totalAmount)}`);
  lines.push(`Modalidad: ${METHOD_LABELS[order.fulfillmentType] ?? order.fulfillmentType}`);

  if (order.fulfillmentType === 'delivery' && order.address) {
    lines.push(`Dirección: ${order.address}`);
  }
  if (customer.phone) lines.push(`Contacto: ${customer.phone}`);
  if (order.notes) lines.push(`Detalle: ${order.notes}`);

  if (member) {
    lines.push('', `Pase Nocturno: ${String(member.member_code).replace('#', '')}`);
  }

  lines.push('', `Ref. ${order.orderCode}`);

  return lines.join('\n');
}

/**
 * Mensaje del login del panel. El owner se lo manda a sí mismo por WhatsApp,
 * así que el link viaja por el chat y no por email.
 *
 * @param {{ token: string }} params
 */
export function buildLoginMessage({ token }) {
  return [
    'Hola Nocturna Pizza. Soy el owner.',
    'Quiero entrar al panel.',
    '',
    'Entrá con este link:',
    `${env.PUBLIC_SITE_URL}/admin/authorize.html?t=${token}`,
    '',
    'El link vence en 15 minutos y se puede usar una sola vez.',
  ].join('\n');
}

export function buildWhatsappUrl(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}