// CRUD de Serviços: nome, grupo (ServiceGroup), duração (min), custo, valor.

function initAdminServicos() {
  const API = `${API_CONFIG.BASE_URL}/admin/servicos`;
  const API_GRUPOS = `${API_CONFIG.BASE_URL}/admin/servicos/grupos`;

  const form = document.getElementById('serv-form');
  const inputId = document.getElementById('serv-id');
  const inputNome = document.getElementById('serv-nome');
  const selectGrupo = document.getElementById('serv-grupo');
  const inputDuracao = document.getElementById('serv-duracao');
  const inputCusto = document.getElementById('serv-custo');
  const inputValor = document.getElementById('serv-valor');
  const selectPorte = document.getElementById('serv-porte');
  const submitLabel = document.getElementById('serv-submit-label');
  const btnCancelar = document.getElementById('serv-cancelar');

  const tbody = document.getElementById('serv-tbody');
  const empty = document.getElementById('serv-empty');

  if (!form) return;

  function getSelectedValues(selectEl) {
    return Array.from(selectEl?.selectedOptions || []).map(o => o.value);
  }
  function setSelectedValues(selectEl, values) {
    const set = new Set(values);
    Array.from(selectEl.options).forEach(o => { o.selected = set.has(o.value); });
  }
  function selectOnlyTodos() {
    setSelectedValues(selectPorte, ['Todos']);
  }

  function getToken() {
    try { return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || ''; }
    catch { return ''; }
  }

  async function fetchJSON(url, opts = {}) {
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

  async function carregarGrupos() {
    const select = selectGrupo;
    select.innerHTML = `<option value="" disabled selected>Selecione um grupo</option>`;
    try {
      const grupos = await fetchJSON(API_GRUPOS);
      for (const g of grupos) {
        const opt = document.createElement('option');
        opt.value = g._id;
        opt.textContent = g.nome;
        select.appendChild(opt);
      }
    } catch (e) {
      console.error(e);
      alert('Não foi possível carregar os grupos.');
    }
  }

  function validar() {
    const nome = (inputNome.value || '').trim();
    const grupo = selectGrupo.value;
    const dur = Number(inputDuracao.value);
    const custo = Number(inputCusto.value);
    const valor = Number(inputValor.value);

    const erros = [];
    if (!nome) erros.push('Informe o nome do serviço.');
    if (!grupo) erros.push('Selecione um grupo.');
    if (!Number.isInteger(dur) || dur < 1 || dur > 600) erros.push('Duração deve estar entre 1 e 600 minutos.');
    if (Number.isNaN(custo) || custo < 0) erros.push('Custo inválido.');
    if (Number.isNaN(valor) || valor < 0) erros.push('Valor inválido.');
    let portes = getSelectedValues(selectPorte);
    if (portes.length === 0) portes = ['Todos'];
    if (portes.includes('Todos')) portes = ['Todos'];
    return { ok: erros.length === 0, erros, nome, grupo, dur, custo, valor, porte: portes };
  }

  function fmtMoney(n) {
    const num = Number(n || 0);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  async function listar() {
    const data = await fetchJSON(API);
    renderLista(Array.isArray(data) ? data : (data?.items || []));
  }

  function renderLista(items) {
    tbody.innerHTML = '';
    if (!items.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    for (const it of items) {
      const tr = document.createElement('tr');
      const grupoNome = it.grupo?.nome || '—';

      tr.innerHTML = `
        <td class="px-3 py-2 font-medium text-gray-800">${it.nome || ''}</td>
        <td class="px-3 py-2 text-gray-700">${grupoNome}</td>
        <td class="px-3 py-2 text-gray-700">${Number(it.duracaoMinutos || 0)}</td>
        <td class="px-3 py-2 text-gray-700">${fmtMoney(it.custo)}</td>
        <td class="px-3 py-2 text-gray-700">${fmtMoney(it.valor)}</td>
        <td class="px-3 py-2">
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-800" data-edit="${it._id}"><i class="fas fa-pen"></i></button>
            <button class="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700" data-del="${it._id}"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

    function resetForm() {
      inputId.value = '';
      inputNome.value = '';
      selectGrupo.value = '';
      inputDuracao.value = '30';
      inputCusto.value = '0';
      inputValor.value = '0';
      if (selectPorte) selectOnlyTodos();
      submitLabel.textContent = 'Salvar';
      btnCancelar.classList.add('hidden');
    }

    function fillForm(item) {
    inputId.value = item._id;
    inputNome.value = item.nome || '';
    selectGrupo.value = item.grupo?._id || item.grupo || '';
    inputDuracao.value = Number(item.duracaoMinutos || 0).toString();
    inputCusto.value = Number(item.custo || 0).toString();
    inputValor.value = Number(item.valor || 0).toString();
    if (selectPorte) {
      const valores = Array.isArray(item.porte)
        ? item.porte
        : (item.porte ? [item.porte] : ['Todos']);
      setSelectedValues(selectPorte, valores.length ? valores : ['Todos']);
    }
    submitLabel.textContent = 'Atualizar';
    btnCancelar.classList.remove('hidden');
    }

  // Eventos
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validar();
    if (!v.ok) {
      alert(v.erros.join('\n'));
      return;
    }
    const payload = {
      nome: v.nome,
      grupo: v.grupo,
      duracaoMinutos: v.dur,
      custo: v.custo,
      valor: v.valor,
      porte: v.porte
    };

    try {
      if (inputId.value) {
        const saved = await fetchJSON(`${API}/${inputId.value}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        fillForm(saved);
      } else {
        await fetchJSON(API, { method: 'POST', body: JSON.stringify(payload) });
        resetForm();
      }
      await listar();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar serviço.\n' + err.message);
    }
  });

  btnCancelar?.addEventListener('click', () => resetForm());

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del');
    if (!id) return;

    if (btn.hasAttribute('data-edit')) {
      try {
        const item = await fetchJSON(`${API}/${id}`);
        fillForm(item);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        alert('Não foi possível carregar o serviço selecionado.');
      }
    } else if (btn.hasAttribute('data-del')) {
      if (!confirm('Confirma remover este serviço?')) return;
      try {
        await fetchJSON(`${API}/${id}`, { method: 'DELETE' });
        if (inputId.value === id) resetForm();
        await listar();
      } catch (err) {
        alert('Erro ao remover serviço.\n' + err.message);
      }
    }
  });

  // Inicialização
  Promise.all([carregarGrupos(), listar()]).catch(err => {
    console.error(err);
    alert('Erro ao inicializar a página de serviços.\n' + err.message);
  });
}


if (!window.__EOBICHO_ADMIN_VIEWS__) {
  window.__EOBICHO_ADMIN_VIEWS__ = {};
}
window.__EOBICHO_ADMIN_VIEWS__['admin-servicos'] = initAdminServicos;

if (!window.AdminSPA) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminServicos, { once: true });
  } else {
    initAdminServicos();
  }
}
