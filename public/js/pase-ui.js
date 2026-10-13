// UI del Pase Nocturno.
//
// El botón de la navbar ya está en el HTML de cada página. Este módulo lo
// actualiza con los puntos y monta el modal. La identidad es la cuenta de
// Google (Supabase Auth): si no hay sesión, el modal invita a entrar; si hay,
// muestra el pase.

import {
  PASSE_RULES,
  escapeHtml,
  fetchPass,
  formatBirthday,
  formatPrice,
  isLoggedIn,
  loginConfigured,
  requestRedemption,
  resendCode,
  signInWithGoogle,
  signOut,
  updateProfile,
} from './pase.js';

// --- Estilos -------------------------------------------------------------

const STYLES = `
[data-pase-trigger] { display: inline-flex; min-height: 42px; align-items: center; gap: 8px;
  padding: 0 15px; border: 1px solid var(--copper); border-radius: 999px;
  background: transparent; color: var(--copper-bright); font: inherit; font-size: .66rem;
  font-weight: 700; letter-spacing: .11em; text-transform: uppercase; cursor: pointer;
  transition: background-color 180ms ease, color 180ms ease; }
[data-pase-trigger]:hover { background: var(--copper); color: var(--ink); }
[data-pase-trigger] .pase-trigger__pts { padding: 2px 7px; border-radius: 999px;
  background: var(--copper); color: var(--ink); font-size: .62rem; letter-spacing: 0; }
[data-pase-trigger]:hover .pase-trigger__pts { background: var(--ink); color: var(--copper-bright); }

.pase-dialog { width: min(520px, calc(100vw - 2rem)); padding: 0; border: 0;
  border-radius: 18px; background: var(--ink-card); color: var(--cream);
  box-shadow: 0 24px 80px rgba(0,0,0,.55); }
.pase-dialog::backdrop { background: rgba(12,10,9,.72); backdrop-filter: blur(3px); }
.pase-dialog__inner { padding: 30px 30px 26px; }
.pase-dialog h2 { margin: 0 0 6px; font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.65rem; font-weight: 600; }
.pase-dialog p { margin: 0 0 18px; color: var(--muted); font-size: .82rem; line-height: 1.6; }
.pase-dialog label { display: block; margin: 0 0 5px; color: var(--muted);
  font-size: .64rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.pase-dialog input { width: 100%; min-height: 44px; margin-bottom: 15px; padding: 0 12px;
  border: 1px solid var(--line-light); border-radius: 10px; background: var(--ink-soft);
  color: var(--cream); font: inherit; font-size: .9rem; }
.pase-dialog input:focus-visible { outline: 2px solid var(--copper); outline-offset: 1px; }
.pase-dialog input[aria-invalid='true'] { border-color: #e07a6b; }
.pase-dialog__hint { font-size: .72rem; }
.pase-dialog__actions { display: flex; gap: 10px; margin-top: 6px; }
.pase-dialog__actions .button { flex: 1; justify-content: center; }
.pase-error { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #e07a6b;
  border-radius: 10px; color: #e07a6b; font-size: .8rem; }
.pase-error:empty { display: none; }
.pase-google { display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; min-height: 46px; margin-bottom: 14px; border: 1px solid var(--line-light);
  border-radius: 10px; background: var(--cream); color: var(--ink); font: inherit;
  font-weight: 600; font-size: .88rem; cursor: pointer; }
.pase-google:hover { filter: brightness(.96); }
.pase-google:disabled { opacity: .6; cursor: default; }

/* La tarjeta */
.pase-card { position: relative; overflow: hidden; padding: 28px; border-radius: 20px;
  border: 1px solid var(--line-light);
  background: linear-gradient(150deg, var(--ink-card), var(--ink-soft)); }
.pase-card::after { content: '🍕'; position: absolute; right: -14px; bottom: -20px;
  font-size: 7rem; opacity: .07; pointer-events: none; }
.pase-card__top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 4px; }
.pase-card__label { color: var(--copper-bright); font-size: .62rem; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; }
.pase-card__code { padding: 5px 11px; border: 1px solid var(--copper); border-radius: 999px;
  color: var(--copper-bright); font-size: .72rem; font-weight: 700; letter-spacing: .1em; }
.pase-card__greet { margin: 0 0 20px; font-size: .92rem; color: var(--cream); }
.pase-card__greet strong { color: var(--copper-bright); }
.pase-points { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.pase-points__value { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2.6rem;
  line-height: 1; color: var(--cream); }
.pase-points__of { color: var(--muted); font-size: .82rem; }
.pase-bar { height: 8px; margin-bottom: 9px; border-radius: 999px; background: rgba(255,255,255,.1);
  overflow: hidden; }
.pase-bar__fill { height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--copper), var(--copper-bright));
  transition: width 600ms ease; }
.pase-card__next { margin: 0 0 22px; color: var(--muted); font-size: .78rem; }
.pase-card__next strong { color: var(--cream); }
.pase-benefits { margin: 0 0 22px; padding: 0; list-style: none; }
.pase-benefits li { display: flex; gap: 11px; padding: 11px 0; border-top: 1px solid var(--line-light); }
.pase-benefits li:first-child { border-top: 0; }
.pase-benefits__icon { flex: none; width: 22px; font-size: .95rem; }
.pase-benefits__body { flex: 1; }
.pase-benefits__label { display: block; font-size: .84rem; font-weight: 600; }
.pase-benefits__reason { display: block; margin-top: 2px; color: var(--muted); font-size: .72rem; }
.pase-benefits__tag { flex: none; align-self: center; padding: 3px 9px; border-radius: 999px;
  font-size: .58rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
.pase-tag--yes { background: var(--copper); color: var(--ink); }
.pase-tag--no { border: 1px solid var(--line-light); color: var(--muted); }
.pase-tag--used { border: 1px solid #6fbf8b; color: #6fbf8b; }
.pase-card__note { margin: 14px 0 0; color: var(--muted); font-size: .7rem; line-height: 1.55; }
.pase-birthday { margin: 0 0 18px; padding: 9px 13px; border-radius: 10px;
  border: 1px solid var(--copper-bright); color: var(--copper-bright); font-size: .78rem; }
.pase-birthday-note { margin: 0 0 16px; color: var(--muted); font-size: .74rem; }

/* El código del recién registrado, en grande para poder dictarlo o copiarlo. */
.pase-code-big { margin: 4px 0 16px; color: var(--copper-bright);
  font-family: 'Cormorant Garamond', Georgia, serif; font-size: clamp(2rem, 9vw, 2.9rem);
  font-weight: 700; letter-spacing: .08em; line-height: 1.1; word-break: break-word; }

/* Vista previa de los beneficios en el modal. */
.pase-preview { margin: 0 0 20px; padding: 0 0 0 18px; color: var(--muted); font-size: .78rem; }
.pase-preview li { margin-bottom: 3px; }

.pase-redeem-error, .pase-resend-error { margin: 12px 0 0; color: #e07a6b; font-size: .78rem; }
.pase-redeem-error:empty, .pase-resend-error[hidden] { display: none; }

/* Los botones del pase necesitan 44px reales para el dedo. */
.pase-card .button, .pase-dialog__actions .button { min-height: 44px; }

/* --- Celular --- */
@media (max-width: 560px) {
  .pase-dialog { width: 100%; max-width: 100%; border-radius: 18px 18px 0 0;
    margin: 0 auto; position: fixed; inset: auto 0 0 0; }
  .pase-dialog__inner { padding: 22px 18px calc(22px + env(safe-area-inset-bottom)); }
  .pase-dialog__actions { flex-direction: column; }
  .pase-card { padding: 20px 17px; }
  .pase-card::after { font-size: 5rem; right: -10px; bottom: -14px; }
  .pase-points__value { font-size: 2.2rem; }
  .pase-benefits li { flex-wrap: wrap; }
  .pase-benefits__tag { align-self: flex-start; margin-left: 33px; }
  .pase-card__note { font-size: .72rem; }
}

/* En pantallas muy chicas el texto del código no debe partirse a la mitad. */
@media (max-width: 360px) {
  .pase-code-big { font-size: 1.7rem; letter-spacing: .04em; }
}
`;

