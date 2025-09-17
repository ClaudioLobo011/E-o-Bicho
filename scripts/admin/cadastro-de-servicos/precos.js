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
    lookup: {},
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
        if (hasOwn(customLookup, key)) {
          var tipos = ensureArray(customLookup[key]);
          for (var t = 0; t < tipos.length; t += 1) {
            addLookup(key, tipos[t]);
          }
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
      if (resultMatch) {
        var items = unique(cleanLegacyList(resultMatch[1]));
        result.species[tipo] = items;
        for (var it = 0; it < items.length; it += 1) {
          addLookup(items[it], tipo);
        }
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
            state.lookup = {};
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

  function normalizePorteLabel(value) {
    var txt = String(value || '').trim();
    if (!txt) return '';
    var normalized = stripDiacritics(txt);
    switch (normalized) {
      case 'todos': return 'Todos';
      case 'mini': return 'Mini';
      case 'pequeno': return 'Pequeno';
      case 'medio':
      case 'medio ': return 'Médio';
      case 'grande': return 'Grande';
      case 'gigante': return 'Gigante';
      default: return txt;
    }
  }

  function setPorteOptionsFromService(service) {
    if (!E.porte) return;
    var porteList = Array.isArray(service && service.porte) ? service.porte : [];
    var all = ['Todos', 'Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'];
    var enabled = [];

    if (!porteList.length) {
      enabled = all.slice();
    } else {
      for (var i = 0; i < porteList.length; i += 1) {
        var label = normalizePorteLabel(porteList[i]);
        if (label && enabled.indexOf(label) === -1) {
          enabled.push(label);
        }
      }
      if (enabled.indexOf('Todos') !== -1) {
        enabled = all.slice();
      }
    }

    if (!enabled.length) {
      enabled = all.slice();
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

    var value = enabled.indexOf('Todos') !== -1 ? 'Todos' : enabled[0];
    E.porte.value = value || 'Todos';

    if (E.servPorteInfo) {
      if (service) {
        E.servPorteInfo.textContent = 'Portes permitidos: ' + enabled.join(', ');
      } else {
        E.servPorteInfo.textContent = '';
      }
    }
  }

  function loadStores() {
    if (!E.store) return Promise.resolve([]);

    function applyList(items) {
      E.store.innerHTML = '';
      var list = Array.isArray(items) ? items : [];
      if (!list.length) {
        var optEmpty = doc.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = 'Nenhuma loja encontrada';
        optEmpty.disabled = true;
        E.store.appendChild(optEmpty);
        return list;
      }
      for (var i = 0; i < list.length; i += 1) {
        var store = list[i];
        if (store && typeof store === 'object') {
          var opt = doc.createElement('option');
          opt.value = store._id || '';
          opt.textContent = store.nome || store._id || 'Loja';
          E.store.appendChild(opt);
        }
      }
      if (E.store.options.length) {
        E.store.selectedIndex = 0;
      }
      return list;
    }

    return fetch(API_BASE + '/stores', { headers: { 'Authorization': 'Bearer ' + getToken() } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        return applyList(payload);
      })
      .catch(function (err) {
        console.warn('cadastro-servicos/precos: falha ao carregar lojas', err);
        applyList([]);
        return [];
      });
  }

  function clearSuggestions() {
    if (!E.servSug) return;
    E.servSug.innerHTML = '';
    if (E.servSug.classList) {
      E.servSug.classList.add('hidden');
    }
  }

  function renderSuggestions(list) {
    if (!E.servSug) return;
    clearSuggestions();
    var items = Array.isArray(list) ? list : [];
    if (!items.length) return;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (!item) continue;
      var li = doc.createElement('li');
      li.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer';
      var label = String(item.nome || '');
      if (item.grupo && item.grupo.nome) {
        label += ' (' + item.grupo.nome + ')';
      }
      li.textContent = label;
      li.dataset.id = item._id || '';
      li.__item = item;
      E.servSug.appendChild(li);
    }
    if (E.servSug.classList) {
      E.servSug.classList.remove('hidden');
    }
  }

  function searchServices(term) {
    if (!term) return Promise.resolve([]);
    return fetch(
      API_BASE + '/func/servicos/buscar?q=' + encodeURIComponent(term) + '&limit=20',
      { headers: { 'Authorization': 'Bearer ' + getToken() } }
    )
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .catch(function () { return []; });
  }

  function breedsForSelection(selectedTipo, porte, service) {
    var species = state.species || {};
    if (!selectedTipo) return [];
    if (selectedTipo === 'todos') {
      var all = [];
      var dog = species.cachorro || {};
      var dogAll = ensureArray(dog.all);
      for (var i = 0; i < dogAll.length; i += 1) {
        pushUnique(all, dogAll[i]);
      }
      for (var key in species) {
        if (hasOwn(species, key) && key !== 'cachorro') {
          var list = ensureArray(species[key]);
          for (var j = 0; j < list.length; j += 1) {
            pushUnique(all, list[j]);
          }
        }
      }
      return all;
    }

    if (selectedTipo === 'cachorro') {
      var dogData = species.cachorro || {};
      var servicePortes = Array.isArray(service && service.porte) ? service.porte : [];
      var permiteTodos = !servicePortes.length;
      for (var sp = 0; sp < servicePortes.length; sp += 1) {
        if (stripDiacritics(servicePortes[sp]) === 'todos') {
          permiteTodos = true;
          break;
        }
      }

      if (!porte || porte === 'Todos' || permiteTodos) {
        var portes = dogData.portes || {};
        return unique([].concat(
          ensureArray(portes.mini),
          ensureArray(portes.pequeno),
          ensureArray(portes.medio),
          ensureArray(portes.grande),
          ensureArray(portes.gigante)
        ));
      }

      var porteKey = stripDiacritics(porte);
      if (dogData.portes && dogData.portes[porteKey]) {
        return ensureArray(dogData.portes[porteKey]).slice();
      }
      return [];
    }

    var arr = ensureArray(species[selectedTipo]);
    return arr.slice();
  }

  function tiposForBreed(name) {
    if (!name) return [];
    var key = stripDiacritics(name);
    var list = state.lookup && state.lookup[key];
    return list ? list.slice() : [];
  }

  function groupItemsByTipo(items) {
    var map = new Map();
    if (!Array.isArray(items)) return map;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (!item || !item.raca) continue;
      var tipos = tiposForBreed(item.raca);
      for (var j = 0; j < tipos.length; j += 1) {
        var tipo = tipos[j];
        if (!map.has(tipo)) {
          map.set(tipo, []);
        }
        map.get(tipo).push(clone(item));
      }
    }
    return map;
  }

  function loadPrices(serviceId, storeId, tipo) {
    if (!(serviceId && storeId)) return Promise.resolve([]);
    var url = API_BASE + '/admin/servicos/precos?serviceId=' + encodeURIComponent(serviceId) + '&storeId=' + encodeURIComponent(storeId);
    if (tipo && tipo !== 'todos') {
      url += '&tipo=' + encodeURIComponent(tipo);
    }
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + getToken() } })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; });
  }

  function savePrices(serviceId, storeId, tipo, items) {
    return fetch(API_BASE + '/admin/servicos/precos/bulk', {
      method: 'POST',
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
  }

  function renderGrid(breeds, overrides) {
    if (!E.gridBody || !E.gridEmpty) return;
    E.gridBody.innerHTML = '';
    var list = Array.isArray(breeds) ? breeds : [];
    var map = {};
    var ovList = Array.isArray(overrides) ? overrides : [];
    for (var i = 0; i < ovList.length; i += 1) {
      var item = ovList[i];
      if (item && item.raca) {
        var key = stripDiacritics(item.raca);
        if (key) map[key] = item;
      }
    }

    if (!list.length) {
      if (E.gridEmpty.classList) {
        E.gridEmpty.classList.remove('hidden');
      }
      return;
    }

    if (E.gridEmpty.classList) {
      E.gridEmpty.classList.add('hidden');
    }

    for (var j = 0; j < list.length; j += 1) {
      var name = list[j];
      var override = map[stripDiacritics(name)] || { custo: '', valor: '' };
      var custo = override.custo;
      var valor = override.valor;

      if (custo !== '' && custo !== null && custo !== undefined) {
        custo = Number(custo);
        if (!isFinite(custo)) custo = '';
      } else {
        custo = '';
      }

      if (valor !== '' && valor !== null && valor !== undefined) {
        valor = Number(valor);
        if (!isFinite(valor)) valor = '';
      } else {
        valor = '';
      }

      var tr = doc.createElement('tr');
      tr.dataset.raca = name;

      var tdNome = doc.createElement('td');
      tdNome.className = 'px-3 py-2 text-gray-800';
      tdNome.textContent = name;
      tr.appendChild(tdNome);

      var tdCusto = doc.createElement('td');
      tdCusto.className = 'px-3 py-2';
      var inputCusto = doc.createElement('input');
      inputCusto.type = 'number';
      inputCusto.step = '0.01';
      inputCusto.className = 'w-32 rounded border-gray-300';
      inputCusto.value = custo;
      tdCusto.appendChild(inputCusto);
      tr.appendChild(tdCusto);

      var tdValor = doc.createElement('td');
      tdValor.className = 'px-3 py-2';
      var inputValor = doc.createElement('input');
      inputValor.type = 'number';
      inputValor.step = '0.01';
      inputValor.className = 'w-32 rounded border-gray-300';
      inputValor.value = valor;
      tdValor.appendChild(inputValor);
      tr.appendChild(tdValor);

      E.gridBody.appendChild(tr);
    }
  }

  function getGridItems() {
    var items = [];
    if (!E.gridBody) return items;
    var rows = E.gridBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (!row || !row.dataset) continue;
      var inputs = row.querySelectorAll('input');
      var custo = parseFloat((inputs[0] && inputs[0].value) || '0');
      var valor = parseFloat((inputs[1] && inputs[1].value) || '0');
      items.push({
        raca: row.dataset.raca || '',
        custo: isFinite(custo) ? custo : 0,
        valor: isFinite(valor) ? valor : 0
      });
    }
    return items;
  }

  function updatePorteState() {
    if (!E.porte) return;
    var currentTipo = (E.tipo && E.tipo.value) || 'todos';
    if (currentTipo === 'cachorro') {
      E.porte.disabled = false;
    } else {
      E.porte.disabled = true;
      E.porte.value = 'Todos';
    }
  }

  function applyToAll(index, value) {
    if (!E.gridBody) return;
    var trimmed = String(value || '').trim();
    if (trimmed === '') return;
    var rows = E.gridBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i += 1) {
      var inputs = rows[i].querySelectorAll('input');
      if (inputs[index]) {
        inputs[index].value = trimmed;
      }
    }
  }

  async function refreshGrid() {
    try {
      var serviceId = (E.servId && E.servId.value) || '';
      var storeId = (E.store && E.store.value) || '';
      var tipo = (E.tipo && E.tipo.value) || '';
      if (!(serviceId && storeId && tipo)) {
        renderGrid([], []);
        return;
      }
      var service = (E.servInput && E.servInput.__selectedService) || null;
      var porte = 'Todos';
      if (E.porte && !E.porte.disabled) {
        porte = E.porte.value || 'Todos';
      }
      var breeds = breedsForSelection(tipo, porte, service);
      var overrides = await loadPrices(serviceId, storeId, tipo);
      renderGrid(breeds, overrides);
    } catch (err) {
      console.error('cadastro-servicos/precos: falha ao atualizar grade', err);
    }
  }

  function bindEvents() {
    if (state.eventsBound) return;
    state.eventsBound = true;

    if (E.btnTabCadastro && E.btnTabPrecos && E.tabCadastro && E.tabPrecos) {
      E.btnTabCadastro.addEventListener('click', function () {
        E.tabCadastro.classList.remove('hidden');
        E.tabPrecos.classList.add('hidden');
        E.btnTabCadastro.classList.add('bg-primary', 'text-white');
        E.btnTabPrecos.classList.remove('bg-primary', 'text-white');
        E.btnTabPrecos.classList.add('border', 'border-gray-300', 'text-gray-700');
      });
      E.btnTabPrecos.addEventListener('click', function () {
        E.tabPrecos.classList.remove('hidden');
        E.tabCadastro.classList.add('hidden');
        E.btnTabPrecos.classList.add('bg-primary', 'text-white');
        E.btnTabCadastro.classList.remove('bg-primary', 'text-white');
        E.btnTabCadastro.classList.add('border', 'border-gray-300', 'text-gray-700');
      });
    }

    if (E.servInput) {
      E.servInput.addEventListener('input', function () {
        var term = E.servInput.value.trim();
        if (E.servId) E.servId.value = '';
        if (E.servInput) E.servInput.__selectedService = null;
        setPorteOptionsFromService(null);
        updatePorteState();
        if (E.servPorteInfo) E.servPorteInfo.textContent = '';
        if (state.searchTimer) {
          clearTimeout(state.searchTimer);
          state.searchTimer = null;
        }
        if (!term) {
          clearSuggestions();
          refreshGrid();
          return;
        }
        state.searchTimer = setTimeout(function () {
          searchServices(term)
            .then(function (list) {
              renderSuggestions(Array.isArray(list) ? list : []);
            })
            .catch(function () {
              renderSuggestions([]);
            });
        }, 200);
      });

      E.servInput.addEventListener('blur', function () {
        setTimeout(clearSuggestions, 150);
      });
    }

    if (E.servSug) {
      E.servSug.addEventListener('mousedown', function (ev) {
        var target = ev.target || ev.srcElement;
        var li = target && typeof target.closest === 'function' ? target.closest('li') : null;
        if (!li || !li.__item) return;
        ev.preventDefault();
        var item = li.__item;
        if (E.servInput) {
          E.servInput.value = item.nome || '';
          E.servInput.__selectedService = item;
        }
        if (E.servId) E.servId.value = item._id || '';
        setPorteOptionsFromService(item);
        updatePorteState();
        clearSuggestions();
        refreshGrid();
      });
    }

    if (E.tipo) {
      E.tipo.addEventListener('change', function () {
        updatePorteState();
        refreshGrid();
      });
    }

    if (E.porte) {
      E.porte.addEventListener('change', function () {
        refreshGrid();
      });
    }

    if (E.store) {
      E.store.addEventListener('change', function () {
        refreshGrid();
      });
    }

    if (E.replCustoBtn) {
      E.replCustoBtn.addEventListener('click', function () {
        applyToAll(0, E.replCusto ? E.replCusto.value : '');
      });
    }

    if (E.replValorBtn) {
      E.replValorBtn.addEventListener('click', function () {
        applyToAll(1, E.replValor ? E.replValor.value : '');
      });
    }

    if (E.saveBtn) {
      E.saveBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var serviceId = (E.servId && E.servId.value) || '';
        var storeId = (E.store && E.store.value) || '';
        var tipo = (E.tipo && E.tipo.value) || '';
        if (!(serviceId && storeId && tipo)) {
          alert('Selecione serviço, tipo e empresa.');
          return;
        }

        var items = getGridItems();

        function handleSuccess() {
          alert('Preços salvos com sucesso.');
          refreshGrid();
        }

        function handleError(error) {
          console.error('cadastro-servicos/precos: erro ao salvar', error);
          alert(error && error.message ? error.message : 'Erro ao salvar preços');
        }

        if (tipo === 'todos') {
          var grouped = groupItemsByTipo(items);
          if (!grouped.size) {
            alert('Não foi possível identificar os tipos das raças selecionadas.');
            return;
          }
          var sequence = Promise.resolve();
          grouped.forEach(function (lista, tipoAtual) {
            if (!Array.isArray(lista) || !lista.length) return;
            sequence = sequence.then(function () {
              return savePrices(serviceId, storeId, tipoAtual, lista);
            });
          });
          sequence.then(handleSuccess).catch(handleError);
        } else {
          savePrices(serviceId, storeId, tipo, items)
            .then(handleSuccess)
            .catch(handleError);
        }
      });
    }
  }

  async function initPrecosTab() {
    if (!E.tabPrecos) return;
    await loadSpeciesMap();
    populateTiposSelect();
    if (E.tipo) {
      try { E.tipo.value = 'todos'; } catch (err) {}
    }
    if (E.porte) {
      try {
        E.porte.innerHTML = '<option>Todos</option>';
        E.porte.value = 'Todos';
        E.porte.disabled = true;
      } catch (err) {}
    }
    if (E.servPorteInfo) {
      E.servPorteInfo.textContent = '';
    }
    await loadStores();
    bindEvents();
    refreshGrid();
  }

  win.cadastroServicosPrecos = win.cadastroServicosPrecos || {};
  win.cadastroServicosPrecos.initPrecosTab = initPrecosTab;
  win.cadastroServicosPrecos.refreshGrid = refreshGrid;
})(typeof window !== 'undefined' ? window : undefined);
