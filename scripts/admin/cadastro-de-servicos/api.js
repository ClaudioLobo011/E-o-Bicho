import { API, API_GRUPOS, fetchJSON } from './core.js';

export const api = {
  grupos: () => fetchJSON(API_GRUPOS),
  list:   () => fetchJSON(API),
  get:    (id) => fetchJSON(`${API}/${id}`),
  create: (payload) => fetchJSON(API, { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => fetchJSON(`${API}/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  remove: (id) => fetchJSON(`${API}/${id}`, { method: 'DELETE' }),
};

export default api;

