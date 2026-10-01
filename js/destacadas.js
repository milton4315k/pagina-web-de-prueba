// Pizzas destacadas de la portada: las que la base marca como is_featured.
// Si la API no responde, queda el HTML estático que ya está en index.html.

import { api } from './api.js';

const grid = document.querySelector('[data-featured-grid]');

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const formatPrice = (value) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);

function cardTemplate(pizza, index) {
  const tags = ['La esencial', 'Más elegida', 'Edición limitada'];
  const tag = tags[index] ?? pizza.categoryName;
  const image = pizza.imageUrl
    ? `<img src="${escapeHtml(pizza.imageUrl)}" alt="Pizza ${escapeHtml(pizza.name)} de Nocturna Pizza" loading="lazy" />`
    : '';

  return `
    <article class="pizza-card reveal">
      <div class="pizza-card__image">
        ${image}
        <span class="card-tag">${escapeHtml(tag)}</span>
      </div>
      <div class="pizza-card__body">
        <div class="pizza-card__heading"><h3>${escapeHtml(pizza.name)}</h3></div>
        ${pizza.description ? `<p>${escapeHtml(pizza.description)}</p>` : ''}
        <div class="pizza-card__footer">
          <span class="pizza-card__price">$ ${formatPrice(pizza.price)}</span>
          <a class="text-link" href="menu.html">Descubrir <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </article>`;
}

function setupReveal(root) {
  const elements = root.querySelectorAll('.reveal');
  if (!elements.length) return;

  if (!('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, instance) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        instance.unobserve(entry.target);
      }
    },
    { threshold: 0.12 },
  );

  elements.forEach((element) => observer.observe(element));
}

async function loadFeatured() {
  try {
    const { pizzas } = await api.pizzas({ featured: 'true', available: 'true' });
    if (!pizzas.length) throw new Error('sin destacadas');

    grid.innerHTML = pizzas.slice(0, 3).map(cardTemplate).join('');
    grid.hidden = false;
    setupReveal(grid);
  } catch {
    grid.hidden = false;
    grid.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
  }
}

if (grid) loadFeatured();