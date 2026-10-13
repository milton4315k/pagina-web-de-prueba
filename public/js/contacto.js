// Formulario de contacto: guarda el mensaje en la API, asocia el pedido al
// pase del cliente si tiene uno, y después abre WhatsApp.
//
// El pedido no puede perderse aunque la API esté caída, así que el orden es:
// guardar primero (best effort), mandar a WhatsApp siempre.

import { api } from './api.js';
import { buildContactMessage, openWhatsapp, whatsappUrl } from './wa.js';
import { buildOrderMessageWithPass, loadPassForOrder } from './pase.js';

const form = document.querySelector('[data-contact-form]');

if (form) {
  const statusLine = form.querySelector('[data-form-status]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = formData.get('name')?.toString().trim() || 'Un cliente';
    const order = formData.get('order')?.toString().trim() || 'un pedido';
    const methodValue = formData.get('method')?.toString().trim();
    const contact = formData.get('contact')?.toString().trim();
    const notes = formData.get('notes')?.toString().trim();

    // Si el cliente tiene pase en este dispositivo, el mensaje lo incluye.
    const pass = await loadPassForOrder();

    const message = pass
      ? buildOrderMessageWithPass({ pass, name, order, method: methodValue, contact, notes })
      : buildContactMessage({ name, order, method: methodValue, contact, notes });

    if (statusLine) statusLine.textContent = 'Preparando tu pedido…';

    // No bloqueamos la salida a WhatsApp si el guardado falla.
    try {
      await api.enviarMensaje({
        name,
        phone: contact || undefined,
        subject: `Pedido: ${order}`,
        message: notes || order,
      });
    } catch {
      // La API dormida o caída no puede frenar el pedido.
    }

    if (statusLine) statusLine.textContent = 'Te estamos llevando a WhatsApp…';
    openWhatsapp(whatsappUrl(message));
  });
}
