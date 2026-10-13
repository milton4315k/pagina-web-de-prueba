// Listado de pedidos del panel: filtros, contadores y cambio de estado inline.

import { adminApi } from './api.js';
import {
  clearError,
  escapeHtml,
  formatDate,
  formatPrice,
  logout,
  requireAuth,
  showError,
} from './auth.js';

const rows = document.querySelector('[data-rows]');
const emptyState = document.querySelector('[data-empty]');
const errorLine = document.querySelector('[data-error]');
const statsBox = document.querySelector('[data-stats]');
const filtersForm = document.querySelector('[data-filters]');
const unreadBadge = document.querySelector('[data-unread-badge]');

const STATUSES = {
  new: 'Sin confirmar',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  out_for_delivery: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

// Flujo normal; `cancelled` queda disponible desde new/confirmed.
const NEXT_STATUS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

const FILTERS = { status: '', from: '', to: '' };

function renderStats(counts) {
  const order = ['new', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  statsBox.innerHTML = order
    .map(
      (status) => `
        <div class="stat">
          <div class="stat__value">${counts[status] ?? 0}</div>
          <div class="stat__label">${escapeHtml(STATUSES[status])}</div>
        </div>`,
    )
    .join('');
}

function statusCell(status) {
  return `<span class="status status--${escapeHtml(status)}">${escapeHtml(STATUSES[status] ?? status)}</span>`;
}

function actionsCell(order) {
  const next = NEXT_STATUS[order.status] ?? [];
  if (!next.length) return '<span class="cell-muted">—</span>';

  return `<div class="pill-actions">${next
    .map(
      (status) =>
        `<button class="btn btn--ghost btn--small" type="button" data-set-status="${status}" data-order="${order.id}">${escapeHtml(
          STATUSES[status],
        )}</button>`,
    )
    .join('')}</div>`;
}

function detailTemplate(order) {
  const items = order.items
    .map(
      (item) =>
        `<li>${item.quantity}× ${escapeHtml(item.name)} — $${formatPrice(item.unitPrice)}</li>`,
    )
    .join('');

  const notes = [order.address && `<strong>Dirección:</strong> ${escapeHtml(order.address)}`, order.notes && escapeHtml(order.notes)]
    .filter(Boolean)
    .join('<br />');

  return `
    <tr class="detail">
      <td colspan="7" data-label="">
        <div class="cell-muted">${escapeHtml(order.customerName)} · ${escapeHtml(order.customerPhone)}${
          order.customerEmail ? ` · ${escapeHtml(order.customerEmail)}` : ''
        }</div>
        <ul class="detail__items">${items}</ul>
        ${notes ? `<p class="detail__note">${notes}</p>` : ''}
      </td>
    </tr>`;
}

function rowTemplate(order) {
  return `
    <tr data-order-row="${order.id}">
      <td class="cell-strong" data-label="Código">${escapeHtml(order.orderCode)}</td>
      <td data-label="Cliente">
        <button class="btn btn--ghost btn--small" type="button" data-toggle-detail="${order.id}">
          ${escapeHtml(order.customerName)}
        </button>
        <div class="cell-muted">${order.itemCount} ${order.itemCount === 1 ? 'ítem' : 'ítems'}${
          order.memberCode
            ? ` · <span class="pase-mark">${escapeHtml(order.memberCode.replace('#', ''))}</span>`
            : ''
        }</div>
      </td>
      <td class="cell-muted cell-num" data-label="Hora">${escapeHtml(formatDate(order.createdAt))}</td>
      <td class="cell-muted" data-label="Modalidad">${order.fulfillmentType === 'delivery' ? 'Entrega' : 'Retiro'}</td>
      <td data-label="Estado">${statusCell(order.status)}</td>
      <td class="cell-num" data-label="Total">$ ${formatPrice(order.totalAmount)}</td>
      <td data-label="Siguiente">${actionsCell(order)}</td>
    </tr>`;
}

async function load() {
  clearError(errorLine);

  try {
    const { orders, counts, total } = await adminApi.orders(FILTERS);

    renderStats(counts);
    rows.innerHTML = orders.map(rowTemplate).join('');
    emptyState.hidden = orders.length > 0;
    emptyState.textContent = total
      ? 'No hay pedidos con esos filtros.'
      : 'Todavía no llegó ningún pedido.';
  } catch (error) {
    if (error.status === 401) return; // El cliente redirige solo.
    showError(errorLine, `No pudimos cargar los pedidos: ${error.message}`);
  }
}

async function refreshUnread() {
  try {
    const { unreadCount } = await adminApi.messages();
    unreadBadge.hidden = unreadCount === 0;
    unreadBadge.textContent = unreadCount;
  } catch {
    // El contador no es crítico.
  }
}

rows.addEventListener('click', async (event) => {
  const statusButton = event.target.closest('[data-set-status]');
  if (statusButton) {
    const id = statusButton.dataset.order;
    const status = statusButton.dataset.setStatus;
    statusButton.disabled = true;
    try {
      await adminApi.setOrderStatus(id, status);
      await load();
      await refreshUnread();
    } catch (error) {
      showError(errorLine, `No pudimos actualizar el pedido: ${error.message}`);
      statusButton.disabled = false;
    }
    return;
  }

  const detailButton = event.target.closest('[data-toggle-detail]');
  if (detailButton) {
    const id = detailButton.dataset.toggleDetail;
    const existing = rows.querySelector(`.detail[data-detail-of="${id}"]`);
    if (existing) {
      existing.remove();
      return;
    }

    detailButton.disabled = true;
    try {
      const { order } = await adminApi.order(id);
      const wrapper = document.createElement('tbody');
      wrapper.innerHTML = detailTemplate(order).replace(
        'class="detail"',
        `class="detail" data-detail-of="${id}"`,
      );
      detailButton.closest('tr').after(wrapper.firstElementChild);
    } catch (error) {
      showError(errorLine, `No pudimos ver el detalle: ${error.message}`);
    } finally {
      detailButton.disabled = false;
    }
  }
});

filtersForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(filtersForm);
  FILTERS.status = data.get('status')?.toString() ?? '';
  FILTERS.from = data.get('from')?.toString() ?? '';
  FILTERS.to = data.get('to')?.toString() ?? '';
  load();
});

document.querySelector('[data-logout]')?.addEventListener('click', logout);

await requireAuth();
await load();
await refreshUnread();