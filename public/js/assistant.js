// Asistente virtual con OpenAI.
//
// Se apoya en /api/assistant: el navegador manda la conversación y el servidor
// responde. La API key vive solo en el backend. Si el asistente no está
// configurado, el widget ni se muestra.

const STYLES = `
[data-assistant-root] { position: fixed; right: 18px; bottom: 18px; z-index: 60;
  font-family: 'DM Sans', system-ui, sans-serif; }
[data-assistant-toggle] { display: inline-flex; align-items: center; gap: 8px;
  min-height: 48px; padding: 0 18px; border: 0; border-radius: 999px; cursor: pointer;
  background: linear-gradient(135deg, #c98a52, #e0a86a); color: #171514;
  font: inherit; font-weight: 700; font-size: .8rem; letter-spacing: .04em;
  box-shadow: 0 12px 30px rgba(0,0,0,.35); }
[data-assistant-toggle]:hover { filter: brightness(1.05); }
.assistant-panel { position: fixed; right: 18px; bottom: 78px; z-index: 60;
  width: min(370px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 110px));
  display: flex; flex-direction: column; border-radius: 18px; overflow: hidden;
  background: #1d1a18; color: #f4ece2; border: 1px solid rgba(255,255,255,.1);
  box-shadow: 0 24px 70px rgba(0,0,0,.55); }
.assistant-panel[hidden] { display: none; }
.assistant-head { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.08); }
.assistant-head strong { font-size: .86rem; letter-spacing: .02em; }
.assistant-head small { display: block; color: #a89a8c; font-size: .68rem; font-weight: 400; }
.assistant-close { border: 0; background: transparent; color: #a89a8c; font-size: 1.2rem;
  line-height: 1; cursor: pointer; padding: 4px 6px; }
.assistant-close:hover { color: #f4ece2; }
.assistant-log { flex: 1; overflow-y: auto; padding: 14px; display: flex;
  flex-direction: column; gap: 10px; }
.assistant-msg { max-width: 85%; padding: 9px 12px; border-radius: 13px;
  font-size: .82rem; line-height: 1.5; white-space: pre-wrap; }
.assistant-msg--bot { align-self: flex-start; background: #2a2522; border-bottom-left-radius: 4px; }
.assistant-msg--user { align-self: flex-end; background: #c98a52; color: #171514;
  border-bottom-right-radius: 4px; }
.assistant-msg--typing { color: #a89a8c; font-style: italic; }
.assistant-form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid rgba(255,255,255,.08); }
.assistant-form input { flex: 1; min-height: 42px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,.14); background: #141211; color: #f4ece2;
  font: inherit; font-size: .85rem; }
.assistant-form input:focus-visible { outline: 2px solid #c98a52; outline-offset: 1px; }
.assistant-form button { min-height: 42px; padding: 0 14px; border: 0; border-radius: 10px;
  background: #c98a52; color: #171514; font: inherit; font-weight: 700; cursor: pointer; }
.assistant-form button:disabled { opacity: .55; cursor: default; }
`;

const QUICK_REPLIES = [
  '¿Qué pizzas tienen?',
  '¿Hacen envío a domicilio?',
  '¿Cómo funciona el Pase Nocturno?',
];

function botMessage(text, extraClass = '') {
  const div = document.createElement('div');
  div.className = `assistant-msg assistant-msg--bot ${extraClass}`.trim();
  div.textContent = text;
  return div;
}

function userMessage(text) {
  const div = document.createElement('div');
  div.className = 'assistant-msg assistant-msg--user';
  div.textContent = text;
  return div;
}

async function mount() {
  // Solo si el asistente está configurado.
  let config = {};
  try {
    config = await fetch('/api/config').then((response) => response.json());
  } catch {
    return;
  }
  if (!config.assistantEnabled) return;

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);

  const root = document.createElement('div');
  root.setAttribute('data-assistant-root', '');
  root.innerHTML = `
    <button type="button" data-assistant-toggle aria-haspopup="dialog">
      <span aria-hidden="true">🍕</span> Preguntame
    </button>
    <section class="assistant-panel" data-assistant-panel hidden aria-label="Asistente virtual">
      <header class="assistant-head">
        <span>
          <strong>Asistente Nocturna</strong>
          <small>Menú, envíos y Pase Nocturno</small>
        </span>
        <button type="button" class="assistant-close" data-assistant-close aria-label="Cerrar">×</button>
      </header>
      <div class="assistant-log" data-assistant-log></div>
      <form class="assistant-form" data-assistant-form>
        <input type="text" name="q" placeholder="Escribí tu pregunta…" autocomplete="off"
               maxlength="600" aria-label="Tu pregunta" />
        <button type="submit">Enviar</button>
      </form>
    </section>`;
  document.body.append(root);

  const panel = root.querySelector('[data-assistant-panel]');
  const log = root.querySelector('[data-assistant-log]');
  const form = root.querySelector('[data-assistant-form]');
  const input = form.querySelector('input');
  const submit = form.querySelector('button');

  const history = [];
  let opened = false;

  function addBot(text, extraClass) {
    const element = botMessage(text, extraClass);
    log.append(element);
    log.scrollTop = log.scrollHeight;
    return element;
  }

  function openPanel() {
    panel.hidden = false;
    if (!opened) {
      opened = true;
      addBot('¡Hola! Soy el asistente de Nocturna Pizza 🍕 ¿En qué te ayudo?');
      const quick = document.createElement('div');
      quick.className = 'assistant-msg assistant-msg--bot';
      quick.style.cssText = 'max-width:100%;background:transparent;padding:0;display:flex;flex-wrap:wrap;gap:6px';
      for (const text of QUICK_REPLIES) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = text;
        chip.style.cssText =
          'border:1px solid rgba(255,255,255,.18);background:transparent;color:#e0a86a;' +
          'border-radius:999px;padding:5px 11px;font:inherit;font-size:.72rem;cursor:pointer';
        chip.addEventListener('click', () => {
          input.value = text;
          send();
        });
        quick.append(chip);
      }
      log.append(quick);
    }
    input.focus();
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;

    log.append(userMessage(text));
    log.scrollTop = log.scrollHeight;
    input.value = '';
    history.push({ role: 'user', content: text });

    submit.disabled = true;
    input.disabled = true;
    const typing = addBot('Escribiendo…', 'assistant-msg--typing');

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12) }),
      });
      const data = await response.json().catch(() => ({}));
      typing.remove();

      if (!response.ok || !data.reply) {
        addBot(data.message || 'No pude responder ahora. Probá de nuevo en un momento.');
        return;
      }

      history.push({ role: 'assistant', content: data.reply });
      addBot(data.reply);
    } catch {
      typing.remove();
      addBot('No pude conectar con el asistente. Revisá tu conexión.');
    } finally {
      submit.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  root.querySelector('[data-assistant-toggle]').addEventListener('click', openPanel);
  root.querySelector('[data-assistant-close]').addEventListener('click', () => {
    panel.hidden = true;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
