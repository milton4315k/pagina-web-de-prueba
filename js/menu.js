// Menú dinámico: pide el catálogo a la API y reemplaza las cards estáticas.
// Si la API no responde, deja el HTML de fallback tal como está.

import { api } from './api.js';

const grid = document.querySelector('[data-menu-grid]');
const statusLine = document.querySelector('[data-menu-status]');
const countLabel = document.querySelector('[data-menu-count]');
const filterList = document.querySelector('[data-filter-list]');

const FALLBACK_COUNTS = {
  classic: 'Clásica',
  special: 'Especial',
  vegetarian: 'Vegetal',
  picante: 'Picante',
};

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const formatPrice = (value) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function cardTemplate(pizza) {
  const tag = FALLBACK_COUNTS[pizza.category] ?? pizza.categoryName;
  const ingredients = pizza.ingredients
    ? `<ul class="ingredients">${pizza.ingredients
        .split(',')
        .map((item) => `<li>${escapeHtml(item.trim())}</li>`)
        .join('')}</ul>`
    : '';

  const image = pizza.imageUrl
    ? `<div class="menu-card__image"><img src="${escapeHtml(pizza.imageUrl)}" alt="${escapeHtml(
        pizza.name,
      )}" loading="lazy" /><span class="card-tag">${escapeHtml(tag)}</span></div>`
    : '';

  return `
    <article class="menu-card reveal" data-category="${escapeHtml(pizza.category)}">
      ${image}
      <div class="menu-card__body">
        <div class="menu-card__heading">
          <h3>${escapeHtml(pizza.name)}</h3>
          <span class="price">$ ${formatPrice(pizza.price)}</span>
        </div>
        ${pizza.description ? `<p>${escapeHtml(pizza.description)}</p>` : ''}
        ${ingredients}
        <a class="order-link" href="https://wa.me/5491128493108" target="_blank" rel="noopener"
           data-order="${escapeHtml(pizza.name)}">
          Pedir esta pizza <span class="button-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </article>`;
}

function renderFilters(categories) {
  if (!filterList || !categories.length) return;

  const buttons = [
    `<button class="filter-button is-active" type="button" data-filter="all" aria-pressed="true">Todas</button>`,
    ...categories.map(
      (category) =>
        `<button class="filter-button" type="button" data-filter="${escapeHtml(
          category.slug,
        )}" aria-pressed="false">${escapeHtml(category.name)}</button>`,
    ),
  ].join('');

  filterList.innerHTML = buttons;
}

function applyFilter(filter) {
  const cards = grid.querySelectorAll('[data-category]');
  let visible = 0;

  filterList?.querySelectorAll('[data-filter]').forEach((button) => {
    const isActive = button.dataset.filter === filter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  cards.forEach((card) => {
    const matches = filter === 'all' || card.dataset.category === filter;
    card.classList.toggle('is-hidden', !matches);
    if (matches) visible += 1;
  });

  if (countLabel) countLabel.textContent = plural(visible, 'pizza', 'pizzas');
}

function bindFilters() {
  filterList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    applyFilter(button.dataset.filter);
  });
}

function setupReveal(root) {
  const elements = root.querySelectorAll('.reveal:not(.is-visible)');
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

async function loadMenu() {
  try {
    const [{ pizzas }, { categories }] = await Promise.all([
      api.pizzas({ available: 'true' }),
      api.categorias().catch(() => ({ categories: [] })),
    ]);

    if (!pizzas.length) throw new Error('catálogo vacío');

    grid.innerHTML = pizzas.map(cardTemplate).join('');
    renderFilters(categories);
    grid.hidden = false;
    applyFilter('all');
    // Cascada de aparición, igual que en la portada.
    if (window.nocturnaStagger) window.nocturnaStagger(grid);
    setupReveal(grid);
    if (statusLine) statusLine.textContent = '';
  } catch {
    // La API no está: mostramos el HTML estático y avisamos.
    grid.hidden = false;
    if (countLabel) countLabel.textContent = plural(grid.children.length, 'pizza', 'pizzas');
    if (statusLine) {
      statusLine.textContent =
        'Estamos mostrando la carta de muestra. Si ves precios viejos, escribinos y te confirmamos.';
    }
  }
}

if (grid) {
  bindFilters();
  loadMenu();
}