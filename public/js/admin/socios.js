// Gestión de socios del Pase Nocturno: listado, birthdays, ajuste de puntos
// y confirmación de canjes.

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
const statsBox = document.querySelector('[data-stats]');
const filtersForm = document.querySelector('[data-filters]');
const birthdayPanel = document.querySelector('[data-birthdays-panel]');
const birthdayBox = document.querySelector('[data-birthdays]');
const unreadBadge = document.querySelector('[data-unread-badge]');

const FILTERS = { search: '', minPoints: '', sort: 'points' };

const formatBirthday = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};

const waLink = (phone) =>
  `<a href="https://wa.me/${escapeHtml(phone)}" target="_blank" rel="noopener">${escapeHtml(
    phone,
  )}</a>`;

/** Un beneficio que el socio puede canjear ahora, con su botón. */
function redeemableBenefits(pass) {
  return (pass.benefits ?? [])
    .filter((benefit) => benefit.available)
    .map(
      (benefit) =>
        `<button class="btn btn--ghost btn--small" type="button" data-confirm-redeem="${escapeHtml(
          benefit.key,
        )}" data-member="${pass.memberCode}">Canjear ${escapeHtml(benefit.label)}</button>`,
    )
    .join(' ');
}

function rowTemplate(member) {
  const memberId = member.id;
  return `
    <tr data-member-row="${memberId}">
      <td class="cell-strong" data-label="Socio">${escapeHtml(member.name)}</td>
      <td class="cell-muted" data-label="Código">${escapeHtml(member.memberCode.replace('#', ''))}</td>
      <td data-label="WhatsApp">${waLink(member.phone)}</td>
      <td class="cell-muted" data-label="Cumple">${escapeHtml(formatBirthday(member.birthday))}</td>
      <td class="cell-num cell-strong" data-label="Puntos">${member.points}</td>
      <td class="cell-num cell-muted" data-label="Pedidos">${member.orderCount}</td>
      <td data-label="Acciones">
        <div class="pill-actions">
          <button class="btn btn--small" type="button" data-adjust="${memberId}">Ajustar puntos</button>
          <button class="btn btn--ghost btn--small" type="button" data-detail="${memberId}">Historial</button>
        </div>
      </td>
    </tr>`;
}

function renderStats(totals) {
  statsBox.innerHTML = `
    <div class="stat">
      <div class="stat__value">${totals.members}</div>
      <div class="stat__label">Socios</div>
    </div>
    <div class="stat">
      <div class="stat__value">${totals.points}</div>
      <div class="stat__label">Puntos en circulación</div>
    </div>`;
}

