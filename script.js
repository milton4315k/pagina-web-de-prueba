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
        entry.target.classList.add('is-visible');
        instance.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );

  elements.forEach((element) => observer.observe(element));
}

function setupHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
}

function setupMenuFilters() {
  const filterButtons = document.querySelectorAll('[data-filter]');
  const menuCards = document.querySelectorAll('[data-category]');
  const count = document.querySelector('[data-menu-count]');

  if (!filterButtons.length || !menuCards.length) return;

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      let visibleCards = 0;

      filterButtons.forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');

      menuCards.forEach((card) => {
        const matches = filter === 'all' || card.dataset.category === filter;
        card.classList.toggle('is-hidden', !matches);
        if (matches) visibleCards += 1;
      });

      if (count) count.textContent = `${visibleCards} ${visibleCards === 1 ? 'pizza' : 'pizzas'}`;
    });
  });
}

function setupContactForm() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  const status = form.querySelector('[data-form-status]');

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = formData.get('name')?.toString().trim() || 'Un cliente';
    const order = formData.get('order')?.toString().trim() || 'un pedido';
    const method = formData.get('method')?.toString().trim() || 'una consulta';
    const contact = formData.get('contact')?.toString().trim();
    const notes = formData.get('notes')?.toString().trim();

    const message = [
      `Hola Nocturna Pizza, soy ${name}.`,
      `Quiero hacer un pedido: ${order}.`,
      `Modalidad: ${method}.`,
      contact ? `Contacto: ${contact}.` : '',
      notes ? `Detalle: ${notes}` : '',
      '¿Me confirmás disponibilidad y forma de pago?',
    ]
      .filter(Boolean)
      .join('\n');

    if (status) status.textContent = 'Te estamos llevando a WhatsApp…';
    window.open(whatsappUrl(message), '_blank', 'noopener,noreferrer');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setWhatsAppLinks();
  setupMobileMenu();
  setActiveNavigation();
  setCurrentYear();
  setupRevealAnimations();
  setupHeaderScroll();
  setupMenuFilters();
  setupContactForm();
});
