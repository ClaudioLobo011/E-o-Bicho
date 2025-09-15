(function () {
  const API = `${API_CONFIG.BASE_URL}/admin/servicos/grupos`;

  const form = document.getElementById('grupo-form');
  const inputId = document.getElementById('grupo-id');
  const inputNome = document.getElementById('grupo-nome');
  const tiposBox = document.getElementById('grupo-tipos');
  const inputComissao = document.getElementById('grupo-comissao');
  const submitLabel = document.getElementById('grupo-submit-label');
  const btnCancelar = document.getElementById('grupo-cancelar');

  const tbody = document.getElementById('grupo-tbody');
  const empty = document.getElementById('grupo-empty');

  if (!form) return;

  function getToken() {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return cached?.token || '';
    } catch { return ''; }
  }

  function getTiposSelecionados() {
    return Array
      .from(tiposBox.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);
  }

  function setTiposSelecionados(arr) {
    const set = new Set(arr || []);
    tiposBox.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = set.has(cb.value);
    });
  }

  function validar() {
    const erros = [];
    const nome = (inputNome.value || '').trim();
    const comissao = Number(inputComissao.value);

    if (!nome) erros.push('Informe o nome do grupo.');
    const tipos = getTiposSelecionados();
    if (!tipos.length) erros.push('Selecione ao menos um tipo de funcionário.');
    if (Number.isNaN(comissao) || comissao < 0 || comissao > 100) {
      erros.push('Comissão deve estar entre 0 e 100.');
    }
    return { ok: erros.length === 0, erros, nome, tipos, comissao };
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

      const tiposFmt = (it.tiposPermitidos || []).map(t => {
        switch (t) {
          case 'esteticista': return 'Esteticista';
          case 'veterinario': return 'Veterinário';
          case 'vendedor': return 'Vendedor';
          case 'gerente': return 'Gerente';
          default: return t;
        }
      }).join(', ');

      tr.innerHTML = `
        <td class="px-3 py-2 font-medium text-gray-800">${it.nome || ''}</td>
        <td class="px-3 py-2 text-gray-700">${tiposFmt}</td>
        <td class="px-3 py-2 text-gray-700">${Number(it.comissaoPercent || 0).toFixed(2)}</td>
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
    setTiposSelecionados([]);
    inputComissao.value = '0';
    submitLabel.textContent = 'Salvar';
    btnCancelar.classList.add('hidden');
  }

  function fillForm(item) {
    inputId.value = item._id;
    inputNome.value = item.nome || '';
    setTiposSelecionados(item.tiposPermitidos || []);
    inputComissao.value = Number(item.comissaoPercent || 0).toString();
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
      tiposPermitidos: v.tipos,
      comissaoPercent: v.comissao
    };

    try {
      if (inputId.value) {
        const saved = await fetchJSON(`${API}/${inputId.value}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        fillForm(saved); // mantém no modo edição com valores atualizados
      } else {
        await fetchJSON(API, { method: 'POST', body: JSON.stringify(payload) });
        resetForm();
      }
      await listar();
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
        const item = await fetchJSON(`${API}/${id}`);
        fillForm(item);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        alert('Não foi possível carregar o grupo selecionado.');
      }
    } else if (btn.hasAttribute('data-del')) {
      if (!confirm('Confirma remover este grupo?')) return;
      try {
        await fetchJSON(`${API}/${id}`, { method: 'DELETE' });
        if (inputId.value === id) resetForm();
        await listar();
      } catch (err) {
        alert('Erro ao remover grupo.\n' + err.message);
      }
    }
  });

  // Inicialização
  listar().catch(err => {
    console.error(err);
    alert('Erro ao carregar grupos.\n' + err.message);
  });
})();