function renderBirthdays(members) {
  if (!members.length) {
    birthdayPanel.hidden = true;
    return;
  }

  birthdayPanel.hidden = false;
  birthdayBox.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Socio</th>
            <th scope="col">WhatsApp</th>
            <th scope="col">Cumple</th>
            <th scope="col" class="cell-num">Puntos</th>
          </tr>
        </thead>
        <tbody>
          ${members
            .map(
              (member) => `
            <tr>
              <td class="cell-strong" data-label="Socio">${escapeHtml(member.name)}</td>
              <td data-label="WhatsApp">${waLink(member.phone)}</td>
              <td data-label="Cumple">
                <span class="status status--new">
                  ${member.daysUntil === 0 ? '¡Hoy!' : `En ${member.daysUntil} días`}
                </span>
              </td>
              <td class="cell-num" data-label="Puntos">${member.points}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

/** Panel de detalle con los movimientos del socio. */
function detailTemplate(member, pass, history) {
  const eventos = history
    .map(
      (event) => `
      <tr>
        <td class="cell-muted cell-num" data-label="Fecha">${escapeHtml(formatDate(event.createdAt))}</td>
        <td data-label="Tipo">${escapeHtml(event.kind)}</td>
        <td class="cell-num ${event.pointsDelta < 0 ? 'cell-muted' : 'cell-strong'}" data-label="Puntos">
          ${event.pointsDelta > 0 ? '+' : ''}${event.pointsDelta}
        </td>
        <td class="cell-muted" data-label="Detalle">${escapeHtml(event.note ?? '')}${
          event.orderCode ? ` · ${escapeHtml(event.orderCode)}` : ''
        }</td>
      </tr>`,
    )
    .join('');

  const canjear = redeemableBenefits(pass);

  return `
    <tr class="detail" data-detail-of="${member.id}">
      <td colspan="7" data-label="">
        <p class="cell-strong">${escapeHtml(member.name)} · ${member.points} pts</p>
        <p class="cell-muted">${escapeHtml(member.memberCode.replace('#', ''))} · ${
          member.isActive ? 'activo' : 'inactivo'
        }</p>

        ${canjear ? `<div class="pill-actions" style="margin: 0.6rem 0">${canjear}</div>` : ''}

        <div class="table-wrap" style="margin-top: 0.75rem">
          <table>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Tipo</th>
                <th scope="col" class="cell-num">Puntos</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>${eventos || '<tr><td colspan="4" class="cell-muted">Sin movimientos.</td></tr>'}</tbody>
          </table>
        </div>
      </td>
    </tr>`;
}

async function load() {
  clearError(errorLine);

  try {
    const { members, totals } = await adminApi.members(FILTERS);

    renderStats(totals);
    rows.innerHTML = members.map(rowTemplate).join('');
    emptyState.hidden = members.length > 0;
    emptyState.textContent = totals.members
      ? 'No hay socios con esos filtros.'
      : 'Todavía no se registró nadie.';
  } catch (error) {
    if (error.status === 401) return;
    showError(errorLine, `No pudimos cargar los socios: ${error.message}`);
  }
}

async function loadBirthdays() {
  try {
    const { birthdays } = await adminApi.birthdays(30);
    renderBirthdays(birthdays);
  } catch {
    // Los cumpleaños son informativos: si fallan, el panel sigue andando.
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

function memberIdFromRow(element) {
  const row = element.closest('[data-member-row]');
  return row?.dataset.memberRow;
}

async function promptAdjustPoints(id) {
  const memberId = Number(id);
  let current;
  try {
    ({ member: current } = await adminApi.member(memberId));
  } catch (error) {
    showError(errorLine, `No pudimos leer el socio: ${error.message}`);
    return;
  }

  const next = window.prompt(
    `Puntos de ${current.name}\nHoy tiene ${current.points}.\n\n¿Con cuántos queda?`,
    String(current.points),
  );
  if (next === null) return;

  const points = Number(next);
  if (!Number.isInteger(points) || points < 0) {
    showError(errorLine, 'Los puntos tienen que ser un número entero de 0 para arriba.');
    return;
  }
  if (points === current.points) return;

  const note = window.prompt('¿Por qué lo cambiás? Queda registrado en el historial.', 'Corrección');
  if (!note) return;

  try {
    await adminApi.setMemberPoints(memberId, points, note);
    await load();
  } catch (error) {
    showError(errorLine, `No pudimos ajustar los puntos: ${error.message}`);
  }
}

async function confirmRedemption(element) {
  const id = memberIdFromRow(element);
  const benefit = element.dataset.confirmRedeem;
  if (!id) return;

  const label = element.textContent.replace('Canjear', '').trim();
  if (!window.confirm(`¿Confirmás que ${label} ya se entregó?\n\nSe descuentan los puntos del socio.`)) {
    return;
  }

  element.disabled = true;
  try {
    await adminApi.confirmRedemption(Number(id), benefit);
    await load();
    await loadBirthdays();
  } catch (error) {
    showError(errorLine, `No pudimos confirmar el canje: ${error.message}`);
    element.disabled = false;
  }
}

rows.addEventListener('click', async (event) => {
  const adjustButton = event.target.closest('[data-adjust]');
  if (adjustButton) {
    await promptAdjustPoints(adjustButton.dataset.adjust);
    return;
  }

  const redeemButton = event.target.closest('[data-confirm-redeem]');
  if (redeemButton) {
    await confirmRedemption(redeemButton);
    return;
  }

  const detailButton = event.target.closest('[data-detail]');
  if (!detailButton) return;

  const id = detailButton.dataset.detail;
  const existing = rows.querySelector(`.detail[data-detail-of="${id}"]`);
  if (existing) {
    existing.remove();
    return;
  }

  detailButton.disabled = true;
  try {
    const { member, pass, history } = await adminApi.member(id);
    const wrapper = document.createElement('tbody');
    wrapper.innerHTML = detailTemplate(member, pass, history);
    detailButton.closest('tr').after(wrapper.firstElementChild);
  } catch (error) {
    showError(errorLine, `No pudimos ver el historial: ${error.message}`);
  } finally {
    detailButton.disabled = false;
  }
});

filtersForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(filtersForm);
  FILTERS.search = data.get('search')?.toString().trim() ?? '';
  FILTERS.minPoints = data.get('minPoints')?.toString() ?? '';
  FILTERS.sort = data.get('sort')?.toString() ?? 'points';
  load();
});

document.querySelector('[data-logout]')?.addEventListener('click', logout);

await requireAuth();
await load();
await loadBirthdays();
await refreshUnread();