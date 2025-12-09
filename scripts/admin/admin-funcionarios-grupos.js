(function () {
  const STORAGE_KEY = 'admin-grupos-funcionarios';
  const form = document.getElementById('grupo-form');
  const inputId = document.getElementById('grupo-id');
  const inputCodigo = document.getElementById('grupo-codigo');
  const inputNome = document.getElementById('grupo-nome');
  const inputDescricao = document.getElementById('grupo-descricao');
  const selectPrioridade = document.getElementById('grupo-prioridade');
  const submitLabel = document.getElementById('grupo-submit-label');
  const btnCancelar = document.getElementById('grupo-cancelar');
  const inputBusca = document.getElementById('grupo-busca');

  const tbody = document.getElementById('grupo-tbody');
  const empty = document.getElementById('grupo-empty');

  if (!form) return;

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
        codigo: 'GRP-001',
        nome: 'Gerência',
        descricao: 'Time responsável por gestão de pessoas e processos.',
        prioridade: 'gestor'
      },
      {
        id: 'g2',
        codigo: 'GRP-002',
        nome: 'Atendimento',
        descricao: 'Foco em agendamentos, check-in e relacionamento.',
        prioridade: 'padrao'
      },
      {
        id: 'g3',
        codigo: 'GRP-003',
        nome: 'Estoquista',
        descricao: 'Conferência de mercadorias, inventários e ajustes.',
        prioridade: 'restrito'
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

  function validar() {
    const erros = [];
    const codigo = (inputCodigo.value || '').trim();
    const nome = (inputNome.value || '').trim();
    const descricao = (inputDescricao.value || '').trim();
    const prioridade = selectPrioridade.value || 'padrao';

    if (!codigo) erros.push('Informe o código do grupo.');
    if (!nome) erros.push('Informe o nome do grupo.');

    const codigoNormalizado = codigo.toLowerCase();
    const grupos = getGrupos();
    const idAtual = inputId.value;
    const codigoDuplicado = grupos.some(g => (g.codigo || '').trim().toLowerCase() === codigoNormalizado && g.id !== idAtual);
    if (codigoDuplicado) erros.push('Já existe um grupo com este código.');

    return { ok: erros.length === 0, erros, codigo, nome, descricao, prioridade };
  }

  function resetForm() {
    inputId.value = '';
    inputCodigo.value = '';
    inputNome.value = '';
    inputDescricao.value = '';
    selectPrioridade.value = 'padrao';
    submitLabel.textContent = 'Salvar';
    btnCancelar.classList.add('hidden');
  }

  function preencherForm(grupo) {
    inputId.value = grupo.id;
    inputCodigo.value = grupo.codigo || '';
    inputNome.value = grupo.nome || '';
    inputDescricao.value = grupo.descricao || '';
    selectPrioridade.value = grupo.prioridade || 'padrao';
    submitLabel.textContent = 'Atualizar';
    btnCancelar.classList.remove('hidden');
  }

  function badgePrioridade(prioridade) {
    const base = 'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold';
    if (prioridade === 'gestor') return `${base} bg-orange-50 text-orange-700`;
    if (prioridade === 'restrito') return `${base} bg-blue-50 text-blue-700`;
    return `${base} bg-gray-100 text-gray-700`;
  }

  function renderLista() {
    const busca = (inputBusca.value || '').trim().toLowerCase();
    const grupos = getGrupos();

    tbody.innerHTML = '';

    const filtrados = grupos.filter(g => {
      const texto = `${g.codigo || ''} ${g.nome} ${g.descricao || ''}`.toLowerCase();
      const matchBusca = !busca || texto.includes(busca);
      return matchBusca;
    });

    if (!filtrados.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    filtrados.forEach(grupo => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2">${grupo.codigo || '—'}</td>
        <td class="px-3 py-2">
          <div class="font-semibold text-gray-900">${grupo.nome || ''}</div>
          <p class="text-xs text-gray-500">${grupo.descricao || '—'}</p>
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
      codigo: v.codigo,
      nome: v.nome,
      descricao: v.descricao,
      prioridade: v.prioridade
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

  renderLista();
})();
