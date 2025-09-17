(function (win) {
  if (!win) return;

  function getToken() {
    try {
      const raw = win.localStorage.getItem('loggedInUser') || 'null';
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.token) {
        return parsed.token;
      }
      return '';
    } catch (err) {
      console.warn('cadastro-servicos/precos: token não disponível', err);
      return '';
    }
  }

  // Elements
  const E = {
    btnTabCadastro: document.getElementById('tab-btn-cadastro'),
    btnTabPrecos: document.getElementById('tab-btn-precos'),
    tabCadastro: document.getElementById('tab-cadastro'),
    tabPrecos: document.getElementById('tab-precos'),

    servInput: document.getElementById('ap-serv-input'),
    servSug: document.getElementById('ap-serv-sug'),
    servId: document.getElementById('ap-serv-id'),
    servPorteInfo: document.getElementById('ap-serv-porte-info'),

    tipo: document.getElementById('ap-tipo'),
    porte: document.getElementById('ap-porte'),
    store: document.getElementById('ap-store'),

    replCusto: document.getElementById('ap-repl-custo'),
    replCustoBtn: document.getElementById('ap-repl-custo-btn'),
    replValor: document.getElementById('ap-repl-valor'),
    replValorBtn: document.getElementById('ap-repl-valor-btn'),

    gridBody: document.getElementById('ap-grid-tbody'),
    gridEmpty: document.getElementById('ap-grid-empty'),
    saveBtn: document.getElementById('ap-save-btn'),
  };

  const API_BASE = (
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) ||
    (win.API_CONFIG && win.API_CONFIG.BASE_URL) ||
    ''
  );

  // --- Species/breeds loader from data/Racas-leitura.js ---
  let SPECIES_MAP = null; // { cachorro:{portes:{mini:[],...}, all:[], map:{}}, gato:[...], passaro:[...], ... }
  let BREED_LOOKUP = null; // Map<normalizedName, Array<tipo>>
  const norm = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();

  const cleanList = (body) => body.split(/\n+/)
    .map(x => x.trim())
    .filter(x => x && !x.startsWith('//') && x !== '...')
    .map(x => x.replace(/\*.*?\*/g, ''))
    .map(x => x.replace(/\s*\(duplicata.*$/i, ''))
    .map(x => x.replace(/\s*[ï¿½?"-].*$/,'').replace(/\s*-\s*registro.*$/i,''));

  function buildFromJson(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload inválido');
    }
    const species = {};
    const lookupSets = new Map();
    const ensureSet = (key) => {
      if (!lookupSets.has(key)) lookupSets.set(key, new Set());
      return lookupSets.get(key);
    };
    const addLookup = (name, tipo) => {
      const key = norm(name);
      if (!key) return;
      ensureSet(key).add(tipo);
    };

    const dogPayload = payload.cachorro || {};
    const portas = dogPayload.portes || {};
    const dogMap = {
      mini: Array.from(new Set(portas.mini || [])),
      pequeno: Array.from(new Set(portas.pequeno || [])),
      medio: Array.from(new Set(portas.medio || [])),
      grande: Array.from(new Set(portas.grande || [])),
      gigante: Array.from(new Set(portas.gigante || [])),
    };
    const dogAll = Array.from(new Set(dogPayload.all || [
      ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante
    ]));
    const dogLookup = {};
    const dogMapPayload = dogPayload.map || {};
    dogAll.forEach(nome => {
      const normalized = norm(nome);
      const porte = dogMapPayload[normalized] || dogMapPayload[nome] ||
        (dogMap.mini.includes(nome) ? 'mini' :
          dogMap.pequeno.includes(nome) ? 'pequeno' :
          dogMap.medio.includes(nome) ? 'medio' :
          dogMap.grande.includes(nome) ? 'grande' : 'gigante');
      dogLookup[normalized] = porte;
      addLookup(nome, 'cachorro');
    });
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    const simples = ['gato','passaro','peixe','roedor','lagarto','tartaruga','exotico'];
    simples.forEach(tipo => {
      const arr = Array.isArray(payload[tipo]) ? payload[tipo] : [];
      const unique = Array.from(new Set(arr.filter(Boolean)));
      species[tipo] = unique;
      unique.forEach(nome => addLookup(nome, tipo));
    });

    if (payload.__lookup && typeof payload.__lookup === 'object') {
      Object.entries(payload.__lookup).forEach(([key, tipos]) => {
        if (!Array.isArray(tipos)) return;
        const normalized = norm(key);
        const set = ensureSet(normalized);
        tipos.forEach(tipo => set.add(tipo));
      });
    }

    const lookup = new Map();
    lookupSets.forEach((set, key) => lookup.set(key, Array.from(set)));
    return { species, lookup };
  }

  function buildFromLegacy(txt) {
    if (!txt) throw new Error('conteúdo vazio');
    const species = {};
    const lookupSets = new Map();
    const ensureSet = (key) => {
      if (!lookupSets.has(key)) lookupSets.set(key, new Set());
      return lookupSets.get(key);
    };
    const addLookup = (name, tipo) => {
      const key = norm(name);
      if (!key) return;
      ensureSet(key).add(tipo);
    };

    let dogMap = { mini:[], pequeno:[], medio:[], grande:[], gigante:[] };
    const reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
    let m;
    while ((m = reDogGlobal.exec(txt))) {
      const key = m[1].toLowerCase();
      const list = cleanList(m[2]);
      const unique = Array.from(new Set(list));
      dogMap[key] = unique;
      unique.forEach(nome => addLookup(nome, 'cachorro'));
    }
    const dogAll = Array.from(new Set([
      ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante
    ]));
    const dogLookup = {};
    dogAll.forEach(n => {
      dogLookup[norm(n)] =
        dogMap.mini.includes(n) ? 'mini' :
        dogMap.pequeno.includes(n) ? 'pequeno' :
        dogMap.medio.includes(n) ? 'medio' :
        dogMap.grande.includes(n) ? 'grande' : 'gigante';
    });
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    const simpleSpecies = ['gatos','gato','passaros','passaro','peixes','peixe','roedores','roedor','lagartos','lagarto','tartarugas','tartaruga','exoticos','exotico'];
    for (const sp of simpleSpecies) {
      const match = new RegExp(sp + "\\s*{([\\s\\S]*?)}","i").exec(txt);
      if (!match) continue;
      const list = cleanList(match[1]);
      const singular =
        /roedores$/i.test(sp)   ? 'roedor'     :
        /gatos$/i.test(sp)      ? 'gato'       :
        /passaros$/i.test(sp)   ? 'passaro'    :
        /peixes$/i.test(sp)     ? 'peixe'      :
        /lagartos$/i.test(sp)   ? 'lagarto'    :
        /tartarugas$/i.test(sp) ? 'tartaruga'  :
        /exoticos$/i.test(sp)   ? 'exotico'    :
        sp.replace(/s$/, '');
      const unique = Array.from(new Set(list));
      species[singular] = unique;
      unique.forEach(nome => addLookup(nome, singular));
    }

    const lookup = new Map();
    lookupSets.forEach((set, key) => lookup.set(key, Array.from(set)));
    return { species, lookup };
  }

  async function loadSpeciesMap() {
    if (SPECIES_MAP) return SPECIES_MAP;
    const base = (win.basePath || '../../');
    const jsonUrl = base + 'data/racas.json';
    const legacyUrl = base + 'data/Racas-leitura.js';

    const applyResult = ({ species, lookup }) => {
      SPECIES_MAP = species;
      BREED_LOOKUP = lookup;
      return SPECIES_MAP;
    };

    try {
      const res = await fetch(jsonUrl, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const payload = await res.json();
        return applyResult(buildFromJson(payload));
      }
      if (res.status && res.status !== 404) {
        console.warn('cadastro-servicos/precos: falha ao obter racas.json', res.status);
      }
    } catch (err) {
      console.warn('cadastro-servicos/precos: erro ao ler racas.json', err);
    }

    try {
      const res = await fetch(legacyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      return applyResult(buildFromLegacy(txt));
    } catch (e) {
      console.warn('Falha ao ler Racas-leitura.js', e);
      SPECIES_MAP = null;
      BREED_LOOKUP = null;
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
      opt.value = o.v;
      opt.textContent = o.l;
      E.tipo.appendChild(opt);
    });
  }

  function setPorteOptionsFromService(service) {
    const el = E.porte;
    if (!el) return;
    const portes = (service && Array.isArray(service.porte)) ? service.porte : [];
    const all = ['Todos', 'Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'];
    el.innerHTML = '';
    const enabled = (portes.includes('Todos') || !portes.length)
      ? all
      : portes.map(s => String(s).replace('MǸdio', 'Médio').replace('M?dio', 'Médio').replace('M  dio', 'Médio'));
      opt.value = p;
      opt.textContent = p;
      opt.disabled = !enabled.includes(p);
    }
    if (E.servPorteInfo) E.servPorteInfo.textContent = service ? `Portes permitidos: ${info}` : '';
    if (!E.store) return;
    let list = [];
    try {
      const res = await fetch(`${API_BASE}/stores`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (Array.isArray(payload)) {
        list = payload;
      }
    } catch (err) {
      console.warn('cadastro-servicos/precos: falha ao carregar lojas', err);
      list = [];
    }
      if (!s || typeof s !== 'object') return;
      opt.textContent = s.nome;
      E.store.appendChild(opt);
  function clearSugList() {
    if (!E.servSug) return;
    E.servSug.innerHTML = '';
    E.servSug.classList.add('hidden');
  }
  }
      const all = new Set([...(dog.all || [])]);
        const { mini = [], pequeno = [], medio = [], grande = [], gigante = [] } = dog.portes || {};
        return [...new Set([...mini, ...pequeno, ...medio, ...grande, ...gigante])];
    }
  }
  }
    });
  }
  }
  }
    if (!E.gridBody) return;
    E.gridBody.innerHTML = '';
    if (!breeds.length) {
      if (E.gridEmpty) E.gridEmpty.classList.remove('hidden');
      return;
    }
    if (E.gridEmpty) E.gridEmpty.classList.add('hidden');
  }

      return {
        raca: r.dataset.raca || '',
        custo: Number.isFinite(custo) ? custo : 0,
        valor: Number.isFinite(valor) ? valor : 0,
      };
    });

    if (!E.gridBody) return;
    E.gridBody.innerHTML = '';
    if (E.gridEmpty) E.gridEmpty.classList.add('hidden');


    if (!(serviceId && storeId && tipo)) {
      if (E.gridEmpty) E.gridEmpty.classList.remove('hidden');

    if (E.btnTabCadastro) {
      E.btnTabCadastro.addEventListener('click', () => {
        E.tabCadastro && E.tabCadastro.classList.remove('hidden');
        E.tabPrecos && E.tabPrecos.classList.add('hidden');
        E.btnTabCadastro && E.btnTabCadastro.classList.add('bg-primary', 'text-white');
        E.btnTabPrecos && E.btnTabPrecos.classList.remove('bg-primary', 'text-white');
        E.btnTabPrecos && E.btnTabPrecos.classList.add('border', 'border-gray-300', 'text-gray-700');
      });
    }
    if (E.btnTabPrecos) {
      E.btnTabPrecos.addEventListener('click', () => {
        E.tabPrecos && E.tabPrecos.classList.remove('hidden');
        E.tabCadastro && E.tabCadastro.classList.add('hidden');
        E.btnTabPrecos && E.btnTabPrecos.classList.add('bg-primary', 'text-white');
        E.btnTabCadastro && E.btnTabCadastro.classList.remove('bg-primary', 'text-white');
        E.btnTabCadastro && E.btnTabCadastro.classList.add('border', 'border-gray-300', 'text-gray-700');
      });
    }
    if (E.servInput) {
      E.servInput.addEventListener('input', () => {
        const q = E.servInput.value.trim();
        if (E.servId) E.servId.value = '';
        E.servInput.__selectedService = null;
        setPorteOptionsFromService(null);
        if (searchTimer) clearTimeout(searchTimer);
        if (!q) {
          clearSugList();
          if (E.servPorteInfo) E.servPorteInfo.textContent = '';
          refreshGrid();
          return;
        }
        searchTimer = setTimeout(async () => {
          const list = await searchServices(q);
          renderServiceSug(list);
        }, 200);
      });
    }
    if (E.servSug) {
      E.servSug.addEventListener('click', (ev) => {
        const target = ev.target;
        const li = (target && typeof target.closest === 'function') ? target.closest('li') : null;
        if (!li || !li.__item) return;
        const it = li.__item;
        if (E.servInput) E.servInput.value = it.nome;
        if (E.servId) E.servId.value = it._id;
        if (E.servInput) E.servInput.__selectedService = it;
        setPorteOptionsFromService(it);
        clearSugList();
        refreshGrid();
      });
    }
    if (E.tipo) {
      E.tipo.addEventListener('change', () => {
        const t = E.tipo ? E.tipo.value : 'todos';
        if (t === 'cachorro') {
          if (E.porte) E.porte.disabled = false;
        } else {
          if (E.porte) {
            E.porte.value = 'Todos';
            E.porte.disabled = true;
          }
        }
        refreshGrid();
      });
    }
    if (E.porte) {
      E.porte.addEventListener('change', refreshGrid);
    }
    if (E.store) {
      E.store.addEventListener('change', refreshGrid);
    }
    if (E.replCustoBtn) {
      E.replCustoBtn.addEventListener('click', () => applyToAll(0, (E.replCusto ? E.replCusto.value : '')));
    }
    if (E.replValorBtn) {
      E.replValorBtn.addEventListener('click', () => applyToAll(1, (E.replValor ? E.replValor.value : '')));
    }
    if (E.saveBtn) {
      E.saveBtn.addEventListener('click', async () => {
        const serviceId = (E.servId ? E.servId.value : undefined);
        const storeId = (E.store ? E.store.value : undefined);
        const tipo = (E.tipo ? E.tipo.value : undefined);
        if (!serviceId || !storeId || !tipo) {
          alert('Selecione serviço, tipo e empresa.');
          return;
        }
        try {
          const items = getGridItems();
          if (tipo === 'todos') {
            const grouped = groupItemsByTipo(items);
            if (!grouped.size) {
              alert('Não foi possível identificar os tipos das raças selecionadas.');
              return;
            }
            for (const [tipoAtual, lista] of grouped.entries()) {
              if (!lista.length) continue;
              await savePrices(serviceId, storeId, tipoAtual, lista);
            }
          } else {
            await savePrices(serviceId, storeId, tipo, items);
          alert('Preços salvos com sucesso.');
          await refreshGrid();
        } catch (e) {
          console.error(e);
          alert((e && e.message) ? e.message : 'Erro ao salvar preços');
      });
    }
    if (E.servPorteInfo) E.servPorteInfo.textContent = '';
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Falha ao salvar');
    }
    return res.json();

  function renderGrid(breeds, overrides) {
    const map = new Map((overrides || []).map(o => [norm(o.raca), o]));
    if (!breeds.length) { E.gridEmpty.classList.remove('hidden'); return; }
    E.gridEmpty.classList.add('hidden');
    for (const name of breeds) {
      const ov = map.get(norm(name)) || { custo: '', valor: '' };
      const custo = ov.custo === '' ? '' : Number(ov.custo);
      const valor = ov.valor === '' ? '' : Number(ov.valor);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2 text-gray-800">${name}</td>
        <td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="${custo}" /></td>
        <td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="${valor}" /></td>
      `;
      tr.dataset.raca = name;
      E.gridBody.appendChild(tr);
    }
  function getGridItems() {
    const rows = Array.from((E.gridBody ? E.gridBody.querySelectorAll('tr') : []) || []);
    return rows.map(r => {
      const inputs = r.querySelectorAll('input');
      const custo = parseFloat((inputs[0] ? inputs[0].value : '') || '0');
      const valor = parseFloat((inputs[1] ? inputs[1].value : '') || '0');
      return { raca: r.dataset.raca || '', custo: Number.isFinite(custo) ? custo : 0, valor: Number.isFinite(valor) ? valor : 0 };
  }
  async function refreshGrid() {
    const serviceId = (E.servId ? E.servId.value : undefined);
    const storeId = (E.store ? E.store.value : undefined);
    const tipo = (E.tipo ? E.tipo.value : undefined);
      return;
    }
    const service = (E.servInput && E.servInput.__selectedService) ? E.servInput.__selectedService : null;
    const porte = (E.porte ? E.porte.value : undefined) || 'Todos';
    const breeds = breedsForSelection(tipo, porte, service);
    const overrides = await loadPrices(serviceId, storeId, tipo);
    renderGrid(breeds, overrides);
  }

  function bindEvents() {
    // Tabs
    E.btnTabCadastro && E.btnTabCadastro.addEventListener('click', () => {
      E.tabCadastro && E.tabCadastro.classList.remove('hidden');
      E.tabPrecos && E.tabPrecos.classList.add('hidden');
      E.btnTabCadastro && E.btnTabCadastro.classList.add('bg-primary','text-white');
      E.btnTabPrecos && E.btnTabPrecos.classList.remove('bg-primary','text-white');
      E.btnTabPrecos && E.btnTabPrecos.classList.add('border','border-gray-300','text-gray-700');
    });
    E.btnTabPrecos && E.btnTabPrecos.addEventListener('click', () => {
      E.tabPrecos && E.tabPrecos.classList.remove('hidden');
      E.tabCadastro && E.tabCadastro.classList.add('hidden');
      E.btnTabPrecos && E.btnTabPrecos.classList.add('bg-primary','text-white');
      E.btnTabCadastro && E.btnTabCadastro.classList.remove('bg-primary','text-white');
      E.btnTabCadastro && E.btnTabCadastro.classList.add('border','border-gray-300','text-gray-700');
    });

    // Serviço search + choose
    let searchTimer = null;
    E.servInput && E.servInput.addEventListener('input', () => {
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
    E.servSug && E.servSug.addEventListener('click', (ev) => {
      const target = ev.target;
      const li = (target && typeof target.closest === 'function') ? target.closest('li') : null;
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
    E.tipo && E.tipo.addEventListener('change', () => {
      const t = (E.tipo ? E.tipo.value : undefined);
      if (t === 'todos') {
        if (E.porte) { E.porte.value = 'Todos'; E.porte.disabled = true; }
        if (E.porte) { E.porte.disabled = false; }
      refreshGrid();
    });
    E.porte && E.porte.addEventListener('change', refreshGrid);
    E.store && E.store.addEventListener('change', refreshGrid);

    // Replicate
    const applyToAll = (idx, value) => {
      const v = String(value || '').trim();
      if (v === '') return;
      if (!E.gridBody) return;
      E.gridBody.querySelectorAll('tr').forEach(tr => {
        const inp = tr.querySelectorAll('input')[idx];
        if (inp) inp.value = v;
      });
    };
    E.replCustoBtn && E.replCustoBtn.addEventListener('click', () => applyToAll(0, (E.replCusto ? E.replCusto.value : '')));
    E.replValorBtn && E.replValorBtn.addEventListener('click', () => applyToAll(1, (E.replValor ? E.replValor.value : '')));

    // Save
    E.saveBtn && E.saveBtn.addEventListener('click', async () => {
      const serviceId = (E.servId ? E.servId.value : undefined);
      const storeId = (E.store ? E.store.value : undefined);
      const tipo = (E.tipo ? E.tipo.value : undefined);
      if (!serviceId || !storeId || !tipo) { alert('Selecione serviço, tipo e empresa.'); return; }
      try {
        const items = getGridItems();
        if (tipo === 'todos') {
          const grouped = groupItemsByTipo(items);
          if (!grouped.size) {
            alert('Não foi possível identificar os tipos das raças selecionadas.');
            return;
          }
          for (const [tipoAtual, lista] of grouped.entries()) {
            if (!lista.length) continue;
            await savePrices(serviceId, storeId, tipoAtual, lista);
          }
        } else {
          await savePrices(serviceId, storeId, tipo, items);
        }
        alert('Preços salvos com sucesso.');
        await refreshGrid();
      } catch (e) {
        console.error(e); alert((e && e.message) ? e.message : 'Erro ao salvar preços');
      }
    });
  }

  async function initPrecosTab() {
    if (!E.tabPrecos) return;
    await loadSpeciesMap();
    populateTiposSelect();
    // Default: 'Todos' selecionado e porte bloqueado
    try { if (E.tipo) E.tipo.value = 'todos'; } catch (err) {}
    try { if (E.porte) { E.porte.disabled = true; E.porte.innerHTML = '<option>Todos</option>'; } } catch (err) {}
    await loadStores();
    bindEvents();
  }

  win.cadastroServicosPrecos = win.cadastroServicosPrecos || {};
  win.cadastroServicosPrecos.initPrecosTab = initPrecosTab;
  win.cadastroServicosPrecos.refreshGrid = refreshGrid;
})(typeof window !== 'undefined' ? window : undefined);
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
