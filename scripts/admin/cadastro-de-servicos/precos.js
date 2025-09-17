(function (win) {
  'use strict';

  if (!win || !win.document) return;

  var doc = win.document;

  function getToken() {
    try {
      var raw = win.localStorage.getItem('loggedInUser') || 'null';
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.token) {
        return parsed.token;
      }
    } catch (err) {
      console.warn('cadastro-servicos/precos: token não disponível', err);
    }
    return '';
  }

  var E = {
    btnTabCadastro: doc.getElementById('tab-btn-cadastro'),
    btnTabPrecos: doc.getElementById('tab-btn-precos'),
    tabCadastro: doc.getElementById('tab-cadastro'),
    tabPrecos: doc.getElementById('tab-precos'),

    servInput: doc.getElementById('ap-serv-input'),
    servSug: doc.getElementById('ap-serv-sug'),
    servId: doc.getElementById('ap-serv-id'),
    servPorteInfo: doc.getElementById('ap-serv-porte-info'),

    tipo: doc.getElementById('ap-tipo'),
    porte: doc.getElementById('ap-porte'),
    store: doc.getElementById('ap-store'),

    replCusto: doc.getElementById('ap-repl-custo'),
    replCustoBtn: doc.getElementById('ap-repl-custo-btn'),
    replValor: doc.getElementById('ap-repl-valor'),
    replValorBtn: doc.getElementById('ap-repl-valor-btn'),

    gridBody: doc.getElementById('ap-grid-tbody'),
    gridEmpty: doc.getElementById('ap-grid-empty'),
    saveBtn: doc.getElementById('ap-save-btn')
  };

  var API_BASE = (
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) ||
    (win.API_CONFIG && win.API_CONFIG.BASE_URL) ||
    ''
  );

  var state = {
    species: null,
    lookup: null,
    searchTimer: null,
    eventsBound: false
  };

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function pushUnique(list, value) {
    if (!list) return;
    if (list.indexOf(value) === -1) {
      list.push(value);
    }
  }

  function unique(list) {
    var result = [];
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (item !== undefined && item !== null && result.indexOf(item) === -1) {
        result.push(item);
      }
    }
    return result;
  }

  function clone(obj) {
    var copy = {};
    for (var key in obj) {
      if (hasOwn(obj, key)) {
        copy[key] = obj[key];
      }
    }
    return copy;
  }

  function stripDiacritics(value) {
    var text = String(value || '');
    if (!text) return '';
    var normalizer = ''.normalize;
    if (typeof normalizer === 'function') {
      text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } else {
      text = text
        .replace(/[ÁÀÂÃÄÅ]/gi, 'A')
        .replace(/[ÉÈÊË]/gi, 'E')
        .replace(/[ÍÌÎÏ]/gi, 'I')
        .replace(/[ÓÒÔÕÖ]/gi, 'O')
        .replace(/[ÚÙÛÜ]/gi, 'U')
        .replace(/[Ç]/gi, 'C')
        .replace(/[Ñ]/gi, 'N');
    }
    return text.trim().toLowerCase();
  }

  function cleanLegacyList(body) {
    return String(body || '')
      .split(/\n+/)
      .map(function (part) { return part.trim(); })
      .filter(function (part) { return part && part.indexOf('//') !== 0 && part !== '...'; })
      .map(function (part) { return part.replace(/\*.*?\*/g, ''); })
      .map(function (part) { return part.replace(/\s*\(duplicata.*$/i, ''); })
      .map(function (part) {
        return part
          .replace(/\s*[ï¿½?"-].*$/, '')
          .replace(/\s*-\s*registro.*$/i, '');
      });
  }

  function buildFromJson(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload inválido');
    }

    var result = { species: {}, lookup: {} };

    function addLookup(name, tipo) {
      var key = stripDiacritics(name);
      if (!key) return;
      if (!result.lookup[key]) result.lookup[key] = [];
      pushUnique(result.lookup[key], tipo);
    }

    var dogPayload = payload.cachorro || {};
    var portes = dogPayload.portes || {};
    var dogMap = {
      mini: unique(ensureArray(portes.mini)),
      pequeno: unique(ensureArray(portes.pequeno)),
      medio: unique(ensureArray(portes.medio)),
      grande: unique(ensureArray(portes.grande)),
      gigante: unique(ensureArray(portes.gigante))
    };

    var dogAll = unique([].concat(
      ensureArray(dogPayload.all),
      dogMap.mini,
      dogMap.pequeno,
      dogMap.medio,
      dogMap.grande,
      dogMap.gigante
    ));

    var dogLookup = {};
    var dogMapPayload = dogPayload.map || {};
    for (var i = 0; i < dogAll.length; i += 1) {
      var nome = dogAll[i];
      var normalized = stripDiacritics(nome);
      var porte = dogMapPayload[normalized] || dogMapPayload[nome];
      if (!porte) {
        if (dogMap.mini.indexOf(nome) !== -1) porte = 'mini';
        else if (dogMap.pequeno.indexOf(nome) !== -1) porte = 'pequeno';
        else if (dogMap.medio.indexOf(nome) !== -1) porte = 'medio';
        else if (dogMap.grande.indexOf(nome) !== -1) porte = 'grande';
        else porte = 'gigante';
      }
      dogLookup[normalized] = porte;
      addLookup(nome, 'cachorro');
    }
    result.species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    var simples = ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga', 'exotico'];
    for (var s = 0; s < simples.length; s += 1) {
      var tipo = simples[s];
      var arr = ensureArray(payload[tipo]).filter(Boolean);
      var uniqueArr = unique(arr);
      result.species[tipo] = uniqueArr;
      for (var j = 0; j < uniqueArr.length; j += 1) {
        addLookup(uniqueArr[j], tipo);
      }
    }

    var customLookup = payload.__lookup;
    if (customLookup && typeof customLookup === 'object') {
      for (var key in customLookup) {
        if (!hasOwn(customLookup, key)) continue;
        var tipos = ensureArray(customLookup[key]);
        for (var t = 0; t < tipos.length; t += 1) {
          addLookup(key, tipos[t]);
        }
      }
    }

    return result;
  }

  function buildFromLegacy(txt) {
    if (!txt) {
      throw new Error('conteúdo vazio');
    }

    var result = { species: {}, lookup: {} };

    function addLookup(name, tipo) {
      var key = stripDiacritics(name);
      if (!key) return;
      if (!result.lookup[key]) result.lookup[key] = [];
      pushUnique(result.lookup[key], tipo);
    }

    var dogMap = { mini: [], pequeno: [], medio: [], grande: [], gigante: [] };
    var reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
    var match;
    while ((match = reDogGlobal.exec(txt))) {
      var porteKey = match[1].toLowerCase();
      var list = cleanLegacyList(match[2]);
      var uniqueList = unique(list);
      dogMap[porteKey] = uniqueList;
      for (var i = 0; i < uniqueList.length; i += 1) {
        addLookup(uniqueList[i], 'cachorro');
      }
    }

    var dogAll = unique([].concat(
      dogMap.mini,
      dogMap.pequeno,
      dogMap.medio,
      dogMap.grande,
      dogMap.gigante
    ));
    var dogLookup = {};
    for (var di = 0; di < dogAll.length; di += 1) {
      var name = dogAll[di];
      var normalized = stripDiacritics(name);
      var porte = 'gigante';
      if (dogMap.mini.indexOf(name) !== -1) porte = 'mini';
      else if (dogMap.pequeno.indexOf(name) !== -1) porte = 'pequeno';
      else if (dogMap.medio.indexOf(name) !== -1) porte = 'medio';
      else if (dogMap.grande.indexOf(name) !== -1) porte = 'grande';
      dogLookup[normalized] = porte;
    }
    result.species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    var simpleGroups = [
      ['gatos', 'gato'],
      ['gato', 'gato'],
      ['passaros', 'passaro'],
      ['passaro', 'passaro'],
      ['peixes', 'peixe'],
      ['peixe', 'peixe'],
      ['roedores', 'roedor'],
      ['roedor', 'roedor'],
      ['lagartos', 'lagarto'],
      ['lagarto', 'lagarto'],
      ['tartarugas', 'tartaruga'],
      ['tartaruga', 'tartaruga'],
      ['exoticos', 'exotico'],
      ['exotico', 'exotico']
    ];

    for (var sg = 0; sg < simpleGroups.length; sg += 1) {
      var group = simpleGroups[sg];
      var token = group[0];
      var tipo = group[1];
      var regex = new RegExp(token + '\\s*{([\\s\\S]*?)}', 'i');
      var resultMatch = regex.exec(txt);
      if (!resultMatch) continue;
      var items = unique(cleanLegacyList(resultMatch[1]));
      result.species[tipo] = items;
      for (var it = 0; it < items.length; it += 1) {
        addLookup(items[it], tipo);
      }
    }

    return result;
  }

  function applySpecies(result) {
    state.species = result.species || {};
    state.lookup = result.lookup || {};
    return state.species;
  }

  function fetchJson(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

  function loadLegacy(url) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (txt) {
        return applySpecies(buildFromLegacy(txt));
      });
  }

  function loadSpeciesMap() {
    if (state.species) {
      return Promise.resolve(state.species);
    }

    var base = win.basePath || '../../';
    var jsonUrl = base + 'data/racas.json';
    var legacyUrl = base + 'data/Racas-leitura.js';

    return fetchJson(jsonUrl)
      .then(function (payload) {
        return applySpecies(buildFromJson(payload));
      })
      .catch(function (err) {
        console.warn('cadastro-servicos/precos: falha ao ler racas.json', err);
        return loadLegacy(legacyUrl)
          .catch(function (legacyErr) {
            console.warn('cadastro-servicos/precos: falha ao ler Racas-leitura.js', legacyErr);
            state.species = null;
            state.lookup = null;
            return {};
          });
      });
  }

  function populateTiposSelect() {
    if (!E.tipo) return;
    var options = [
      { value: 'todos', label: 'Todos' },
      { value: 'cachorro', label: 'Cachorro' },
      { value: 'gato', label: 'Gato' },
      { value: 'passaro', label: 'Pássaro' },
      { value: 'peixe', label: 'Peixe' },
      { value: 'roedor', label: 'Roedor' },
      { value: 'lagarto', label: 'Lagarto' },
      { value: 'tartaruga', label: 'Tartaruga' },
      { value: 'exotico', label: 'Exótico' }
    ];
    E.tipo.innerHTML = '';
    for (var i = 0; i < options.length; i += 1) {
      var opt = doc.createElement('option');
      opt.value = options[i].value;
      opt.textContent = options[i].label;
      E.tipo.appendChild(opt);
    }
  }

  function setPorteOptionsFromService(service) {
    if (!E.porte) return;
    var porteList = Array.isArray(service && service.porte) ? service.porte : [];
    var all = ['Todos', 'Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'];
    var enabled;
    if (!porteList.length || porteList.indexOf('Todos') !== -1) {
      enabled = all.slice();
    } else {
      enabled = [];
      for (var i = 0; i < porteList.length; i += 1) {
        var label = String(porteList[i] || '')
          .replace('MǸdio', 'Médio')
          .replace('M?dio', 'Médio')
          .replace('M  dio', 'Médio');
        enabled.push(label);
      }
    }

    E.porte.innerHTML = '';
    for (var j = 0; j < all.length; j += 1) {
      var name = all[j];
      var option = doc.createElement('option');
      option.value = name;
      option.textContent = name;
      option.disabled = enabled.indexOf(name) === -1;
      E.porte.appendChild(option);
    }

    if (enabled.indexOf('Todos') !== -1) {
      E.porte.value = 'Todos';
    } else {
      E.porte.value = enabled[0] || 'Mini';
    }

      E.servPorteInfo.textContent = service ? 'Portes permitidos: ' + enabled.join(', ') : '';
      E.store.innerHTML = '';
      if (!items || !items.length) return;
      for (var i = 0; i < items.length; i += 1) {
        var store = items[i];
        if (!store || typeof store !== 'object') continue;
        var opt = doc.createElement('option');
        opt.value = store._id;
        opt.textContent = store.nome;
        E.store.appendChild(opt);
      }
    }

    return fetch(API_BASE + '/stores')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        applyList(Array.isArray(payload) ? payload : []);
      })
      .catch(function (err) {
        console.warn('cadastro-servicos/precos: falha ao carregar lojas', err);
        applyList([]);
      });
  function clearSuggestions() {
  function searchServices(term) {
    return fetch(
      API_BASE + '/func/servicos/buscar?q=' + encodeURIComponent(term) + '&limit=20',
      { headers: { 'Authorization': 'Bearer ' + getToken() } }
    )
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
  function renderSuggestions(list) {
    clearSuggestions();
      if (!item) continue;
      var li = doc.createElement('li');
      var label = item.nome + (item.grupo ? ' (' + item.grupo.nome + ')' : '');
      li.textContent = label;
    }
    var species = state.species || {};
    var selectedTipo = tipo || 'cachorro';

    if (selectedTipo === 'todos') {
      var dog = species.cachorro || {};
      var dogAll = ensureArray(dog.all);
      for (var i = 0; i < dogAll.length; i += 1) {
        pushUnique(all, dogAll[i]);
      }
      for (var key in species) {
        if (!hasOwn(species, key) || key === 'cachorro') continue;
        var list = ensureArray(species[key]);
        for (var j = 0; j < list.length; j += 1) {
          pushUnique(all, list[j]);
        }
      return all;

    if (selectedTipo === 'cachorro') {
      var dogData = species.cachorro || {};
      var servicePortes = Array.isArray(service && service.porte) ? service.porte : [];
      var porteKey;
      if (!porte || porte === 'Todos' || permiteTodos) {
        var portes = dogData.portes || {};
        return unique([].concat(
          ensureArray(portes.mini),
          ensureArray(portes.pequeno),
          ensureArray(portes.medio),
          ensureArray(portes.grande),
          ensureArray(portes.gigante)
        ));
      porteKey = stripDiacritics(porte);
      if (dogData.portes && dogData.portes[porteKey]) {
        return ensureArray(dogData.portes[porteKey]).slice();
      }
      return [];

    var arr = ensureArray(species[selectedTipo]);
    return arr.slice();
  function tiposForBreed(name) {
    if (!name) return [];
    var key = stripDiacritics(name);
    var list = state.lookup && state.lookup[key];
    return list ? list.slice() : [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var tipos = tiposForBreed(item.raca);
        grouped[tipo].push(clone(item));
      }
    }
    var url = API_BASE + '/admin/servicos/precos?serviceId=' + serviceId + '&storeId=' + storeId;
      url += '&tipo=' + encodeURIComponent(tipo);
    }
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + getToken() } })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; });
    return fetch(API_BASE + '/admin/servicos/precos/bulk', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      },
      body: JSON.stringify({ serviceId: serviceId, storeId: storeId, tipo: tipo, items: items })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (err) {
          throw new Error(err.message || 'Falha ao salvar');
        });
      }
      return res.json();
    });
    var ovList = Array.isArray(overrides) ? overrides : [];
    for (var i = 0; i < ovList.length; i += 1) {
      var ov = ovList[i];
      map[stripDiacritics(ov.raca)] = ov;


      var override = map[stripDiacritics(name)] || { custo: '', valor: '' };
      var valor = override.valor === '' ? '' : Number(override.valor);
      var tr = doc.createElement('tr');
      tr.dataset.raca = name;
      tr.innerHTML = '' +
        '<td class="px-3 py-2 text-gray-800">' + name + '</td>' +
        '<td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="' + custo + '" /></td>' +
        '<td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="' + valor + '" /></td>';
    if (!E.gridBody) return [];
    var rows = E.gridBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var inputs = row.querySelectorAll('input');
      var custo = parseFloat((inputs[0] && inputs[0].value) || '0');
      var valor = parseFloat((inputs[1] && inputs[1].value) || '0');
      items.push({
        raca: row.dataset.raca || '',
        valor: isFinite(valor) ? valor : 0
      });
    }
    return items;
    var serviceId = E.servId ? E.servId.value : '';
    var storeId = E.store ? E.store.value : '';
    var tipo = E.tipo ? E.tipo.value : '';
    var service = E.servInput && E.servInput.__selectedService;
    var porte = (E.porte ? E.porte.value : '') || 'Todos';
    var breeds = breedsForSelection(tipo, porte, service || null);

      .then(function (overrides) {
      .catch(function (err) {
    if (state.eventsBound) return;
    state.eventsBound = true;

      E.btnTabCadastro.addEventListener('click', function () {
        if (E.tabCadastro) E.tabCadastro.classList.remove('hidden');
        if (E.tabPrecos) E.tabPrecos.classList.add('hidden');
        if (E.btnTabCadastro) E.btnTabCadastro.classList.add('bg-primary', 'text-white');
        if (E.btnTabPrecos) {
          E.btnTabPrecos.classList.remove('bg-primary', 'text-white');
          E.btnTabPrecos.classList.add('border', 'border-gray-300', 'text-gray-700');
        }

      E.btnTabPrecos.addEventListener('click', function () {
        if (E.tabPrecos) E.tabPrecos.classList.remove('hidden');
        if (E.tabCadastro) E.tabCadastro.classList.add('hidden');
        if (E.btnTabPrecos) E.btnTabPrecos.classList.add('bg-primary', 'text-white');
        if (E.btnTabCadastro) {
          E.btnTabCadastro.classList.remove('bg-primary', 'text-white');
          E.btnTabCadastro.classList.add('border', 'border-gray-300', 'text-gray-700');
        }
      E.servInput.addEventListener('input', function () {
        var term = E.servInput.value.trim();
        if (state.searchTimer) {
          clearTimeout(state.searchTimer);
        }
        if (!term) {
          clearSuggestions();
        state.searchTimer = setTimeout(function () {
          searchServices(term)
            .then(function (list) {
              renderSuggestions(Array.isArray(list) ? list : []);
            })
              renderSuggestions([]);

        var target = ev.target || ev.srcElement;
        var li = target && target.closest ? target.closest('li') : null;
        var item = li.__item;
        if (E.servInput) E.servInput.value = item.nome;
        if (E.servId) E.servId.value = item._id;
        if (E.servInput) E.servInput.__selectedService = item;
        setPorteOptionsFromService(item);
        clearSuggestions();
        var value = E.tipo.value || 'todos';
        if (value === 'cachorro') {

      E.porte.addEventListener('change', function () {
        refreshGrid();
      });

      E.store.addEventListener('change', function () {
        refreshGrid();
      });
    function applyToAll(index, value) {
      var trimmed = String(value || '').trim();
      if (trimmed === '') return;
        if (inputs[index]) inputs[index].value = trimmed;
      }
    }

      E.replCustoBtn.addEventListener('click', function () {
        applyToAll(0, E.replCusto ? E.replCusto.value : '');
      });

      E.replValorBtn.addEventListener('click', function () {
        applyToAll(1, E.replValor ? E.replValor.value : '');
      });
      E.saveBtn.addEventListener('click', function () {
        var serviceId = E.servId ? E.servId.value : '';
        var storeId = E.store ? E.store.value : '';
        var tipo = E.tipo ? E.tipo.value : '';
        if (!(serviceId && storeId && tipo)) {
        }

        var items = getGridItems();
        function handleError(error) {
          console.error(error);
          alert(error && error.message ? error.message : 'Erro ao salvar preços');
          var keys = Object.keys(grouped);
          if (!keys.length) {
          var chain = Promise.resolve();
          for (var i = 0; i < keys.length; i += 1) {
            (function (tipoAtual) {
              var lista = grouped[tipoAtual];
              if (!lista || !lista.length) return;
              chain = chain.then(function () {
                return savePrices(serviceId, storeId, tipoAtual, lista);
              });
            })(keys[i]);
          }
          chain.then(finalize).catch(handleError);
        if (E.tipo) {
          try { E.tipo.value = 'todos'; } catch (err) {}
        }
        if (E.porte) {
          try {
            E.porte.innerHTML = '<option>Todos</option>';
            E.porte.value = 'Todos';
          } catch (err) {}
        }
      .then(function () {
})(typeof window !== 'undefined' ? window : null);
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
      E.saveBtn.addEventListener('click', () => {

        const finalize = () => {
          return refreshGrid();
        };
        const handleError = (e) => {
        };

        const items = getGridItems();
        if (tipo === 'todos') {
          const grouped = groupItemsByTipo(items);
          if (!grouped.size) {
            alert('Não foi possível identificar os tipos das raças selecionadas.');
            return;
          }
          const entries = Array.from(grouped.entries());
          let sequence = Promise.resolve();
          entries.forEach(([tipoAtual, lista]) => {
            if (!Array.isArray(lista) || !lista.length) return;
            sequence = sequence.then(() => savePrices(serviceId, storeId, tipoAtual, lista));
          });
          sequence
            .then(finalize)
            .catch(handleError);
        } else {
          savePrices(serviceId, storeId, tipo, items)
            .then(finalize)
            .catch(handleError);
  function initPrecosTab() {
    if (!E.tabPrecos) return Promise.resolve();
    return loadSpeciesMap()
      .then(() => {
        populateTiposSelect();
        // Default: 'Todos' selecionado e porte bloqueado
        try { if (E.tipo) E.tipo.value = 'todos'; } catch (err) {}
        try { if (E.porte) { E.porte.disabled = true; E.porte.innerHTML = '<option>Todos</option>'; } } catch (err) {}
        if (E.servPorteInfo) E.servPorteInfo.textContent = '';
        return loadStores();
      })
      .then(() => {
        bindEvents();
      });
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
