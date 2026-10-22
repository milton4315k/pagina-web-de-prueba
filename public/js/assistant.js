const CONFIG_URL = '/api/config';
const ASSISTANT_URL = '/api/assistant';
const MAX_HISTORY = 12;

const state = {
  open: false,
  busy: false,
  history: [],
  whatsapp: '5491128493108',
};

const sourceLabels = {
  'menu.md': 'Menú',
  'negocio.md': 'Info del local',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(pathData, viewBox = '0 0 24 24') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function whatsappUrl(text = 'Hola Nocturna Pizza, tengo una consulta.') {
  return `https://wa.me/${state.whatsapp}?text=${encodeURIComponent(text)}`;
}

function injectStyles() {
  if (document.getElementById('np-assistant-styles')) return;
  const style = document.createElement('style');
  style.id = 'np-assistant-styles';
  style.textContent = `
    .np-assistant {
      --np-ink: #171514;
      --np-ink-soft: #272321;
      --np-cream: #f4efe7;
      --np-paper: #fbf8f3;
      --np-copper: #c8784f;
      --np-copper-bright: #e4a075;
      --np-muted: #aca29a;
      position: fixed;
      z-index: 60;
      right: 24px;
      bottom: 87px;
      font-family: var(--sans, "DM Sans", Arial, sans-serif);
      color: var(--np-ink);
    }

    .np-assistant *,
    .np-assistant *::before,
    .np-assistant *::after {
      box-sizing: border-box;
    }

    .np-assistant__launcher {
      position: relative;
      display: inline-flex;
      width: 56px;
      height: 56px;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid rgba(244, 239, 231, 0.24);
      border-radius: 50%;
      background: linear-gradient(145deg, var(--np-copper-bright), var(--np-copper));
      color: #fffdfa;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.32);
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
    }

    .np-assistant__launcher:hover {
      transform: translateY(-3px) scale(1.03);
      box-shadow: 0 18px 40px rgba(200, 120, 79, 0.38);
    }

    .np-assistant__launcher:focus-visible,
    .np-assistant__close:focus-visible,
    .np-assistant__send:focus-visible,
    .np-assistant__quick button:focus-visible,
    .np-assistant__input:focus-visible {
      outline: 2px solid var(--np-copper-bright);
      outline-offset: 3px;
    }

    .np-assistant__launcher svg {
      width: 27px;
      height: 27px;
    }

    .np-assistant__dot {
      position: absolute;
      top: 1px;
      right: 1px;
      width: 12px;
      height: 12px;
      border: 2px solid var(--np-ink);
      border-radius: 50%;
      background: #6fbf8b;
    }

    .np-assistant__panel {
      position: absolute;
      right: 0;
      bottom: 70px;
      display: flex;
      width: min(380px, calc(100vw - 32px));
      height: min(570px, calc(100dvh - 180px));
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(244, 239, 231, 0.16);
      border-radius: 24px;
      background: var(--np-ink);
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48);
      opacity: 0;
      pointer-events: none;
      transform: translateY(14px) scale(0.98);
      transform-origin: bottom right;
      transition: opacity 180ms ease, transform 180ms ease;
    }

    .np-assistant.is-open .np-assistant__panel {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
    }

    .np-assistant__header {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 15px 15px 14px;
      border-bottom: 1px solid rgba(244, 239, 231, 0.1);
      background:
        radial-gradient(circle at 85% 10%, rgba(200, 120, 79, 0.24), transparent 12rem),
        var(--np-ink-soft);
    }

    .np-assistant__avatar {
      display: grid;
      width: 38px;
      height: 38px;
      flex: 0 0 auto;
      place-items: center;
      border-radius: 50%;
      background: linear-gradient(145deg, var(--np-copper-bright), var(--np-copper));
      color: #fffdfa;
      font-family: var(--serif, Georgia, serif);
      font-size: 1.35rem;
      font-weight: 700;
      line-height: 1;
    }

    .np-assistant__heading {
      min-width: 0;
      flex: 1;
    }

    .np-assistant__heading strong {
      display: block;
      overflow: hidden;
      color: var(--np-cream);
      font-size: 0.84rem;
      letter-spacing: 0.04em;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .np-assistant__heading span {
      display: block;
      overflow: hidden;
      color: var(--np-muted);
      font-size: 0.66rem;
      letter-spacing: 0.02em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .np-assistant__close {
      display: grid;
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
      place-items: center;
      padding: 0;
      border: 1px solid rgba(244, 239, 231, 0.15);
      border-radius: 50%;
      background: transparent;
      color: var(--np-cream);
      cursor: pointer;
      transition: background 160ms ease, border-color 160ms ease;
    }

    .np-assistant__close:hover {
      border-color: rgba(244, 239, 231, 0.3);
      background: rgba(244, 239, 231, 0.08);
    }

    .np-assistant__close svg {
      width: 16px;
      height: 16px;
    }

    .np-assistant__messages {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      padding: 17px 15px 10px;
      scrollbar-color: rgba(244, 239, 231, 0.22) transparent;
      scrollbar-width: thin;
    }

    .np-assistant__messages::-webkit-scrollbar {
      width: 7px;
    }

    .np-assistant__messages::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: rgba(244, 239, 231, 0.2);
    }

    .np-assistant__message {
      max-width: 88%;
      animation: np-assistant-in 180ms ease both;
    }

    @keyframes np-assistant-in {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .np-assistant__bubble {
      padding: 10px 13px;
      border-radius: 16px;
      font-size: 0.8rem;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .np-assistant__message--bot {
      align-self: flex-start;
    }

    .np-assistant__message--bot .np-assistant__bubble {
      border: 1px solid rgba(244, 239, 231, 0.1);
      border-bottom-left-radius: 5px;
      background: var(--np-ink-soft);
      color: var(--np-cream);
    }

    .np-assistant__message--user {
      align-self: flex-end;
    }

    .np-assistant__message--user .np-assistant__bubble {
      border-bottom-right-radius: 5px;
      background: var(--np-copper);
      color: #fffdfa;
    }

    .np-assistant__sources {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 6px;
      padding-left: 2px;
    }

    .np-assistant__source {
      padding: 2px 7px;
      border: 1px solid rgba(200, 120, 79, 0.28);
      border-radius: 999px;
      color: var(--np-copper-bright);
      font-size: 0.58rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .np-assistant__notice {
      margin-top: 6px;
      padding-left: 2px;
      color: var(--np-muted);
      font-size: 0.62rem;
      line-height: 1.4;
    }

    .np-assistant__typing {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 34px;
    }

    .np-assistant__typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--np-muted);
      animation: np-assistant-blink 1.1s infinite ease-in-out;
    }

    .np-assistant__typing span:nth-child(2) { animation-delay: 0.14s; }
    .np-assistant__typing span:nth-child(3) { animation-delay: 0.28s; }

    @keyframes np-assistant-blink {
      0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }

    .np-assistant__quick {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 15px 10px;
    }

    .np-assistant__quick button {
      padding: 5px 9px;
      border: 1px solid rgba(200, 120, 79, 0.33);
      border-radius: 999px;
      background: transparent;
      color: var(--np-copper-bright);
      font-family: inherit;
      font-size: 0.62rem;
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: background 160ms ease, border-color 160ms ease;
    }

    .np-assistant__quick button:hover {
      border-color: var(--np-copper);
      background: rgba(200, 120, 79, 0.12);
    }

    .np-assistant__form {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 12px 12px;
      border-top: 1px solid rgba(244, 239, 231, 0.1);
      background: var(--np-ink-soft);
    }

    .np-assistant__input {
      width: 100%;
      min-height: 40px;
      max-height: 108px;
      flex: 1;
      resize: none;
      overflow-y: auto;
      padding: 10px 12px;
      border: 1px solid rgba(244, 239, 231, 0.16);
      border-radius: 14px;
      background: rgba(23, 21, 20, 0.72);
      color: var(--np-cream);
      font-family: inherit;
      font-size: 0.78rem;
      line-height: 1.4;
    }

    .np-assistant__input::placeholder {
      color: #8f8780;
    }

    .np-assistant__send {
      display: grid;
      width: 40px;
      height: 40px;
      flex: 0 0 auto;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--np-copper);
      color: #fffdfa;
      cursor: pointer;
      transition: background 160ms ease, opacity 160ms ease, transform 160ms ease;
    }

    .np-assistant__send:hover:not(:disabled) {
      background: var(--np-copper-bright);
      transform: translateY(-1px);
    }

    .np-assistant__send:disabled {
      cursor: wait;
      opacity: 0.55;
    }

    .np-assistant__send svg {
      width: 18px;
      height: 18px;
    }

    .np-assistant__footer {
      padding: 0 15px 10px;
      color: #776e67;
      font-size: 0.56rem;
      letter-spacing: 0.02em;
      text-align: center;
    }

    .np-assistant__footer a {
      color: var(--np-muted);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    @media (max-width: 640px) {
      .np-assistant {
        right: 14px;
        bottom: 77px;
      }

      .np-assistant__panel {
        position: fixed;
        right: 14px;
        bottom: 139px;
        left: 14px;
        width: auto;
        height: min(600px, calc(100dvh - 160px));
        transform-origin: bottom center;
      }

      .np-assistant__message {
        max-width: 92%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .np-assistant *,
      .np-assistant *::before,
      .np-assistant *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function buildWidget() {
  const root = el('div', 'np-assistant');
  root.setAttribute('data-np-assistant', '');

  const launcher = el('button', 'np-assistant__launcher');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Abrir asistente de Nocturna Pizza');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute(
    'aria-controls',
    'np-assistant-panel',
  );
  launcher.appendChild(
    icon('M20.5 3.49A11.82 11.82 0 0 0 12.1 0C5.55 0 .2 5.35.2 11.9c0 2.1.55 4.15 1.6 5.96L.1 24l6.28-1.65a11.9 11.9 0 0 0 5.69 1.45h.01c6.55 0 11.9-5.35 11.9-11.9 0-3.18-1.24-6.17-3.48-8.41Zm-8.4 18.1c-1.47 0-2.91-.4-4.18-1.13l-.3-.18-3.12.82.83-3.04-.2-.31a9.84 9.84 0 0 1-1.51-5.25c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.13 1.03 7.05 2.9a9.9 9.9 0 0 1 2.92 7c0 5.46-4.45 9.89-9.9 9.89Zm5.8-7.4c-.32-.16-1.87-.92-2.16-1.03-.29-.1-.5-.15-.71.16-.21.32-.82 1.03-1 1.24-.18.21-.37.24-.68.08-.31-.16-1.31-.48-2.5-1.53-.92-.82-1.55-1.84-1.73-2.15-.18-.31-.02-.48.14-.63.14-.14.31-.37.46-.55.15-.18.2-.31.3-.52.1-.21.05-.39-.02-.55-.08-.16-.71-1.72-.97-2.36-.26-.63-.52-.54-.71-.55h-.61c-.21 0-.55.08-.84.39-.29.32-1.1 1.07-1.1 2.61s1.12 3.03 1.28 3.24c.16.21 2.2 3.36 5.34 4.71 2.5 1.06 3.13.85 3.7.79.55-.05 1.78-.73 2.03-1.43.25-.7.25-1.29.18-1.42-.08-.13-.29-.21-.61-.37Z'),
  );
  launcher.appendChild(el('span', 'np-assistant__dot'));

  const panel = el('section', 'np-assistant__panel');
  panel.id = 'np-assistant-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'Asistente de Nocturna Pizza');

  const header = el('header', 'np-assistant__header');
  const avatar = el('div', 'np-assistant__avatar', 'N');
  avatar.setAttribute('aria-hidden', 'true');
  const heading = el('div', 'np-assistant__heading');
  heading.appendChild(el('strong', '', 'Asistente Nocturna'));
  heading.appendChild(el('span', '', 'Menú, pedidos y horarios'));
  const close = el('button', 'np-assistant__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar asistente');
  close.appendChild(icon('M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z'));
  header.appendChild(avatar);
  header.appendChild(heading);
  header.appendChild(close);

  const messages = el('div', 'np-assistant__messages');
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-live', 'polite');
  messages.setAttribute('aria-relevant', 'additions');

  const quick = el('div', 'np-assistant__quick');
  const quickQuestions = [
    ['Ver menú', '¿Qué pizzas tienen y cuánto salen?'],
    ['Horarios', '¿Cuáles son los horarios de atención?'],
    ['Cómo pedir', '¿Cómo puedo hacer un pedido?'],
    ['Pase Nocturno', '¿Cómo funciona el Pase Nocturno?'],
  ];
  for (const [label, question] of quickQuestions) {
    const button = el('button', '', label);
    button.type = 'button';
    button.addEventListener('click', () => sendMessage(question));
    quick.appendChild(button);
  }

  const form = el('form', 'np-assistant__form');
  const input = el('textarea', 'np-assistant__input');
  input.rows = 1;
  input.maxLength = 1000;
  input.placeholder = 'Escribí tu pregunta…';
  input.setAttribute('aria-label', 'Tu pregunta para el asistente');
  const send = el('button', 'np-assistant__send');
  send.type = 'submit';
  send.setAttribute('aria-label', 'Enviar pregunta');
  send.appendChild(icon('M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8Z'));
  form.appendChild(input);
  form.appendChild(send);

  const footer = el('div', 'np-assistant__footer');
  const footerLink = el('a', '', '¿Preferís hablar con una persona? Escribinos por WhatsApp');
  footerLink.href = whatsappUrl();
  footerLink.target = '_blank';
  footerLink.rel = 'noopener';
  footer.appendChild(footerLink);

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(quick);
  panel.appendChild(form);
  panel.appendChild(footer);

  root.appendChild(launcher);
  root.appendChild(panel);
  document.body.appendChild(root);

  return { root, launcher, panel, close, messages, form, input, send, quick };
}

function scrollToBottom(messages) {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

function addMessage(ui, role, text, options = {}) {
  const row = el('div', `np-assistant__message np-assistant__message--${role}`);
  const bubble = el('div', 'np-assistant__bubble', text);
  row.appendChild(bubble);

  if (options.sources?.length) {
    const sources = el('div', 'np-assistant__sources');
    for (const source of [...new Set(options.sources)]) {
      sources.appendChild(el('span', 'np-assistant__source', sourceLabels[source] ?? source));
    }
    row.appendChild(sources);
  }

  if (options.notice) row.appendChild(el('div', 'np-assistant__notice', options.notice));

  ui.messages.appendChild(row);
  scrollToBottom(ui.messages);
  return row;
}

function addTyping(ui) {
  const row = el('div', 'np-assistant__message np-assistant__message--bot');
  const bubble = el('div', 'np-assistant__bubble np-assistant__typing');
  bubble.setAttribute('aria-label', 'El asistente está escribiendo');
  bubble.appendChild(el('span'));
  bubble.appendChild(el('span'));
  bubble.appendChild(el('span'));
  row.appendChild(bubble);
  ui.messages.appendChild(row);
  scrollToBottom(ui.messages);
  return row;
}

function setBusy(ui, busy) {
  state.busy = busy;
  ui.send.disabled = busy;
  ui.input.disabled = busy;
  ui.quick.querySelectorAll('button').forEach((button) => {
    button.disabled = busy;
  });
}

function resizeInput(ui) {
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, 108)}px`;
}

async function sendMessage(text) {
  const clean = String(text ?? '').trim();
  if (!clean || state.busy) return;

  const ui = window.__npAssistantUi;
  if (!ui) return;

  if (!state.open) togglePanel(true);

  addMessage(ui, 'user', clean);
  state.history.push({ role: 'user', content: clean });
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(-MAX_HISTORY);
  }

  ui.input.value = '';
  resizeInput(ui);
  setBusy(ui, true);
  const typing = addTyping(ui);

  try {
    const response = await fetch(ASSISTANT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.history }),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        data?.message ||
        (response.status === 429
          ? 'Esperá un momento antes de volver a preguntar.'
          : 'No pude responder en este momento.');
      throw new Error(message);
    }

    const reply = String(data?.reply ?? '').trim();
    if (!reply) throw new Error('El asistente no devolvió una respuesta.');

    typing.remove();
    addMessage(ui, 'bot', reply, {
      sources: data.sources,
      notice: data.notice,
    });
    state.history.push({ role: 'assistant', content: reply });
    if (state.history.length > MAX_HISTORY) {
      state.history = state.history.slice(-MAX_HISTORY);
    }
  } catch (error) {
    typing.remove();
    const link = document.createElement('a');
    link.href = whatsappUrl('Hola Nocturna Pizza, tengo una consulta.');
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Escribinos por WhatsApp';
    const row = addMessage(
      ui,
      'bot',
      `${error.message || 'No pude responder en este momento.'} Podés intentar de nuevo o `,
    );
    row.querySelector('.np-assistant__bubble')?.appendChild(link);
    row.querySelector('.np-assistant__bubble')?.append('.');
  } finally {
    setBusy(ui, false);
    scrollToBottom(ui.messages);
    if (state.open) ui.input.focus();
  }
}

