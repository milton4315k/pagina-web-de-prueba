// Guard de sesión del panel.
//
// Verifica contra /api/admin/session que el usuario esté logueado con Google y
// que su email esté en ADMIN_EMAILS. Si no, redirige a login.html.

import { adminApi } from './api.js';
import { signOut } from '../supabase.js';

/** @returns {Promise<{authenticated: boolean, isAdmin: boolean, user: object|null}>} */
export async function requireAuth() {
  try {
    const session = await adminApi.session();
    if (!session.authenticated || !session.isAdmin) throw new Error('sin sesión');
    return session;
  } catch {
    window.location.href = new URL('login.html', window.location.href).href;
    return new Promise(() => {}); // La navegación corta la cadena.
  }
}

export async function logout() {
  try {
    await signOut();
  } catch {
    // Si el signOut falla igual volvemos al login.
  }
  window.location.href = new URL('login.html', window.location.href).href;
}

/** Helpers de formato compartidos por las páginas del panel. */
export const formatPrice = (value) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);

export const formatDate = (value) =>
  new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}

export function clearError(element) {
  if (!element) return;
  element.textContent = '';
  element.hidden = true;
}
