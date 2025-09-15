import { getToken } from './core.js';

// Elements
const E = {
  btnTabCadastro: document.getElementById('tab-btn-cadastro'),
  btnTabPrecos:   document.getElementById('tab-btn-precos'),
  tabCadastro:    document.getElementById('tab-cadastro'),
  tabPrecos:      document.getElementById('tab-precos'),

  servInput:  document.getElementById('ap-serv-input'),
  servSug:    document.getElementById('ap-serv-sug'),
  servId:     document.getElementById('ap-serv-id'),
  servPorteInfo: document.getElementById('ap-serv-porte-info'),

  tipo:       document.getElementById('ap-tipo'),
  porte:      document.getElementById('ap-porte'),
  store:      document.getElementById('ap-store'),

  replCusto:  document.getElementById('ap-repl-custo'),
  replCustoBtn: document.getElementById('ap-repl-custo-btn'),
  replValor:  document.getElementById('ap-repl-valor'),
  replValorBtn: document.getElementById('ap-repl-valor-btn'),

  gridBody:   document.getElementById('ap-grid-tbody'),
  gridEmpty:  document.getElementById('ap-grid-empty'),
  saveBtn:    document.getElementById('ap-save-btn'),
};

const API_BASE = API_CONFIG.BASE_URL;

// --- Species/breeds loader from data/Racas-leitura.js ---
let SPECIES_MAP = null; // { cachorro:{portes:{mini:[],...}, all:[], map:{}}, gato:[...], passaro:[...], ... }
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase();