function togglePanel(force) {
  const ui = window.__npAssistantUi;
  if (!ui) return;

  state.open = typeof force === 'boolean' ? force : !state.open;
  ui.root.classList.toggle('is-open', state.open);
  ui.launcher.setAttribute('aria-expanded', String(state.open));
  ui.launcher.setAttribute('aria-label', state.open ? 'Cerrar asistente de Nocturna Pizza' : 'Abrir asistente de Nocturna Pizza');
  if (state.open) {
    requestAnimationFrame(() => ui.input.focus());
    scrollToBottom(ui.messages);
  } else {
    ui.launcher.focus();
  }
}

async function init() {
  if (document.querySelector('[data-np-assistant]')) return;

  let config = null;
  try {
    const response = await fetch(CONFIG_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    config = await response.json();
  } catch {
    return;
  }

  if (!config?.assistantEnabled) return;

  if (config.whatsappNumber) state.whatsapp = String(config.whatsappNumber);

  injectStyles();
  const ui = buildWidget();
  window.__npAssistantUi = ui;

  addMessage(
    ui,
    'bot',
    '¡Hola! Soy el asistente de Nocturna Pizza. Puedo contarte el menú, los precios, los horarios, cómo pedir y cómo funciona el Pase Nocturno. ¿Qué querés saber?',
  );

  ui.launcher.addEventListener('click', () => togglePanel());
  ui.close.addEventListener('click', () => togglePanel(false));
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(ui.input.value);
  });
  ui.input.addEventListener('input', () => resizeInput(ui));
  ui.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(ui.input.value);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      event.preventDefault();
      togglePanel(false);
    }
  });
}

init();