const styleTag = document.createElement('style');
styleTag.textContent = STYLES;
document.head.append(styleTag);

// --- Estado local de la vista -------------------------------------------

let currentPass = null;
let pendingWelcome = false;

const dialog = () => document.querySelector('[data-pase-dialog]');
const content = () => document.querySelector('[data-pase-content]');
const setContent = (html) => {
  const element = content();
  if (element) element.innerHTML = html;
};

const fallback = () => {
  if (typeof window.nocturnaPaseFallback === 'function') window.nocturnaPaseFallback();
};

const closeDialog = () => dialog()?.close();

async function openDialog() {
  const element = dialog();
  if (!element) return fallback();
  if (typeof element.showModal !== 'function') return fallback();
  element.showModal();

  if (currentPass) return renderPass(currentPass);
  if (await isLoggedIn()) return loadPassView();
  return showLogin();
}

// --- Botón de la navbar --------------------------------------------------

function updateTrigger(pass) {
  const trigger = document.querySelector('[data-pase-trigger]');
  if (!trigger) return;

  if (pass) {
    trigger.innerHTML =
      '<span aria-hidden="true">🍕</span> Mi Pase ' +
      `<span class="pase-trigger__pts">${escapeHtml(pass.points)}</span>`;
    trigger.setAttribute('aria-label', `Mi Pase Nocturno, ${pass.points} puntos`);
  } else {
    trigger.innerHTML = '<span aria-hidden="true">🔑</span> Mi Pase Nocturno';
    trigger.setAttribute('aria-label', 'Entrar a mi Pase Nocturno');
  }
}

