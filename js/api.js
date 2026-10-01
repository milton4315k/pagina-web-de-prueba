// Cliente de la API. Todas las rutas son relativas: en producción Netlify
// proxya /api/* al servicio de Render, así que nunca hay CORS ni una URL
// de API hardcodeada.

const API_BASE = '/api';
const DEFAULT_TIMEOUT = 6000;

export class ApiError extends Error {
  constructor(message, status, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new ApiError(
        data.message || `Error ${response.status}`,
        response.status,
        data.details,
      );
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError('La request tardó demasiado.', 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  health: () => request('/health'),
  categorias: () => request('/categories'),
  pizzas: (filters = {}) => request(`/pizzas${query(filters)}`),
  pizzaBySlug: (slug) => request(`/pizzas/${encodeURIComponent(slug)}`),
  crearPedido: (payload) => request('/orders', { method: 'POST', body: payload }),
  estadoPedido: (code) => request(`/orders/${encodeURIComponent(code)}`),
  enviarMensaje: (payload) => request('/messages', { method: 'POST', body: payload }),
};

export { request };