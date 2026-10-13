// Constructor de mensajes de WhatsApp del lado del navegador.
//
// Tiene que producir el mismo texto que server/src/lib/whatsapp.js. Si
// cambiás uno, cambiás el otro.

export const WHATSAPP_NUMBER = '5491128493108';
export const DEFAULT_MESSAGE = 'Hola Nocturna Pizza, quiero hacer un pedido.';

const METHOD_LABELS = {
  retiro: 'Retiro en el local',
  entrega: 'Entrega a domicilio',
  consulta: 'Consulta',
};

export const whatsappUrl = (message = DEFAULT_MESSAGE, phone = WHATSAPP_NUMBER) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

/** Mismo formato que server/src/lib/whatsapp.js. */
export const formatPrice = (value) =>
  `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)}`;

/** Mensaje del formulario de contacto. */
export function buildContactMessage({ name, order, method, contact, notes }) {
  return [
    `Hola Nocturna Pizza, soy ${name}.`,
    `Quiero hacer un pedido: ${order}.`,
    `Modalidad: ${METHOD_LABELS[method] || method || 'una consulta'}.`,
    contact ? `Contacto: ${contact}.` : '',
    notes ? `Detalle: ${notes}` : '',
    '¿Me confirmás disponibilidad y forma de pago?',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Abre WhatsApp y sobrevive al bloqueo de popups. */
export function openWhatsapp(url) {
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = url;
  return Boolean(opened);
}