// --- Vistas --------------------------------------------------------------

function showLogin() {
  setContent(`
    <div>
      <h2>Tu Pase Nocturno</h2>
      <p>
        Entrá con tu cuenta de Google y llevate
        <strong>${PASSE_RULES.welcomePoints} puntos de regalo</strong>.
        Un punto cada ${formatPrice(PASSE_RULES.pointsPerPeso)} que gastes.
      </p>

      <ul class="pase-preview">
        <li>${escapeHtml(PASSE_RULES.benefits[0].label)}</li>
        <li>${PASSE_RULES.benefits[1].threshold} pts · ${escapeHtml(PASSE_RULES.benefits[1].label)}</li>
        <li>${PASSE_RULES.benefits[2].threshold} pts · ${escapeHtml(PASSE_RULES.benefits[2].label)}</li>
        <li>${escapeHtml(PASSE_RULES.benefits[3].label)}</li>
      </ul>

      <p class="pase-error" data-pase-error role="alert"></p>

      <button class="pase-google" type="button" data-pase-login>
        <span aria-hidden="true">🔐</span> Entrar con Google
      </button>
      <button class="button button--outline" type="button" data-pase-cancel>Ahora no</button>

      <p class="pase-dialog__hint">
        Usamos tu nombre y tu email de Google solo para tu pase. Después nos
        contás tu WhatsApp para avisarte de los premios.
      </p>
    </div>`);
}

function showProfile(pass) {
  setContent(`
    <div>
      <h2>Completá tu Pase</h2>
      <p>
        Entraste como <strong>${escapeHtml(pass.email ?? '')}</strong>.
        Solo nos falta tu WhatsApp para avisarte cuando tengas un premio.
      </p>

      <form data-pase-form>
        <p class="pase-error" data-pase-error role="alert"></p>

        <label for="pase-name">Nombre y apellido</label>
        <input id="pase-name" name="name" type="text" autocomplete="name"
               value="${escapeHtml(pass.name ?? '')}" required maxlength="120" />

        <label for="pase-phone">WhatsApp</label>
        <input id="pase-phone" name="phone" type="tel" autocomplete="tel"
               placeholder="11 2849-3108" required maxlength="25" />

        <label for="pase-birthday">Fecha de cumpleaños <span class="pase-dialog__hint">(opcional)</span></label>
        <input id="pase-birthday" name="birthday" type="date"
               value="${pass.birthday ? String(pass.birthday).slice(0, 10) : ''}" />

        <div class="pase-dialog__actions">
          <button class="button button--primary" type="submit">Guardar mi pase</button>
          <button class="button button--outline" type="button" data-pase-signout>Cerrar sesión</button>
        </div>
      </form>

      <p class="pase-dialog__hint">
        Guardamos tu nombre, tu WhatsApp y tu cumpleaños para avisarte beneficios.
      </p>
    </div>`);
}

function benefitTemplate(benefit) {
  const tag = benefit.redeemed
    ? '<span class="pase-benefits__tag pase-tag--used">Canjeado</span>'
    : benefit.available
      ? '<span class="pase-benefits__tag pase-tag--yes">Disponible</span>'
      : '<span class="pase-benefits__tag pase-tag--no">Bloqueado</span>';

  const action = benefit.available
    ? `<button class="button button--outline button--small" type="button"
         data-pase-redeem="${escapeHtml(benefit.key)}">Pedir este beneficio</button>
       <p class="pase-redeem-error" data-pase-redeem-error></p>`
    : '';

  return `
    <li>
      <span class="pase-benefits__icon" aria-hidden="true">${benefit.redeemed ? '✓' : '🎁'}</span>
      <span class="pase-benefits__body">
        <span class="pase-benefits__label">${escapeHtml(benefit.label)}</span>
        <span class="pase-benefits__reason">${escapeHtml(benefit.reason)}</span>
        ${action}
      </span>
      ${tag}
    </li>`;
}

