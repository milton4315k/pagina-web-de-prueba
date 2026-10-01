// Canjea el token del link de WhatsApp por una sesión en cookie.
// Esta página es el destino de /admin/authorize.html?t=<token>.

import { adminApi } from './api.js';
import { clearError, showError } from './auth.js';

const statusLine = document.querySelector('[data-authorize-status]');
const errorLine = document.querySelector('[data-authorize-error]');

async function main() {
  const token = new URLSearchParams(window.location.search).get('t');

  if (!token) {
    clearError(statusLine);
    showError(errorLine, 'El link no trae el código de acceso. Pedí uno nuevo desde el login.');
    return;
  }

  try {
    await adminApi.verifyLogin(token);

    // El token ya está en el historial: lo sacamos de la URL.
    window.history.replaceState({}, '', window.location.pathname);
    window.location.href = new URL('index.html', window.location.href).href;
  } catch (error) {
    clearError(statusLine);
    showError(
      errorLine,
      error.status === 401
        ? 'Ese link ya se usó o venció. Pedí uno nuevo desde el login.'
        : `No pudimos verificar el link: ${error.message}`,
    );
  }
}

main();