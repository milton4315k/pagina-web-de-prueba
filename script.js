const WHATSAPP_NUMBER = '5491128493108';
const DEFAULT_MESSAGE = 'Hola Nocturna Pizza, quiero hacer un pedido.';

const whatsappUrl = (message = DEFAULT_MESSAGE) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

function setWhatsAppLinks() {
  document.querySelectorAll('[data-whatsapp]').forEach((link) => {
    const message = link.dataset.whatsapp || DEFAULT_MESSAGE;
    link.href = whatsappUrl(message);
  });

  document.querySelectorAll('[data-order]').forEach((link) => {
    const product = link.dataset.order;
    link.href = whatsappUrl(
      `Hola Nocturna Pizza, quiero pedir la pizza ${product}. ¿Me contás disponibilidad, precio y formas de entrega?`,
    );
  });
}

function setupMobileMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');

  if (!toggle || !nav) return;

  const closeMenu = () => {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    nav.classList.toggle('is-open', !isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 820) closeMenu();
  });
}

function setActiveNavigation() {
  const currentPage = document.body.dataset.page;
  if (!currentPage) return;

  document.querySelectorAll(`[data-nav="${currentPage}"]`).forEach((link) => {
    link.setAttribute('aria-current', 'page');
  });
}

function setCurrentYear() {
  document.querySelectorAll('[data-year]').forEach((element) => {
    element.textContent = new Date().getFullYear();
  });
}

function setupRevealAnimations() {
  const elements = document.querySelectorAll('.reveal');
  if (!elements.length) return;

  if (!('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, instance) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        target.classList.add('is-visible');
        // El delay escalonado se limpia al aparecer: si no, el hover de la
        // card se sentiría tardío.
        setTimeout(() => {
          target.style.transitionDelay = '';
        }, 1100);
        instance.unobserve(target);
      });
    },
    { threshold: 0.12 },
  );

  elements.forEach((element) => observer.observe(element));
}

/**
 * Los hijos de una grilla aparecen en cascada en vez de todos juntos.
 * Se comparte con js/menu.js, que arma las cards después.
 */
window.nocturnaStagger = (root, selector = '.reveal', step = 90) => {
  root.querySelectorAll(selector).forEach((item, index) => {
    if (item.classList.contains('is-visible')) return;
    item.style.transitionDelay = `${Math.min(index, 6) * step}ms`;
  });
};

function setupRevealStagger() {
  ['.pizza-grid', '.gallery-grid', '.testimonial-grid', '.steps-grid'].forEach((selector) => {
    document.querySelectorAll(selector).forEach((group) => {
      window.nocturnaStagger(group, ':scope > .reveal');
    });
  });
}

/** Barra de progreso de lectura, arriba de todo. */
function setupScrollProgress() {
  const bar = document.querySelector('.scroll-progress span');
  if (!bar) return;

  let ticking = false;
  const update = () => {
    const height = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = height > 0 ? Math.min(window.scrollY / height, 1) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  window.addEventListener('resize', update, { passive: true });
  update();
}

function setupHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
}

// Si js/pase-ui.js no carga (import roto, navegador viejo, red…), el botón 🔑
// no se queda mudo: manda a WhatsApp para pedir el pase a mano. El módulo del
// pase marca el botón como propio cuando queda montado; sin esa marca, este
// manejador se hace cargo del clic.
const PASE_FALLBACK_MESSAGE = 'Hola Nocturna Pizza, quiero crear mi Pase Nocturno.';

function setupPaseFallback() {
  const trigger = document.querySelector('[data-pase-trigger]');
  if (!trigger) return;

  window.nocturnaPaseFallback = () => {
    const url = whatsappUrl(PASE_FALLBACK_MESSAGE);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
  };

  trigger.addEventListener('click', () => {
    if (trigger.hasAttribute('data-pase-ready')) return;
    window.nocturnaPaseFallback();
  });
}

// Los filtros de menú y el formulario de contacto viven en módulos ES
// (js/menu.js y js/contacto.js) porque necesitan la API.

document.addEventListener('DOMContentLoaded', () => {
  setWhatsAppLinks();
  setupMobileMenu();
  setupPaseFallback();
  setActiveNavigation();
  setCurrentYear();
  setupRevealStagger();
  setupRevealAnimations();
  setupScrollProgress();
  setupHeaderScroll();
});