/** Paso de recién registrado: el código en grande y el botón de mandarlo. */
function renderWelcomeStep(pass) {
  setContent(`
    <div class="pase-card">
      <div class="pase-card__top">
        <span class="pase-card__label">🍕 Mi Pase Nocturna</span>
      </div>

      <p class="pase-card__greet">
        Listo, <strong>${escapeHtml(pass.name)}</strong>. Este es tu código:
      </p>

      <p class="pase-code-big">${escapeHtml(pass.memberCodeLabel)}</p>

      <p class="pase-card__next">
        Mandanos el código por WhatsApp y activamos tus
        <strong>${PASSE_RULES.welcomePoints} puntos</strong> de bienvenida.
        Los puntos quedan acreditados igual: el local los ve apenas le escribís.
      </p>

      <div class="pase-dialog__actions">
        <button class="button button--primary" type="button" data-pase-send-code>
          📲 Mandar mi código <span class="button-arrow" aria-hidden="true">↗</span>
        </button>
        <button class="button button--outline" type="button" data-pase-skip>
          Ver mi pase
        </button>
      </div>
    </div>`);
}

function renderPass(pass) {
  const birthday = formatBirthday(pass.birthday);
  const cumple = pass.birthdayActive
    ? '<p class="pase-birthday">🎂 ¡Feliz cumpleaños! Tenés postre sin cargo esta semana.</p>'
    : birthday
      ? `<p class="pase-birthday-note">Tu cumpleaños es el ${escapeHtml(birthday)}.</p>`
      : '';

  const progress = Math.round((pass.progress ?? 0) * 100);
  const nextText = pass.nextBenefit
    ? `Te faltan <strong>${pass.pointsToNext} pts</strong> para ${escapeHtml(pass.nextBenefit.label)}.`
    : 'Completaste todos los beneficios del programa. ¡Seguí acumulando!';

  setContent(`
    <div class="pase-card">
      <div class="pase-card__top">
        <span class="pase-card__label">🍕 Mi Pase Nocturna</span>
        <span class="pase-card__code">${escapeHtml(pass.memberCodeLabel)}</span>
      </div>

      <p class="pase-card__greet">¡Hola, <strong>${escapeHtml(pass.name)}</strong>!</p>
      ${cumple}

      <div class="pase-points">
        <span class="pase-points__value">${pass.points}</span>
        <span class="pase-points__of">puntos acumulados</span>
      </div>

      <div class="pase-bar" role="img"
           aria-label="Progreso hacia el próximo beneficio: ${progress}%">
        <div class="pase-bar__fill" style="width: ${progress}%"></div>
      </div>
      <p class="pase-card__next">${nextText}</p>

      <ul class="pase-benefits">
        ${pass.benefits.map(benefitTemplate).join('')}
      </ul>

      <div class="pase-dialog__actions">
        <a class="button button--primary" data-pase-order
           href="https://wa.me/5491128493108" target="_blank" rel="noopener">
          Pedir por WhatsApp <span class="button-arrow" aria-hidden="true">↗</span>
        </a>
        <button class="button button--outline" type="button" data-pase-resend>
          Reenviar código
        </button>
      </div>

      <p class="pase-resend-error" data-pase-resend-error role="alert" hidden></p>

      <p class="pase-card__note">
        Un punto por cada ${formatPrice(PASSE_RULES.pointsPerPeso)} gastados.
        Los puntos se acreditan cuando el local marca el pedido como entregado.
        <button class="text-link" type="button" data-pase-signout>Cerrar sesión</button>
      </p>
    </div>`);
}

// --- Acciones ------------------------------------------------------------

async function loadPassView() {
  setContent('<p class="pase-dialog__hint">Cargando tu pase…</p>');

  const result = await fetchPass();
  if (!result) {
    currentPass = null;
    updateTrigger(null);
    showLogin();
    return;
  }

  currentPass = result.pass;
  pendingWelcome = result.created;
  updateTrigger(currentPass);

  if (!currentPass.phone) showProfile(currentPass);
  else if (pendingWelcome) renderWelcomeStep(currentPass);
  else renderPass(currentPass);
}

