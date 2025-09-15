// Core helpers and element refs for Cadastro de Serviços (Admin)
// ES modules inspired by funcionarios/banhoetosa structure

export const API = `${API_CONFIG.BASE_URL}/admin/servicos`;
export const API_GRUPOS = `${API_CONFIG.BASE_URL}/admin/servicos/grupos`;

// DOM elements
export const els = {
  form: document.getElementById('serv-form'),
  inputId: document.getElementById('serv-id'),
  inputNome: document.getElementById('serv-nome'),
  selectGrupo: document.getElementById('serv-grupo'),
  inputDuracao: document.getElementById('serv-duracao'),
  inputCusto: document.getElementById('serv-custo'),
  inputValor: document.getElementById('serv-valor'),
  selectPorte: document.getElementById('serv-porte'),
  submitLabel: document.getElementById('serv-submit-label'),
  btnCancelar: document.getElementById('serv-cancelar'),

  tbody: document.getElementById('serv-tbody'),
  empty: document.getElementById('serv-empty'),
};

// Client state for list + filters
export const state = {
  servicos: [],
  grupos: [],
  filters: {
    func: '', // 'esteticista' | 'veterinario' | ''
    grupoIds: new Set(),
  },
};

export function getGrupoIdFromItem(item) {
  return String(
    (item && (item.grupo?._id || item.grupo)) || ''
  );
}

export function getFilteredServicos() {
  let arr = state.servicos.slice();
  const func = state.filters.func;
  if (func) {
    arr = arr.filter((it) => {
      const tipos = (it.grupo && it.grupo.tiposPermitidos) || [];
      return Array.isArray(tipos) && tipos.includes(func);
    });
  }
  if (state.filters.grupoIds.size > 0) {
    arr = arr.filter((it) => state.filters.grupoIds.has(getGrupoIdFromItem(it)));
  }
  return arr;
}

export function getToken() {
  try { return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || ''; }
  catch { return ''; }
}

export async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Erro HTTP ${res.status}`);
  }
  return res.json();
}

export function fmtMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function getSelectedValues(selectEl) {
  return Array.from(selectEl?.selectedOptions || []).map(o => o.value);
}
export function setSelectedValues(selectEl, values) {
  if (!selectEl) return;
  const set = new Set(values);
  Array.from(selectEl.options || []).forEach(o => { o.selected = set.has(o.value); });
}
export function selectOnlyTodos() {
  // Agora o cadastro não tem mais a opção "Todos" visualmente.
  // Consideramos "nenhuma seleção" como "Todos" ao salvar.
  if (!els.selectPorte) return;
  setSelectedValues(els.selectPorte, []);
}