async function loadSpeciesMap() {
  if (SPECIES_MAP) return SPECIES_MAP;
  const base = (window.basePath || '../../');
  const url = base + 'data/Racas-leitura.js';
  try {
    const txt = await fetch(url).then(r => r.text());
    const species = {};
    let dogMap = { mini:[], pequeno:[], medio:[], grande:[], gigante:[] };
    const reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
    let m;
    while ((m = reDogGlobal.exec(txt))) {
      const key = m[1].toLowerCase();
      const body = m[2];
      const list = body.split(/\n+/).map(x => x.trim())
        .filter(x => x && !x.startsWith('//') && x !== '...')
        .map(x => x.replace(/\*.*?\*/g, ''))
        .map(x => x.replace(/\s*\(duplicata.*$/i, ''))
        .map(x => x.replace(/\s*[ï¿½?"-].*$/,'').replace(/\s*-\s*registro.*$/i,''));
      dogMap[key] = Array.from(new Set(list));
    }
    const dogAll = Array.from(new Set([
      ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante
    ]));
    const dogLookup = {};
    dogAll.forEach(n => { dogLookup[norm(n)] =
      dogMap.mini.includes(n) ? 'mini' :
      dogMap.pequeno.includes(n) ? 'pequeno' :
      dogMap.medio.includes(n) ? 'medio' :
      dogMap.grande.includes(n) ? 'grande' : 'gigante';
    });
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    const simpleSpecies = ['gatos','gato','passaros','passaro','peixes','peixe','roedores','roedor','lagartos','lagarto','tartarugas','tartaruga','exoticos','exotico'];
    for (const sp of simpleSpecies) {
      const m2 = new RegExp(sp + "\\s*{([\\s\\S]*?)}","i").exec(txt);
      if (m2) {
        const list = m2[1]
          .split(/\n+/)
          .map(x => x.trim())
          .filter(x => x && !x.startsWith('//') && x !== '...')
          .map(x => x.replace(/\*.*?\*/g, ''))
          .map(x => x.replace(/\s*\(duplicata.*$/i, ''))
          .map(x => x.replace(/\s*[ï¿½?"-].*$/, '').replace(/\s*-\s*registro.*$/i, ''));
        const singular =
          /roedores$/i.test(sp)   ? 'roedor'     :
          /gatos$/i.test(sp)      ? 'gato'       :
          /passaros$/i.test(sp)   ? 'passaro'    :
          /peixes$/i.test(sp)     ? 'peixe'      :
          /lagartos$/i.test(sp)   ? 'lagarto'    :
          /tartarugas$/i.test(sp) ? 'tartaruga'  :
          /exoticos$/i.test(sp)   ? 'exotico'    :
          sp.replace(/s$/, '');
        species[singular] = Array.from(new Set(list));
      }
    }
    SPECIES_MAP = species;
    return species;
  } catch (e) {
    console.warn('Falha ao ler Racas-leitura.js', e);
    SPECIES_MAP = null;
    return null;
  }
}

function populateTiposSelect() {
  if (!E.tipo) return;
  const opts = [
    { v: 'todos', l: 'Todos' },
    { v: 'cachorro', l: 'Cachorro' },
    { v: 'gato', l: 'Gato' },
    { v: 'passaro', l: 'Pássaro' },
    { v: 'peixe', l: 'Peixe' },
    { v: 'roedor', l: 'Roedor' },
    { v: 'lagarto', l: 'Lagarto' },
    { v: 'tartaruga', l: 'Tartaruga' },
    { v: 'exotico', l: 'Exótico' },
  ];
  E.tipo.innerHTML = '';
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.v; opt.textContent = o.l; E.tipo.appendChild(opt);
  });
}


function setPorteOptionsFromService(service) {
  const el = E.porte; if (!el) return;
  const portes = Array.isArray(service?.porte) ? service.porte : [];
  const all = ['Todos','Mini','Pequeno','Médio','Grande','Gigante'];
  el.innerHTML = '';
  const enabled = (portes.includes('Todos') || !portes.length)
    ? all
    : portes.map(s => String(s).replace('MǸdio','Médio').replace('M?dio','Médio').replace('Mdio','Médio'));
  for (const p of all) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p; opt.disabled = !enabled.includes(p);
    el.appendChild(opt);
  }
  if (enabled.includes('Todos')) el.value = 'Todos';
  else el.value = enabled[0] || 'Mini';
  const info = enabled.join(', ');
  if (E.servPorteInfo) E.servPorteInfo.textContent = `Portes permitidos: ${info}`;
}

async function loadStores() {
  const res = await fetch(`${API_BASE}/stores`);
  const list = await res.json().catch(() => []);
  E.store.innerHTML = '';
  list.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s._id; opt.textContent = s.nome; E.store.appendChild(opt);
  });
}

function clearSugList() { if (E.servSug) { E.servSug.innerHTML = ''; E.servSug.classList.add('hidden'); } }

async function searchServices(q) {
  const res = await fetch(`${API_BASE}/func/servicos/buscar?q=${encodeURIComponent(q)}&limit=20`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
  if (!res.ok) return [];
  return res.json();
}

function renderServiceSug(list) {
  clearSugList();
  if (!E.servSug || !list.length) return;
  E.servSug.classList.remove('hidden');
  list.forEach(item => {
    const li = document.createElement('li');
    li.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer';
    li.textContent = `${item.nome} ${item.grupo ? '(' + item.grupo.nome + ')' : ''}`;
    li.dataset.id = item._id;
    li.__item = item;
    E.servSug.appendChild(li);
  });
}

function breedsForSelection(tipo, porte, service) {
  const data = SPECIES_MAP || {};
  const t = tipo || 'cachorro';
  if (t === 'todos') {
    const dog = data.cachorro || { all: [] };
    const all = new Set([ ...(dog.all || []) ]);
    for (const k of Object.keys(data)) {
      if (k === 'cachorro') continue;
      const arr = Array.isArray(data[k]) ? data[k] : [];
      arr.forEach(n => all.add(n));
    }
    return Array.from(all);
  }
  if (t === 'cachorro') {
    const dog = data.cachorro || { portes: {} };
    if (!porte || porte === 'Todos' || (service?.porte||[]).includes('Todos')) {
      const { mini=[], pequeno=[], medio=[], grande=[], gigante=[] } = dog.portes || {};
      return [...new Set([ ...mini, ...pequeno, ...medio, ...grande, ...gigante ])];
    }
    const key = norm(porte);
    return dog.portes?.[key] || [];
  }
  return data[t] || [];
}

async function loadPrices(serviceId, storeId, tipo) {
  if (!serviceId || !storeId) return [];
  let url = `${API_BASE}/admin/servicos/precos?serviceId=${serviceId}&storeId=${storeId}`;
  if (tipo && tipo !== 'todos') {
    url += `&tipo=${encodeURIComponent(tipo)}`;
  }
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
  if (!res.ok) return [];
  return res.json();
}

async function savePrices(serviceId, storeId, tipo, items) {
  const res = await fetch(`${API_BASE}/admin/servicos/precos/bulk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ serviceId, storeId, tipo, items })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Falha ao salvar');
  }
  return res.json();
}

function renderGrid(breeds, overrides) {
  E.gridBody.innerHTML = '';
  const map = new Map((overrides || []).map(o => [norm(o.raca), o]));
  if (!breeds.length) { E.gridEmpty.classList.remove('hidden'); return; }
  E.gridEmpty.classList.add('hidden');
  for (const name of breeds) {
    const ov = map.get(norm(name)) || { custo: '', valor: '' };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2 text-gray-800">${name}</td>
      <td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="${ov.custo === '' ? '' : Number(ov.custo)}" /></td>
      <td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="${ov.valor === '' ? '' : Number(ov.valor)}" /></td>
    `;
    tr.dataset.raca = name;
    E.gridBody.appendChild(tr);
  }
}

function getGridItems() {
  const rows = Array.from(E.gridBody?.querySelectorAll('tr') || []);
  return rows.map(r => {
    const inputs = r.querySelectorAll('input');
    const custo = parseFloat(inputs[0]?.value || '0');
    const valor = parseFloat(inputs[1]?.value || '0');
    return { raca: r.dataset.raca || '', custo: Number.isFinite(custo) ? custo : 0, valor: Number.isFinite(valor) ? valor : 0 };
  });
}

async function refreshGrid() {
  const serviceId = E.servId?.value;
  const storeId = E.store?.value;
  const tipo = E.tipo?.value;
  if (!serviceId || !storeId || !tipo) {
    E.gridBody.innerHTML = '';
    E.gridEmpty.classList.remove('hidden');
    return;
  }
  const service = E.servInput.__selectedService || null;
  const porte = E.porte?.value || 'Todos';
  const breeds = breedsForSelection(tipo, porte, service);
  const overrides = await loadPrices(serviceId, storeId, tipo);
  renderGrid(breeds, overrides);
}

function bindEvents() {
  // Tabs
  E.btnTabCadastro?.addEventListener('click', () => {
    E.tabCadastro?.classList.remove('hidden');
    E.tabPrecos?.classList.add('hidden');
    E.btnTabCadastro?.classList.add('bg-primary','text-white');
    E.btnTabPrecos?.classList.remove('bg-primary','text-white');
    E.btnTabPrecos?.classList.add('border','border-gray-300','text-gray-700');
  });
  E.btnTabPrecos?.addEventListener('click', () => {
    E.tabPrecos?.classList.remove('hidden');
    E.tabCadastro?.classList.add('hidden');
    E.btnTabPrecos?.classList.add('bg-primary','text-white');
    E.btnTabCadastro?.classList.remove('bg-primary','text-white');
    E.btnTabCadastro?.classList.add('border','border-gray-300','text-gray-700');
  });

  // Serviço search + choose
  let searchTimer = null;
  E.servInput?.addEventListener('input', () => {
    const q = E.servInput.value.trim();
    E.servId.value = '';
    E.servInput.__selectedService = null;
    if (searchTimer) clearTimeout(searchTimer);
    if (!q) { clearSugList(); return; }
    searchTimer = setTimeout(async () => {
      const list = await searchServices(q);
      renderServiceSug(list);
    }, 200);
  });
  E.servSug?.addEventListener('click', (ev) => {
    const li = ev.target?.closest('li');
    if (!li || !li.__item) return;
    const it = li.__item;
    E.servInput.value = it.nome;
    E.servId.value = it._id;
    E.servInput.__selectedService = it;
    setPorteOptionsFromService(it);
    clearSugList();
    refreshGrid();
  });

  // Filters
  E.tipo?.addEventListener('change', () => {
    const t = E.tipo?.value;
    if (t === 'todos') {
      if (E.porte) { E.porte.value = 'Todos'; E.porte.disabled = true; }
    } else {
      if (E.porte) { E.porte.disabled = false; }
    }
    refreshGrid();
  });
  E.porte?.addEventListener('change', refreshGrid);
  E.store?.addEventListener('change', refreshGrid);

  // Replicate
  const applyToAll = (idx, value) => {
    const v = String(value || '').trim();
    if (v === '') return;
    E.gridBody.querySelectorAll('tr').forEach(tr => {
      const inp = tr.querySelectorAll('input')[idx];
      if (inp) inp.value = v;
    });
  };
  E.replCustoBtn?.addEventListener('click', () => applyToAll(0, E.replCusto?.value));
  E.replValorBtn?.addEventListener('click', () => applyToAll(1, E.replValor?.value));

  // Save
  E.saveBtn?.addEventListener('click', async () => {
    const serviceId = E.servId?.value;
    const storeId = E.store?.value;
    const tipo = E.tipo?.value;
    if (!serviceId || !storeId || !tipo) { alert('Selecione serviço, tipo e empresa.'); return; } if (tipo === 'todos') { alert('Selecione um Tipo específico para salvar preços.'); return; }
    try {
      const items = getGridItems();
      await savePrices(serviceId, storeId, tipo, items);
      alert('Preços salvos com sucesso.');
      await refreshGrid();
    } catch (e) {
      console.error(e); alert(e?.message || 'Erro ao salvar preços');
    }
  });
}

export async function initPrecosTab() {
  if (!E.tabPrecos) return;
  await loadSpeciesMap();
  populateTiposSelect();
  // Default: 'Todos' selecionado e porte bloqueado
  try { if (E.tipo) E.tipo.value = 'todos'; } catch {}
  try { if (E.porte) { E.porte.disabled = true; E.porte.innerHTML = '<option>Todos</option>'; } } catch {}
  await loadStores();
  bindEvents();
}
