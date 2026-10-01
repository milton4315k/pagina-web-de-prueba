// Login del panel: pide un token y manda al owner a WhatsApp.
//
// El link vuelve en el chat del owner, donde lo abre authorize.html.

import { adminApi } from './api.js';
import { clearError, showError } from './auth.js';

const button = document.querySelector('[data-login-button]');
const statusLine = document.querySelector('[data-login-status]');
const errorLine = document.querySelector('[data-login-error]');

// Si ya hay sesión, no tiene sentido mostrar el login.
adminApi
  .session()
  .then((session) => {
    if (session.authenticated) {
      window.location.href = new URL('index.html', window.location.href).href;
    }
  })
  .catch(() => {});

button?.addEventListener('click', async () => {
  clearError(errorLine);

  // Evitamos doble click: el rate limit del server es de 5 por hora.
  button.disabled = true;
  button.textContent = 'Generando el link…';

  try {
    const { whatsappUrl, expiresInMinutes } = await adminApi.requestLogin();

    statusLine.hidden = false;
    statusLine.textContent =
      `Te mandamos el link a tu WhatsApp. Abrilo desde ese chat; vence en ${expiresInMinutes} minutos.`;

    const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      showError(
        errorLine,
        'No pudimos abrir WhatsApp automáticamente. Permití las ventanas emergentes o abrí el enlace desde el celular.',
      );
    }
  } catch (error) {
    showError(
      errorLine,
      error.status === 429
        ? 'Pedimos demasiados links seguidos. Probá en una hora.'
        : `No pudimos generar el link: ${error.message}`,
    );
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar con WhatsApp';
  }
});