async function login() {
  const errorBox = dialog()?.querySelector('[data-pase-error]');
  const button = dialog()?.querySelector('[data-pase-login]');
  if (errorBox) errorBox.textContent = '';

  try {
    if (!(await loginConfigured())) {
      if (errorBox) errorBox.textContent = 'El login todavía no está configurado. Avisale al local.';
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Abriendo Google…';
    }
    await signInWithGoogle(window.location.href);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">🔐</span> Entrar con Google';
    }
    if (errorBox) errorBox.textContent = error.message || 'No pudimos abrir Google.';
  }
}

async function submitProfile(form) {
  const error = form.querySelector('[data-pase-error]');
  const submit = form.querySelector('button[type="submit"]');
  const data = new FormData(form);

  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Guardando…';

  try {
    const pass = await updateProfile({
      name: data.get('name')?.toString().trim(),
      phone: data.get('phone')?.toString().trim(),
      birthday: data.get('birthday')?.toString().trim(),
    });
    currentPass = pass;
    updateTrigger(pass);
    if (pendingWelcome) {
      pendingWelcome = false;
      renderWelcomeStep(pass);
    } else {
      renderPass(pass);
    }
  } catch (caught) {
    error.textContent = caught.message || 'No pudimos guardar tu pase.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Guardar mi pase';
  }
}

async function redeem(benefitKey, button) {
  const errorBox = button.parentElement?.querySelector('[data-pase-redeem-error]');
  if (errorBox) errorBox.textContent = '';

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Enviando…';

  try {
    const result = await requestRedemption(benefitKey);
    const opened = window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = result.whatsappUrl;
    button.textContent = 'Pedido ✅';
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 2500);
  } catch (error) {
    button.textContent = original;
    button.disabled = false;
    if (errorBox) errorBox.textContent = error.message;
  }
}

async function resend() {
  const target = dialog()?.querySelector('[data-pase-resend-error]');
  if (target) {
    target.textContent = '';
    target.hidden = true;
  }

  try {
    const { whatsappUrl } = await resendCode();
    const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = whatsappUrl;
  } catch (error) {
    if (target) {
      target.textContent = error.message;
      target.hidden = false;
    }
  }
}

async function signOutAndReset() {
  await signOut().catch(() => {});
  currentPass = null;
  pendingWelcome = false;
  updateTrigger(null);
  showLogin();
}

// --- Montaje -------------------------------------------------------------

function buildDialog() {
  const element = document.createElement('dialog');
  element.className = 'pase-dialog';
  element.setAttribute('data-pase-dialog', '');
  element.setAttribute('aria-label', 'Pase Nocturno');
  element.innerHTML = '<div class="pase-dialog__inner" data-pase-content></div>';
  document.body.append(element);

  element.addEventListener('click', (event) => {
    if (event.target === element) closeDialog();
    if (event.target.closest('[data-pase-cancel]')) closeDialog();

    if (event.target.closest('[data-pase-login]')) login();
    if (event.target.closest('[data-pase-signout]')) signOutAndReset();

    const redeemButton = event.target.closest('[data-pase-redeem]');
    if (redeemButton) redeem(redeemButton.dataset.paseRedeem, redeemButton);

    if (event.target.closest('[data-pase-resend]')) resend();
    if (event.target.closest('[data-pase-send-code]')) resend();
    if (event.target.closest('[data-pase-skip]') && currentPass) renderPass(currentPass);
  });

  element.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-pase-form]');
    if (!form) return;
    event.preventDefault();
    submitProfile(form);
  });

  return element;
}

async function init() {
  const trigger = document.querySelector('[data-pase-trigger]');
  if (!trigger) return;

  buildDialog();
  showLogin();
  updateTrigger(null);

  // Si este módulo monta bien, marca el botón como suyo; si no, script.js
  // atiende el clic con el fallback de WhatsApp.
  trigger.addEventListener('click', openDialog);
  trigger.setAttribute('data-pase-ready', '');

  if (!(await isLoggedIn())) return;

  updateTrigger({ points: '…' });
  await loadPassView();
}

if (document.querySelector('[data-pase-trigger]')) {
  init().catch((error) => {
    console.error('Pase Nocturno: no se pudo montar el modal.', error);
  });
}
