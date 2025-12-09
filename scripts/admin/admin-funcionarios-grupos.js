(function () {
  const API_BASE = `${API_CONFIG.BASE_URL}/admin/funcionarios/grupos`;

  const form = document.getElementById('grupo-form');
  const inputId = document.getElementById('grupo-id');
  const inputCodigo = document.getElementById('grupo-codigo');
  const inputNome = document.getElementById('grupo-nome');
  const inputDescricao = document.getElementById('grupo-descricao');
  const submitLabel = document.getElementById('grupo-submit-label');
  const btnCancelar = document.getElementById('grupo-cancelar');
  const inputBusca = document.getElementById('grupo-busca');

  const tbody = document.getElementById('grupo-tbody');
  const empty = document.getElementById('grupo-empty');

  if (!form) return;

  const state = { grupos: [] };

  function getToken() {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return cached?.token || '';
    } catch { return ''; }
  }

  async function fetchJSON(url, opts = {}) {
    const token = getToken();
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {})
      }
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(t || `Erro HTTP ${res.status}`);
    }
    return res.json();
  }

  async function carregarProximoCodigo() {
    try {
      const data = await fetchJSON(`${API_BASE}/proximo-codigo`);
      if (!inputId.value) {
        inputCodigo.value = data?.codigo ?? '';
      }
    } catch (err) {
      console.error(err);
      inputCodigo.value = '';
      alert('Não foi possível obter o próximo código.');
    }
  }

  function validar() {
    const erros = [];
    const nome = (inputNome.value || '').trim();
    const descricao = (inputDescricao.value || '').trim();

    if (!nome) erros.push('Informe o nome do grupo.');

    return { ok: erros.length === 0, erros, nome, descricao };
  }

  function resetForm() {
    inputId.value = '';
    inputNome.value = '';
    inputDescricao.value = '';
    submitLabel.textContent = 'Salvar';
    btnCancelar.classList.add('hidden');
    carregarProximoCodigo();
  }

  function preencherForm(grupo) {
    inputId.value = grupo._id;
    inputCodigo.value = grupo.codigo ?? '';
    inputNome.value = grupo.nome || '';
    inputDescricao.value = grupo.descricao || '';
    submitLabel.textContent = 'Atualizar';
    btnCancelar.classList.remove('hidden');
  }

  function renderLista() {
    const busca = (inputBusca.value || '').trim().toLowerCase();
    tbody.innerHTML = '';

    const filtrados = state.grupos.filter((g) => {
      const texto = `${g.codigo || ''} ${g.nome || ''} ${g.descricao || ''}`.toLowerCase();
      return !busca || texto.includes(busca);
    });

    if (!filtrados.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    filtrados.forEach((grupo) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2">${grupo.codigo ?? '—'}</td>
        <td class="px-3 py-2">
          <div class="font-semibold text-gray-900">${grupo.nome || ''}</div>
          <p class="text-xs text-gray-500">${grupo.descricao || '—'}</p>
        </td>
        <td class="px-3 py-2">
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-800" data-edit="${grupo._id}"><i class="fas fa-pen"></i></button>
            <button class="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700" data-del="${grupo._id}"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function carregarLista() {
    try {
      const data = await fetchJSON(API_BASE);
      state.grupos = Array.isArray(data) ? data : [];
      renderLista();
      if (!inputId.value) {
        const ultimo = state.grupos[state.grupos.length - 1];
        if (ultimo?.codigo) {
          inputCodigo.value = (Number(ultimo.codigo) + 1) || '';
        } else {
          carregarProximoCodigo();
        }
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar grupos.\n' + err.message);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validar();
    if (!v.ok) {
      alert(v.erros.join('\n'));
      return;
    }

    const payload = { nome: v.nome, descricao: v.descricao };

    try {
      if (inputId.value) {
        const saved = await fetchJSON(`${API_BASE}/${inputId.value}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        preencherForm(saved);
      } else {
        await fetchJSON(API_BASE, { method: 'POST', body: JSON.stringify(payload) });
        resetForm();
      }
      await carregarLista();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar grupo.\n' + err.message);
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
        const item = await fetchJSON(`${API_BASE}/${id}`);
        preencherForm(item);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        console.error(err);
        alert('Não foi possível carregar o grupo selecionado.');
      }
    } else if (btn.hasAttribute('data-del')) {
      if (!confirm('Remover este grupo? Os funcionários associados precisarão de um novo grupo.')) return;
      try {
        await fetchJSON(`${API_BASE}/${id}`, { method: 'DELETE' });
        if (inputId.value === id) resetForm();
        await carregarLista();
      } catch (err) {
        console.error(err);
        alert('Erro ao remover grupo.\n' + err.message);
      }
    }
  });

  inputBusca?.addEventListener('input', renderLista);

  carregarLista();
  carregarProximoCodigo();
})();
