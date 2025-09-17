(function (win) {
  if (!win) return;

  function getToken() {
    try {
      var raw = win.localStorage.getItem('loggedInUser') || 'null';
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.token) {
        return parsed.token;
      }
      return '';
    } catch (err) {
      console.warn('cadastro-servicos/precos: token não disponível', err);
      return '';
    }
  }

  var E = {
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
    saveBtn: document.getElementById('ap-save-btn')
  };

  var API_BASE = (
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) ||
    (win.API_CONFIG && win.API_CONFIG.BASE_URL) ||
    ''
  );

  var SPECIES_MAP = null;
  var BREED_LOOKUP = null; // { nomeNormalizado: [tipos] }
  var hasOwn = Object.prototype.hasOwnProperty;

  function norm(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
  }

  function addUnique(list, value) {
    if (!list) return;
    if (list.indexOf(value) === -1) {
      list.push(value);
    }
  }

  function uniqueList(list) {
    var result = [];
    if (!Array.isArray(list)) return result;
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (item !== undefined && item !== null && result.indexOf(item) === -1) {
        result.push(item);
      }
    }
    return result;
  }

  function shallowCopy(obj) {
    var copy = {};
    if (!obj || typeof obj !== 'object') return copy;
    for (var key in obj) {
      if (hasOwn.call(obj, key)) {
        copy[key] = obj[key];
      }
    }
    return copy;
  }

  function cleanList(body) {
    return String(body || '')
      .split(/\n+/)
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x && x.indexOf('//') !== 0 && x !== '...'; })
      .map(function (x) { return x.replace(/\*.*?\*/g, ''); })
      .map(function (x) { return x.replace(/\s*\(duplicata.*$/i, ''); })
      .map(function (x) {
        return x.replace(/\s*[ï¿½?"-].*$/, '').replace(/\s*-\s*registro.*$/i, '');
      });
  }

  function buildFromJson(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload inválido');
    }

    var species = {};
    var lookup = {};

    function addLookup(name, tipo) {
      var key = norm(name);
      if (!key) return;
      if (!lookup[key]) lookup[key] = [];
      addUnique(lookup[key], tipo);
    }

    var dogPayload = payload.cachorro || {};
    var portas = dogPayload.portes || {};
    var dogMap = {
      mini: uniqueList(portas.mini || []),
      pequeno: uniqueList(portas.pequeno || []),
      medio: uniqueList(portas.medio || []),
      grande: uniqueList(portas.grande || []),
      gigante: uniqueList(portas.gigante || [])
    };
    var baseDogAll = Array.isArray(dogPayload.all) ? dogPayload.all : [];
    var dogAll = uniqueList(baseDogAll
      .concat(dogMap.mini, dogMap.pequeno, dogMap.medio, dogMap.grande, dogMap.gigante));
    var dogLookup = {};
    var dogMapPayload = dogPayload.map || {};
    for (var i = 0; i < dogAll.length; i += 1) {
      var nome = dogAll[i];
      var normalized = norm(nome);
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
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    var simples = ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga', 'exotico'];
    for (var j = 0; j < simples.length; j += 1) {
      var tipo = simples[j];
      var arr = Array.isArray(payload[tipo]) ? payload[tipo] : [];
      var unique = uniqueList(arr.filter(Boolean));
      species[tipo] = unique;
      for (var k = 0; k < unique.length; k += 1) {
        addLookup(unique[k], tipo);
      }
    }

    if (payload.__lookup && typeof payload.__lookup === 'object') {
      for (var key in payload.__lookup) {
        if (!hasOwn.call(payload.__lookup, key)) continue;
        var tipos = payload.__lookup[key];
        if (!Array.isArray(tipos)) continue;
        var normalized = norm(key);
        if (!normalized) continue;
        if (!lookup[normalized]) lookup[normalized] = [];
        for (var t = 0; t < tipos.length; t += 1) {
          addUnique(lookup[normalized], tipos[t]);
        }
      }
    }

    return { species: species, lookup: lookup };
  }

  function buildFromLegacy(txt) {
    if (!txt) throw new Error('conteúdo vazio');
    var species = {};
    var lookup = {};

    function addLookup(name, tipo) {
      var key = norm(name);
      if (!key) return;
      if (!lookup[key]) lookup[key] = [];
      addUnique(lookup[key], tipo);
    }

    var dogMap = { mini: [], pequeno: [], medio: [], grande: [], gigante: [] };
    var reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
    var match;
    while ((match = reDogGlobal.exec(txt))) {
      var porteKey = match[1].toLowerCase();
      var list = cleanList(match[2]);
      var unique = uniqueList(list);
      dogMap[porteKey] = unique;
      for (var i = 0; i < unique.length; i += 1) {
        addLookup(unique[i], 'cachorro');
      }
    }

    var dogAll = uniqueList([].concat(
      dogMap.mini,
      dogMap.pequeno,
      dogMap.medio,
      dogMap.grande,
      dogMap.gigante
    ));
    var dogLookup = {};
    for (var di = 0; di < dogAll.length; di += 1) {
      var name = dogAll[di];
      var normalized = norm(name);
      var porte = 'gigante';
      if (dogMap.mini.indexOf(name) !== -1) porte = 'mini';
      else if (dogMap.pequeno.indexOf(name) !== -1) porte = 'pequeno';
      else if (dogMap.medio.indexOf(name) !== -1) porte = 'medio';
      else if (dogMap.grande.indexOf(name) !== -1) porte = 'grande';
      dogLookup[normalized] = porte;
    }
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

    var simpleSpecies = ['gatos', 'gato', 'passaros', 'passaro', 'peixes', 'peixe', 'roedores', 'roedor', 'lagartos', 'lagarto', 'tartarugas', 'tartaruga', 'exoticos', 'exotico'];
    for (var si = 0; si < simpleSpecies.length; si += 1) {
      var sp = simpleSpecies[si];
      var regex = new RegExp(sp + '\\s*{([\\s\\S]*?)}', 'i');
      var res = regex.exec(txt);
      if (!res) continue;
      var list = cleanList(res[1]);
      var singular;
      if (/roedores$/i.test(sp)) singular = 'roedor';
      else if (/gatos$/i.test(sp)) singular = 'gato';
      else if (/passaros$/i.test(sp)) singular = 'passaro';
      else if (/peixes$/i.test(sp)) singular = 'peixe';
      else if (/lagartos$/i.test(sp)) singular = 'lagarto';
      else if (/tartarugas$/i.test(sp)) singular = 'tartaruga';
      else if (/exoticos$/i.test(sp)) singular = 'exotico';
      else singular = sp.replace(/s$/, '');
      var unique = uniqueList(list);
      species[singular] = unique;
      for (var ui = 0; ui < unique.length; ui += 1) {
        addLookup(unique[ui], singular);
      }
    }

    return { species: species, lookup: lookup };
  }

  function loadSpeciesMap() {
    if (SPECIES_MAP) return Promise.resolve(SPECIES_MAP);

    var base = (win.basePath || '../../');
    var jsonUrl = base + 'data/racas.json';
    var legacyUrl = base + 'data/Racas-leitura.js';

    function applyResult(result) {
      if (result && result.species) {
        SPECIES_MAP = result.species;
        BREED_LOOKUP = result.lookup || {};
      }
      return SPECIES_MAP;
    }

    function loadLegacy() {
      return fetch(legacyUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (txt) {
          return applyResult(buildFromLegacy(txt));
        })
        .catch(function (err) {
          console.warn('Falha ao ler Racas-leitura.js', err);
          SPECIES_MAP = null;
          BREED_LOOKUP = null;
          return null;
        });
    }

    return fetch(jsonUrl, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) {
          if (res.status && res.status !== 404) {
            console.warn('cadastro-servicos/precos: falha ao obter racas.json', res.status);
          }
          return loadLegacy();
        }
        return res.json()
          .then(function (payload) {
            return applyResult(buildFromJson(payload));
          })
          .catch(function (err) {
            console.warn('cadastro-servicos/precos: erro ao interpretar racas.json', err);
            return loadLegacy();
          });
      })
      .catch(function (err) {
        console.warn('cadastro-servicos/precos: erro ao ler racas.json', err);
        return loadLegacy();
      });
  }

  function populateTiposSelect() {
    if (!E.tipo) return;
    var opts = [
      { v: 'todos', l: 'Todos' },
      { v: 'cachorro', l: 'Cachorro' },
      { v: 'gato', l: 'Gato' },
      { v: 'passaro', l: 'Pássaro' },
      { v: 'peixe', l: 'Peixe' },
      { v: 'roedor', l: 'Roedor' },
      { v: 'lagarto', l: 'Lagarto' },
      { v: 'tartaruga', l: 'Tartaruga' },
      { v: 'exotico', l: 'Exótico' }
    ];
    E.tipo.innerHTML = '';
    for (var i = 0; i < opts.length; i += 1) {
      var data = opts[i];
      var opt = document.createElement('option');
      opt.value = data.v;
      opt.textContent = data.l;
      E.tipo.appendChild(opt);
    }
  }

  function setPorteOptionsFromService(service) {
    var el = E.porte;
    if (!el) return;
    var portes = (service && Array.isArray(service.porte)) ? service.porte : [];
    var all = ['Todos', 'Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'];
    el.innerHTML = '';
    var enabled;
    if (portes.indexOf('Todos') !== -1 || !portes.length) {
      enabled = all.slice();
    } else {
      enabled = [];
      for (var i = 0; i < portes.length; i += 1) {
        var label = String(portes[i] || '')
          .replace('MǸdio', 'Médio')
          .replace('M?dio', 'Médio')
          .replace('M  dio', 'Médio');
        enabled.push(label);
      }
    }
    for (var j = 0; j < all.length; j += 1) {
      var p = all[j];
      var opt = document.createElement('option');
      opt.disabled = enabled.indexOf(p) === -1;
    }
    if (enabled.indexOf('Todos') !== -1) el.value = 'Todos';
    var info = enabled.join(', ');
    if (E.servPorteInfo) {
      E.servPorteInfo.textContent = service ? 'Portes permitidos: ' + info : '';
    }

    function applyList(items) {
      E.store.innerHTML = '';
      var list = Array.isArray(items) ? items : [];
      for (var i = 0; i < list.length; i += 1) {
        var store = list[i];
        if (!store || typeof store !== 'object') continue;
        var opt = document.createElement('option');
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
  function searchServices(q) {
    return fetch(API_BASE + '/func/servicos/buscar?q=' + encodeURIComponent(q) + '&limit=20', {
      headers: { 'Authorization': 'Bearer ' + getToken() }
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; });
  }
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      var li = document.createElement('li');
      var label = item.nome + (item.grupo ? ' (' + item.grupo.nome + ')' : '');
      li.textContent = label;
    }
    var data = SPECIES_MAP || {};
    var t = tipo || 'cachorro';
      var all = [];
      var dog = data.cachorro || { all: [] };
      var dogAll = Array.isArray(dog.all) ? dog.all : [];
      for (var di = 0; di < dogAll.length; di += 1) addUnique(all, dogAll[di]);
      for (var key in data) {
        if (!hasOwn.call(data, key) || key === 'cachorro') continue;
        var arr = data[key];
        if (!Array.isArray(arr)) continue;
        for (var ai = 0; ai < arr.length; ai += 1) addUnique(all, arr[ai]);
      return all;
      var dogData = data.cachorro || { portes: {} };
      var servicePortes = (service && Array.isArray(service.porte)) ? service.porte : [];
      var permiteTodos = servicePortes.indexOf('Todos') !== -1;
      if (!porte || porte === 'Todos' || permiteTodos) {
        var portes = dogData.portes || {};
        var mini = Array.isArray(portes.mini) ? portes.mini : [];
        var pequeno = Array.isArray(portes.pequeno) ? portes.pequeno : [];
        var medio = Array.isArray(portes.medio) ? portes.medio : [];
        var grande = Array.isArray(portes.grande) ? portes.grande : [];
        var gigante = Array.isArray(portes.gigante) ? portes.gigante : [];
        return uniqueList([].concat(mini, pequeno, medio, grande, gigante));
      var porteKey = norm(porte);
      if (dogData.portes && dogData.portes[porteKey]) {
        return dogData.portes[porteKey].slice();
      }
      return [];
    var arrList = data[t];
    return Array.isArray(arrList) ? arrList.slice() : [];
    var key = norm(nome);
    if (BREED_LOOKUP && BREED_LOOKUP[key]) {
      return BREED_LOOKUP[key].slice();
    var grouped = {};
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      var tipos = tiposForBreed(item && item.raca) || [];
      if (!tipos.length) continue;
      for (var j = 0; j < tipos.length; j += 1) {
        var tipo = tipos[j];
        if (!grouped[tipo]) grouped[tipo] = [];
        grouped[tipo].push(shallowCopy(item || {}));
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
      .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (err) {
    var map = {};
    var list = Array.isArray(overrides) ? overrides : [];
    for (var i = 0; i < list.length; i += 1) {
      var ov = list[i];
      if (!ov || typeof ov !== 'object') continue;
      map[norm(ov.raca)] = ov;
    }
    if (!breeds || !breeds.length) {
    for (var j = 0; j < breeds.length; j += 1) {
      var name = breeds[j];
      var override = map[norm(name)] || { custo: '', valor: '' };
      var custo = override.custo === '' ? '' : Number(override.custo);
      var valor = override.valor === '' ? '' : Number(override.valor);
      var tr = document.createElement('tr');
      tr.innerHTML = '' +
        '<td class="px-3 py-2 text-gray-800">' + name + '</td>' +
        '<td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="' + custo + '" /></td>' +
        '<td class="px-3 py-2"><input type="number" step="0.01" class="w-32 rounded border-gray-300" value="' + valor + '" /></td>';
    var rows = E.gridBody ? E.gridBody.querySelectorAll('tr') : [];
    var items = [];
    for (var i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      var inputs = r.querySelectorAll('input');
      var custo = parseFloat((inputs[0] ? inputs[0].value : '') || '0');
      var valor = parseFloat((inputs[1] ? inputs[1].value : '') || '0');
      items.push({
        custo: isFinite(custo) ? custo : 0,
        valor: isFinite(valor) ? valor : 0
      });
    }
    return items;
    var serviceId = E.servId ? E.servId.value : undefined;
    var storeId = E.store ? E.store.value : undefined;
    var tipo = E.tipo ? E.tipo.value : undefined;
    var service = (E.servInput && E.servInput.__selectedService) ? E.servInput.__selectedService : null;
    var porte = (E.porte ? E.porte.value : undefined) || 'Todos';
    var breeds = breedsForSelection(tipo, porte, service);

      .then(function (overrides) {
      .catch(function (err) {
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
    var searchTimer = null;
      E.servInput.addEventListener('input', function () {
        var q = E.servInput.value.trim();
        searchTimer = setTimeout(function () {
            .then(function (data) { renderServiceSug(data); })
            .catch(function (err) {
      E.servSug.addEventListener('click', function (ev) {
        var target = ev.target;
        var li = target && typeof target.closest === 'function' ? target.closest('li') : null;
        var it = li.__item;
      E.tipo.addEventListener('change', function () {
        var t = E.tipo ? E.tipo.value : 'todos';
        } else if (E.porte) {
          E.porte.value = 'Todos';
          E.porte.disabled = true;
      E.porte.addEventListener('change', refreshGrid);
    }
    if (E.store) {
      E.store.addEventListener('change', refreshGrid);
    }
    function applyToAll(idx, value) {
      var v = String(value || '').trim();
      var rows = E.gridBody.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i += 1) {
        var inputs = rows[i].querySelectorAll('input');
        if (inputs[idx]) inputs[idx].value = v;
      }
    }

      E.replCustoBtn.addEventListener('click', function () {
        applyToAll(0, E.replCusto ? E.replCusto.value : '');
      });
      E.replValorBtn.addEventListener('click', function () {
        applyToAll(1, E.replValor ? E.replValor.value : '');
      });
      E.saveBtn.addEventListener('click', function () {
        var serviceId = E.servId ? E.servId.value : undefined;
        var storeId = E.store ? E.store.value : undefined;
        var tipo = E.tipo ? E.tipo.value : undefined;
        function finalize() {
        }

        function handleError(e) {
          alert(e && e.message ? e.message : 'Erro ao salvar preços');
        }
        var items = getGridItems();
          var grouped = groupItemsByTipo(items);
          var keys = Object.keys(grouped);
          if (!keys.length) {
          var sequence = Promise.resolve();
          keys.forEach(function (tipoAtual) {
            var lista = grouped[tipoAtual];
            sequence = sequence.then(function () {
              return savePrices(serviceId, storeId, tipoAtual, lista);
            });
          sequence.then(finalize).catch(handleError);
      .then(function () {
        try {
          if (E.tipo) E.tipo.value = 'todos';
        } catch (err) {}
        try {
          if (E.porte) {
            E.porte.disabled = true;
            E.porte.innerHTML = '<option>Todos</option>';
          }
        } catch (err) {}
      .then(function () {
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
