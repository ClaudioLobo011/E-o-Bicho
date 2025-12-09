(function () {
  const STORAGE_KEY = 'admin-grupos-funcionarios';
  const form = document.getElementById('grupo-form');
  const inputId = document.getElementById('grupo-id');
  const inputNome = document.getElementById('grupo-nome');
  const inputDescricao = document.getElementById('grupo-descricao');
  const selectStatus = document.getElementById('grupo-status');
  const selectPrioridade = document.getElementById('grupo-prioridade');
  const permissoesBox = document.getElementById('grupo-permissoes');
  const submitLabel = document.getElementById('grupo-submit-label');
  const btnCancelar = document.getElementById('grupo-cancelar');
  const inputBusca = document.getElementById('grupo-busca');
  const selectFiltro = document.getElementById('grupo-filtro');

  const tbody = document.getElementById('grupo-tbody');
  const empty = document.getElementById('grupo-empty');

  if (!form) return;

  const permissoesLabels = {
    pdv: 'PDV e vendas',
    agenda: 'Agenda & serviços',
    clientes: 'Clientes e pets',
    estoque: 'Estoque',
    financeiro: 'Financeiro',
    relatorios: 'Relatórios'
  };

  function carregar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('Não foi possível ler os grupos salvos.', err);
    }
    return [
      {
        id: 'g1',
        nome: 'Gerência',
        descricao: 'Time responsável por gestão de pessoas e processos.',
        status: 'ativo',
        prioridade: 'gestor',
        permissoes: ['pdv', 'financeiro', 'relatorios', 'clientes']
      },
      {
        id: 'g2',
        nome: 'Atendimento',
        descricao: 'Foco em agendamentos, check-in e relacionamento.',
        status: 'ativo',
        prioridade: 'padrao',
        permissoes: ['agenda', 'clientes', 'pdv']
      },
      {
        id: 'g3',
        nome: 'Estoquista',
        descricao: 'Conferência de mercadorias, inventários e ajustes.',
        status: 'inativo',
        prioridade: 'restrito',
        permissoes: ['estoque']
      }
    ];
  }

  function salvar(grupos) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(grupos));
    } catch (err) {
      alert('Erro ao salvar os grupos localmente. Verifique permissões do navegador.');
      console.error(err);
    }
  }

  function getGrupos() {
    return carregar();
  }

  function setGrupos(data) {
    salvar(data);
  }

  function getPermissoesSelecionadas() {
    return Array
      .from(permissoesBox.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);
  }

  function setPermissoesSelecionadas(arr) {
    const set = new Set(arr || []);
    permissoesBox.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = set.has(cb.value);
    });
  }

  function validar() {
    const erros = [];
    const nome = (inputNome.value || '').trim();
    const descricao = (inputDescricao.value || '').trim();
    const status = selectStatus.value || 'ativo';
    const prioridade = selectPrioridade.value || 'padrao';
    const permissoes = getPermissoesSelecionadas();

    if (!nome) erros.push('Informe o nome do grupo.');
    if (!permissoes.length) erros.push('Selecione ao menos uma permissão.');

    return { ok: erros.length === 0, erros, nome, descricao, status, prioridade, permissoes };
  }

  function resetForm() {
    inputId.value = '';
    inputNome.value = '';
    inputDescricao.value = '';
    selectStatus.value = 'ativo';
    selectPrioridade.value = 'padrao';
    setPermissoesSelecionadas([]);
    submitLabel.textContent = 'Salvar';
    btnCancelar.classList.add('hidden');
  }

  function preencherForm(grupo) {
    inputId.value = grupo.id;
    inputNome.value = grupo.nome || '';
    inputDescricao.value = grupo.descricao || '';
    selectStatus.value = grupo.status || 'ativo';
    selectPrioridade.value = grupo.prioridade || 'padrao';
    setPermissoesSelecionadas(grupo.permissoes || []);
    submitLabel.textContent = 'Atualizar';
    btnCancelar.classList.remove('hidden');
  }

  function badgeStatus(status) {
    const base = 'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold';
    if (status === 'inativo') {
      return `${base} bg-gray-100 text-gray-700`;
    }
    return `${base} bg-emerald-50 text-emerald-700`;
  }

  function badgePrioridade(prioridade) {
    const base = 'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold';
    if (prioridade === 'gestor') return `${base} bg-orange-50 text-orange-700`;
    if (prioridade === 'restrito') return `${base} bg-blue-50 text-blue-700`;
    return `${base} bg-gray-100 text-gray-700`;
  }

  function renderLista() {
    const busca = (inputBusca.value || '').trim().toLowerCase();
    const filtro = selectFiltro.value || 'todos';
    const grupos = getGrupos();

    tbody.innerHTML = '';

    const filtrados = grupos.filter(g => {
      const texto = `${g.nome} ${g.descricao || ''}`.toLowerCase();
      const matchBusca = !busca || texto.includes(busca);
      const matchStatus = filtro === 'todos' || g.status === filtro;
      return matchBusca && matchStatus;
    });

    if (!filtrados.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    filtrados.forEach(grupo => {
      const tr = document.createElement('tr');
      const permissoesFormatadas = (grupo.permissoes || [])
        .map(key => permissoesLabels[key] || key)
        .map(label => `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">${label}</span>`)
        .join(' ');

      tr.innerHTML = `
        <td class="px-3 py-2">
          <div class="font-semibold text-gray-900">${grupo.nome || ''}</div>
          <p class="text-xs text-gray-500">${grupo.descricao || '—'}</p>
        </td>
        <td class="px-3 py-2">
          <div class="flex flex-wrap gap-1">${permissoesFormatadas || '<span class="text-xs text-gray-400">Sem permissões</span>'}</div>
        </td>
        <td class="px-3 py-2">
          <span class="${badgeStatus(grupo.status)}">
            <i class="fas ${grupo.status === 'ativo' ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            ${grupo.status === 'ativo' ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td class="px-3 py-2">
          <span class="${badgePrioridade(grupo.prioridade)}">
            <i class="fas fa-signal"></i>
            ${grupo.prioridade === 'gestor' ? 'Gestor' : grupo.prioridade === 'restrito' ? 'Restrito' : 'Padrão'}
          </span>
        </td>
        <td class="px-3 py-2">
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-800" data-edit="${grupo.id}"><i class="fas fa-pen"></i></button>
            <button class="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700" data-del="${grupo.id}"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = validar();
    if (!v.ok) {
      alert(v.erros.join('\n'));
      return;
    }

    const grupos = getGrupos();
    const payload = {
      id: inputId.value || `g-${Date.now()}`,
      nome: v.nome,
      descricao: v.descricao,
      status: v.status,
      prioridade: v.prioridade,
      permissoes: v.permissoes
    };

    const idx = grupos.findIndex(g => g.id === payload.id);
    if (idx >= 0) {
      grupos[idx] = payload;
    } else {
      grupos.push(payload);
    }

    setGrupos(grupos);
    renderLista();
    resetForm();
  });

  btnCancelar?.addEventListener('click', () => {
    resetForm();
  });

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const editId = btn.getAttribute('data-edit');
    const delId = btn.getAttribute('data-del');
    const grupos = getGrupos();

    if (editId) {
      const found = grupos.find(g => g.id === editId);
      if (!found) {
        alert('Grupo não encontrado para edição.');
        return;
      }
      preencherForm(found);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (delId) {
      if (!confirm('Remover este grupo? Os funcionários associados precisarão de um novo grupo.')) return;
      const filtrado = grupos.filter(g => g.id !== delId);
      setGrupos(filtrado);
      if (inputId.value === delId) resetForm();
      renderLista();
    }
  });

  inputBusca?.addEventListener('input', renderLista);
  selectFiltro?.addEventListener('change', renderLista);

  renderLista();
})();
