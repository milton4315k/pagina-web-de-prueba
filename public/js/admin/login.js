// Login del panel con Google.
//
// Solo los emails de ADMIN_EMAILS entran. Si alguien entra con otra cuenta de
// Google, se le avisa y se le ofrece cerrar sesión.

import { adminApi } from './api.js';
import { clearError, showError } from './auth.js';
import { signInWithGoogle, signOut } from '../supabase.js';

const button = document.querySelector('[data-login-button]');
const logoutButton = document.querySelector('[data-login-logout]');
const statusLine = document.querySelector('[data-login-status]');
const errorLine = document.querySelector('[data-login-error]');

const panelUrl = new URL('index.html', window.location.href).href;

function showLogout() {
  if (logoutButton) logoutButton.hidden = false;
  if (button) button.hidden = true;
}

// Si ya hay sesión: admin al panel; no-admin, aviso.
adminApi
  .session()
  .then((session) => {
    if (session.authenticated && session.isAdmin) {
      window.location.href = panelUrl;
      return;
    }
    if (session.authenticated && !session.isAdmin) {
      showError(
        errorLine,
        `La cuenta ${session.user?.email ?? ''} no tiene acceso al panel.`,
      );
      showLogout();
    }
  })
  .catch(() => {
    // Sin sesión todavía: se muestra el botón de entrar.
  });

button?.addEventListener('click', async () => {
  clearError(errorLine);
  button.disabled = true;
  button.textContent = 'Abriendo Google…';

  try {
    await signInWithGoogle(panelUrl);
  } catch (error) {
    showError(errorLine, error.message || 'No pudimos abrir Google.');
    button.disabled = false;
    button.textContent = 'Entrar con Google';
  }
});

logoutButton?.addEventListener('click', async () => {
  await signOut().catch(() => {});
  window.location.reload();
});

if (statusLine) statusLine.hidden = true;
