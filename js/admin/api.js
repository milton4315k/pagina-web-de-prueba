// Cliente de la API del panel. La sesión vive en una cookie httpOnly que
// no podemos leer desde JS: por eso no guardamos tokens en localStorage.

const API_BASE = '/api/admin';
const DEFAULT_TIMEOUT = 10000;

export class AdminApiError extends Error {
  constructor(message, status, details = []) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

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
      if (response.status === 401) {
        window.location.href = new URL('login.html', window.location.href).href;
      }
      throw new AdminApiError(
        data.message || `Error ${response.status}`,
        response.status,
        data.details,
      );
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AdminApiError('La request tardó demasiado. Revisá tu conexión.', 0);
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

export const adminApi = {
  session: () => request('/session'),
  requestLogin: () => request('/login/request', { method: 'POST' }),
  verifyLogin: (token) => request('/login/verify', { method: 'POST', body: { token } }),
  logout: () => request('/logout', { method: 'POST' }),

  orders: (filters = {}) => request(`/orders${query(filters)}`),
  order: (id) => request(`/orders/${id}`),
  setOrderStatus: (id, status) =>
    request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  messages: (filters = {}) => request(`/messages${query(filters)}`),
  markMessageRead: (id) => request(`/messages/${id}/read`, { method: 'PATCH' }),

  members: (filters = {}) => request(`/members${query(filters)}`),
  member: (id) => request(`/members/${id}`),
  setMemberPoints: (id, points, note) =>
    request(`/members/${id}/points`, { method: 'PATCH', body: { points, note } }),
  confirmRedemption: (id, benefit, notes = '') =>
    request(`/members/${id}/redeem`, { method: 'POST', body: { benefit, notes } }),
  birthdays: (days = 30) => request(`/members/birthdays?days=${days}`),
};