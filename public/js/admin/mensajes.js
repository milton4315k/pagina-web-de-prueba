// Mensajes del formulario de contacto, con lectura y marcado de leídos.

import { adminApi } from './api.js';
import {
  clearError,
  escapeHtml,
  formatDate,
  logout,
  requireAuth,
  showError,
} from './auth.js';

const rows = document.querySelector('[data-rows]');
const emptyState = document.querySelector('[data-empty]');
const errorLine = document.querySelector('[data-error]');
const filtersForm = document.querySelector('[data-filters]');
const unreadBadge = document.querySelector('[data-unread-badge]');

const FILTERS = { unread: '' };

function contactCell(message) {
  const wa = message.phone
    ? `<a href="https://wa.me/${escapeHtml(message.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${escapeHtml(
        message.phone,
      )}</a>`
    : '<span class="cell-muted">—</span>';

  const mail = message.email
    ? `<div class="cell-muted"><a href="mailto:${escapeHtml(message.email)}">${escapeHtml(
        message.email,
      )}</a></div>`
    : '';

  return `${wa}${mail}`;
}

function rowTemplate(message) {
  const className = message.isRead ? 'cell-muted' : 'unread';
  const action = message.isRead
    ? '<span class="cell-muted">Leído</span>'
    : `<button class="btn btn--ghost btn--small" type="button" data-mark-read="${message.id}">Marcar leído</button>`;

  return `
    <tr>
      <td class="cell-muted cell-num" data-label="Fecha">${escapeHtml(formatDate(message.createdAt))}</td>
      <td class="${className}" data-label="Nombre">${escapeHtml(message.name)}</td>
      <td data-label="Contacto">${contactCell(message)}</td>
      <td data-label="Mensaje">
        <div class="message-body">${escapeHtml(message.message)}</div>
        ${
          message.subject
            ? `<div class="cell-muted">${escapeHtml(message.subject)}</div>`
            : ''
        }
      </td>
      <td data-label="Estado">${action}</td>
    </tr>`;
}

function updateBadge(unreadCount) {
  unreadBadge.hidden = unreadCount === 0;
  unreadBadge.textContent = unreadCount;
}

async function load() {
  clearError(errorLine);

  try {
    const { messages, total, unreadCount } = await adminApi.messages(FILTERS);

    rows.innerHTML = messages.map(rowTemplate).join('');
    emptyState.hidden = messages.length > 0;
    emptyState.textContent = total ? 'No hay mensajes con ese filtro.' : 'Todavía no llegó ningún mensaje.';
    updateBadge(unreadCount);
  } catch (error) {
    if (error.status === 401) return;
    showError(errorLine, `No pudimos cargar los mensajes: ${error.message}`);
  }
}

rows.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-mark-read]');
  if (!button) return;

  button.disabled = true;
  try {
    await adminApi.markMessageRead(button.dataset.markRead);
    await load();
  } catch (error) {
    showError(errorLine, `No pudimos marcar el mensaje: ${error.message}`);
    button.disabled = false;
  }
});

filtersForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(filtersForm);
  FILTERS.unread = data.get('unread')?.toString() ?? '';
  load();
});

document.querySelector('[data-logout]')?.addEventListener('click', logout);

await requireAuth();
await load();