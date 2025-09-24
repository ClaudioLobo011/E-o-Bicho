document.addEventListener('DOMContentLoaded', () => {
  const tabela = document.getElementById('tabela-funcionarios');
  const btnAdd = document.getElementById('btn-add-funcionario');

  // Modal Edit
  const modal = document.getElementById('modal-edit-funcionario');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('edit-funcionario-form');
  const inputId = document.getElementById('edit-id');
  const inputCodigo = document.getElementById('edit-codigo');
  const inputDataCadastro = document.getElementById('edit-data-cadastro');
  const selectSituacao = document.getElementById('edit-situacao');
  const inputNome = document.getElementById('edit-nome');
  const inputEmail = document.getElementById('edit-email');
  const inputCelular = document.getElementById('edit-celular');
  const inputTelefone = document.getElementById('edit-telefone');
  const inputPassword = document.getElementById('edit-password');
  const togglePassword = document.getElementById('toggle-password');
  const togglePasswordIcon = document.getElementById('toggle-password-icon');
  const roleSelect = document.getElementById('edit-role');
  const passwordBar = document.getElementById('password-bar');
  const gruposBox = document.getElementById('edit-grupos');
  const empresasBox = document.getElementById('edit-empresas');
  const selectSexo = document.getElementById('edit-sexo');
  const empresaContratualSelect = document.getElementById('edit-empresa-contratual');
  const enderecoCep = document.getElementById('edit-endereco-cep');
  const enderecoLogradouro = document.getElementById('edit-endereco-endereco');
  const enderecoNumero = document.getElementById('edit-endereco-numero');
  const enderecoComplemento = document.getElementById('edit-endereco-complemento');
  const enderecoBairro = document.getElementById('edit-endereco-bairro');
  const enderecoCidade = document.getElementById('edit-endereco-cidade');
  const enderecoApelido = document.getElementById('edit-endereco-apelido');
  const btnAddEndereco = document.getElementById('btn-add-endereco');
  const listaEnderecos = document.getElementById('lista-enderecos');
  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

  // Modal Search
  const modalSearch = document.getElementById('modal-search-user');
  const searchInput = document.getElementById('search-term');
  const searchResults = document.getElementById('search-results');

  // Auth
  const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
  const token = cached?.token || '';
  let ACTOR_ROLE = cached?.role || null;

  const API = {
    list:   `${API_CONFIG.BASE_URL}/admin/funcionarios`,
    create: `${API_CONFIG.BASE_URL}/admin/funcionarios`,
    update: (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
    get:    (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
    remove: (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
    searchUsers: (q = '', limit = 5) =>
      `${API_CONFIG.BASE_URL}/admin/funcionarios/buscar-usuarios?q=${encodeURIComponent(q)}&limit=${limit}`,
    transform: `${API_CONFIG.BASE_URL}/admin/funcionarios/transformar`,
    authCheck: `${API_CONFIG.BASE_URL}/auth/check`,
  };

  const ROLE_LABEL = {
    funcionario: 'Funcionário',
    admin: 'Administrador',
    admin_master: 'Admin Master',
  };
  const roleRank = { cliente: 0, funcionario: 1, admin: 2, admin_master: 3 };
  let enderecos = [];
  let empresasDisponiveis = [];
  let enderecoEditandoIndex = null;
  let lastCepConsultado = '';
  let lastEnderecoViaCep = null;

  function onlyDigits(value = '') {
    return String(value || '').replace(/\D/g, '');
  }

  function formatCEP(value = '') {
    const digits = onlyDigits(value).slice(0, 8);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  function formatPhone(value = '') {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length >= 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
    }
    if (digits.length >= 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
    }
    if (digits.length >= 6) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
    }
    if (digits.length > 2) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    }
    return digits;
  }

  async function consultarViaCep(valorCep) {
    const clean = onlyDigits(valorCep);
    if (clean.length !== 8) {
      throw new Error('Informe um CEP com 8 dígitos.');
    }
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) throw new Error('Não foi possível consultar o CEP informado.');
    const data = await res.json();
    if (data?.erro) throw new Error('CEP não encontrado.');
    return {
      cep: formatCEP(clean),
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
      ibge: data.ibge || '',
    };
  }

  function aplicarViaCepNosCampos(dados) {
    if (!dados) return;
    if (enderecoCep) enderecoCep.value = dados.cep || '';
    if (enderecoLogradouro) enderecoLogradouro.value = dados.logradouro || '';
    if (enderecoBairro) enderecoBairro.value = dados.bairro || '';
    if (enderecoCidade) enderecoCidade.value = dados.cidade || '';
    if (enderecoApelido && !enderecoApelido.value) enderecoApelido.value = 'Principal';
  }

  async function garantirPreenchimentoPorCep(force = false) {
    if (!enderecoCep) return null;
    const raw = enderecoCep.value || '';
    const clean = onlyDigits(raw);
    if (clean.length !== 8) return null;
    if (!force && clean === lastCepConsultado) return lastEnderecoViaCep;

    try {
      const via = await consultarViaCep(clean);
      lastCepConsultado = clean;
      lastEnderecoViaCep = via;
      aplicarViaCepNosCampos(via);
      if (typeof window.showToast === 'function') {
        window.showToast('Endereço preenchido pelo CEP.', 'success', 1500);
      }
      return via;
    } catch (err) {
      console.error(err);
      toastWarn(err.message || 'Não foi possível buscar o CEP informado.');
      return null;
    }
  }

  function formatDateDisplay(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function setCodigoValue(value) {
    if (!inputCodigo) return;
    if (value) {
      inputCodigo.value = value;
      inputCodigo.dataset.originalValue = value;
      inputCodigo.dataset.hasValue = 'true';
    } else {
      inputCodigo.value = 'Gerado automaticamente';
      inputCodigo.dataset.originalValue = '';
      inputCodigo.dataset.hasValue = 'false';
    }
  }

  function setDataCadastroValue(value) {
    if (!inputDataCadastro) return;
    if (value) {
      inputDataCadastro.value = formatDateDisplay(value);
      inputDataCadastro.dataset.originalValue = value;
      inputDataCadastro.dataset.hasValue = 'true';
    } else {
      const now = new Date();
      inputDataCadastro.value = formatDateDisplay(now.toISOString());
      inputDataCadastro.dataset.originalValue = '';
      inputDataCadastro.dataset.hasValue = 'false';
    }
  }

  function setEmpresaContratualValue(value, label = 'Empresa selecionada') {
    if (!empresaContratualSelect) return;
    if (value) {
      const exists = Array.from(empresaContratualSelect.options || []).some((opt) => opt.value === value);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label || 'Empresa selecionada';
        empresaContratualSelect.appendChild(opt);
      }
      empresaContratualSelect.value = value;
    } else {
      empresaContratualSelect.value = '';
    }
    empresaContratualSelect.dataset.selectedValue = value || '';
  }

  function normalizeSexoValue(value) {
    if (!value) return '';
    const normalized = String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    if (['masculino', 'm', 'male', 'homem'].includes(normalized)) return 'masculino';
    if (['feminino', 'f', 'female', 'mulher'].includes(normalized)) return 'feminino';
    if (
      [
        'nao_informar',
        'naoinformar',
        'nao informar',
        'nao informado',
        'nao declarado',
        'prefere nao dizer',
        'prefere nao informar',
        'prefere_nao_dizer',
        'na',
        'n/a',
        'indefinido',
      ].includes(normalized)
    ) {
      return 'nao_informar';
    }
    if (['masculina', 'masculine'].includes(normalized)) return 'masculino';
    if (['feminina', 'feminine'].includes(normalized)) return 'feminino';
    return '';
  }

  function normalizeEndereco(item = {}) {
    return {
      _id: item._id || item.id || null,
      cep: formatCEP(item.cep || ''),
      logradouro: item.logradouro || item.endereco || '',
      numero: item.numero || '',
      complemento: item.complemento || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      apelido: item.apelido || '',
      uf: item.uf || '',
      ibge: item.ibge || '',
      isDefault: item.isDefault === true,
    };
  }

  function clearEnderecoForm() {
    if (!enderecoCep) return;
    enderecoCep.value = '';
    enderecoLogradouro.value = '';
    enderecoNumero.value = '';
    enderecoComplemento.value = '';
    enderecoBairro.value = '';
    enderecoCidade.value = '';
    if (enderecoApelido) enderecoApelido.value = 'Principal';
    lastCepConsultado = '';
    lastEnderecoViaCep = null;
    enderecoEditandoIndex = null;
    updateEnderecoButtonLabel();
  }

  function renderEnderecosList() {
    if (!listaEnderecos) return;
    if (!Array.isArray(enderecos) || enderecos.length === 0) {
      listaEnderecos.innerHTML = '<p class="text-xs text-gray-500">Nenhum endereço cadastrado.</p>';
      return;
    }
    const cards = enderecos.map((item, index) => {
      const titulo = item.apelido || item.logradouro || '-';
      const linha2 = [item.numero, item.complemento].filter(Boolean).join(' • ');
      const cidadeUf = [item.cidade, item.uf].filter(Boolean).join(' - ');
      const linha3 = [item.bairro, cidadeUf].filter(Boolean).join(' - ');
      const cep = item.cep ? `CEP: ${formatCEP(item.cep)}` : '';
      const badge = item.isDefault ? '<span class="ml-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full uppercase">Principal</span>' : '';
      return `
        <div class="border rounded-lg px-3 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2" data-endereco-index="${index}">
          <div class="text-xs text-gray-700">
            <p class="font-semibold flex items-center gap-1">${titulo}${badge}</p>
            ${linha2 ? `<p class="text-gray-600">${linha2}</p>` : ''}
            ${linha3 ? `<p class="text-gray-600">${linha3}</p>` : ''}
            ${cep ? `<p class="text-gray-500 text-xs">${cep}</p>` : ''}
          </div>
          <div class="flex justify-end gap-3">
            <button type="button" class="text-xs font-medium text-emerald-600 hover:text-emerald-800" data-edit-endereco="${index}">Editar</button>
            <button type="button" class="text-xs font-medium text-red-600 hover:text-red-800" data-remove-endereco="${index}">Excluir</button>
          </div>
        </div>
      `;
    }).join('');
    listaEnderecos.innerHTML = cards;
  }

  function updateEnderecoButtonLabel() {
    if (!btnAddEndereco) return;
    btnAddEndereco.textContent = enderecoEditandoIndex !== null ? 'Salvar alterações' : 'Adicionar endereço';
  }

  function preencherEnderecoForm(item = {}) {
    if (!enderecoCep) return;
    enderecoCep.value = formatCEP(item.cep || '');
    enderecoLogradouro.value = item.logradouro || '';
    enderecoNumero.value = item.numero || '';
    enderecoComplemento.value = item.complemento || '';
    enderecoBairro.value = item.bairro || '';
    enderecoCidade.value = item.cidade || '';
    if (enderecoApelido) enderecoApelido.value = item.apelido || '';
    lastCepConsultado = onlyDigits(item.cep || '');
    lastEnderecoViaCep = item.cep ? {
      cep: formatCEP(item.cep),
      logradouro: item.logradouro || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      uf: item.uf || '',
      ibge: item.ibge || '',
    } : null;
  }

  async function carregarEnderecosFuncionario(userId) {
    if (!listaEnderecos) return;
    if (!userId) {
      renderEnderecosList();
      return;
    }
    listaEnderecos.innerHTML = '<p class="text-xs text-gray-500">Carregando endereços cadastrados...</p>';
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/addresses/${userId}`, { headers: headers() });
      if (!res.ok) throw new Error('Falha ao carregar endereços');
      const data = await res.json();
      enderecos = Array.isArray(data) ? data.map(normalizeEndereco) : [];
      renderEnderecosList();
    } catch (err) {
      console.error(err);
      listaEnderecos.innerHTML = '<p class="text-xs text-red-600">Não foi possível carregar os endereços.</p>';
    }
  }

  async function salvarEnderecoRemoto(userId, payload, enderecoId = null) {
    if (!userId) return null;
    const body = JSON.stringify({ ...payload, userId });
    const url = enderecoId ? `${API_CONFIG.BASE_URL}/addresses/${enderecoId}` : `${API_CONFIG.BASE_URL}/addresses`;
    const method = enderecoId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: headers(), body });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(errorBody || 'Falha ao salvar endereço');
    }
    return res.json().catch(() => null);
  }

  async function removerEnderecoRemoto(enderecoId) {
    if (!enderecoId) return;
    const res = await fetch(`${API_CONFIG.BASE_URL}/addresses/${enderecoId}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(errorBody || 'Falha ao remover endereço');
    }
  }

  function activateTab(target) {
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tabTarget === target;
      btn.classList.toggle('bg-emerald-50', isActive);
      btn.classList.toggle('text-emerald-700', isActive);
      btn.classList.toggle('text-gray-600', !isActive);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tabTarget || 'dados';
      activateTab(target);
    });
  });
  activateTab('dados');

  if (enderecoCep) {
    enderecoCep.addEventListener('input', () => {
      const formatted = formatCEP(enderecoCep.value || '');
      if (enderecoCep.value !== formatted) {
        enderecoCep.value = formatted;
        if (typeof enderecoCep.selectionStart === 'number') {
          const pos = formatted.length;
          enderecoCep.setSelectionRange(pos, pos);
        }
      }
    });
    enderecoCep.addEventListener('blur', () => { void garantirPreenchimentoPorCep(false); });
    enderecoCep.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void garantirPreenchimentoPorCep(true);
      }
    });
  }

  btnAddEndereco?.addEventListener('click', async () => {
    const logradouroAntes = enderecoLogradouro?.value || '';
    if (!logradouroAntes) {
      await garantirPreenchimentoPorCep(true);
    }
    const cepDigits = onlyDigits(enderecoCep?.value || '');
    const viaCepData = (lastEnderecoViaCep && onlyDigits(lastEnderecoViaCep.cep || '') === cepDigits)
      ? lastEnderecoViaCep
      : null;
    const enderecoAnterior = (typeof enderecoEditandoIndex === 'number' && enderecos[enderecoEditandoIndex])
      ? enderecos[enderecoEditandoIndex]
      : {};
    const novo = normalizeEndereco({
      cep: (enderecoCep?.value || '').trim(),
      logradouro: (enderecoLogradouro?.value || '').trim(),
      numero: (enderecoNumero?.value || '').trim(),
      complemento: (enderecoComplemento?.value || '').trim(),
      bairro: (enderecoBairro?.value || '').trim(),
      cidade: (enderecoCidade?.value || '').trim(),
      apelido: (enderecoApelido?.value || '').trim(),
      uf: (viaCepData?.uf ?? enderecoAnterior.uf) || undefined,
      ibge: (viaCepData?.ibge ?? enderecoAnterior.ibge) || undefined,
    });
    if (!novo.logradouro) {
      toastWarn('Informe ao menos o endereço para adicionar.');
      return;
    }
    const funcionarioId = (inputId?.value || '').trim();
    const editing = typeof enderecoEditandoIndex === 'number' && enderecos[enderecoEditandoIndex];

    try {
      if (funcionarioId) {
        const targetId = editing ? enderecos[enderecoEditandoIndex]._id : null;
        await salvarEnderecoRemoto(funcionarioId, novo, targetId);
        await carregarEnderecosFuncionario(funcionarioId);
        toastOk(editing ? 'Endereço atualizado com sucesso.' : 'Endereço adicionado ao cadastro.');
      } else {
        if (editing) {
          enderecos[enderecoEditandoIndex] = { ...enderecos[enderecoEditandoIndex], ...novo };
        } else {
          enderecos.push(novo);
        }
        renderEnderecosList();
      }
      clearEnderecoForm();
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao salvar endereço.');
    }
  });

  listaEnderecos?.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('button[data-edit-endereco]');
    if (btnEditar) {
      const index = Number(btnEditar.getAttribute('data-edit-endereco'));
      if (!Number.isNaN(index) && enderecos[index]) {
        enderecoEditandoIndex = index;
        preencherEnderecoForm(enderecos[index]);
        updateEnderecoButtonLabel();
      }
      return;
    }

    const btnRemover = e.target.closest('button[data-remove-endereco]');
    if (!btnRemover) return;
    const index = Number(btnRemover.getAttribute('data-remove-endereco'));
    if (Number.isNaN(index) || !enderecos[index]) return;

    const confirmar = await confirmAction({
      title: 'Remover endereço',
      message: 'Tem certeza que deseja remover este endereço do cadastro?',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
    });
    if (!confirmar) return;

    const funcionarioId = (inputId?.value || '').trim();
    const alvo = enderecos[index];
    try {
      if (funcionarioId && alvo?._id) {
        await removerEnderecoRemoto(alvo._id);
        toastOk('Endereço removido com sucesso.');
        await carregarEnderecosFuncionario(funcionarioId);
      } else {
        enderecos.splice(index, 1);
        renderEnderecosList();
      }
      if (enderecoEditandoIndex === index) {
        clearEnderecoForm();
      }
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao remover endereço.');
    }
  });

  function headers(extra = {}) {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...extra };
  }

  async function ensureActorRole() {
    if (ACTOR_ROLE) return ACTOR_ROLE;
    try {
      const resp = await fetch(API.authCheck, { headers: headers() });
      if (resp.ok) {
        const data = await resp.json();
        ACTOR_ROLE = data?.role || null;
        const cur = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
        localStorage.setItem('loggedInUser', JSON.stringify({ ...cur, role: ACTOR_ROLE }));
      }
    } catch {}
    return ACTOR_ROLE;
  }

  const getNome = (u) =>
    (u?.nome || u?.nomeCompleto || u?.nomeContato || u?.razaoSocial || '').trim();

  function isModalOpen(m) { return m && !m.classList.contains('hidden'); }

  function optionsForActor(actorRole) {
    if (actorRole === 'admin_master') return ['funcionario', 'admin', 'admin_master'];
    if (actorRole === 'admin')        return ['funcionario'];
    return [];
  }

  // helpers bonitos
  async function confirmAction({
    title = 'Atenção',
    message = 'Tem certeza?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar'
  }) {
    return new Promise((resolve) => {
      if (typeof window.showModal === 'function') {
        window.showModal({
          title,
          message,
          confirmText,
          cancelText,
          onConfirm: () => resolve(true),
          onCancel:  () => resolve(false),
        });
      } else {
        // Fallback só se showModal NÃO existir
        resolve(window.confirm(message));
      }
    });
  }

  function toastOk(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'success');
    } else {
      // Fallback só se showToast NÃO existir
      alert(msg);
    }
  }
  function toastWarn(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'warning');
    } else {
      alert(msg);
    }
  }
  function toastError(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'error');
    } else {
      alert(msg);
    }
  }

  function openModal(mode, data = null) {
    const opts = optionsForActor(ACTOR_ROLE);
    roleSelect.innerHTML = opts.map(v => `<option value="${v}">${ROLE_LABEL[v]}</option>`).join('');
    const codigoValor = data?.codigo || data?.codigoFuncionario || data?.matricula || data?._id || '';
    const dataCadastroValor = data?.dataCadastro || data?.createdAt || '';
    const situacaoValor = data?.situacao || 'ativo';
    const sexoValor = normalizeSexoValue(data?.genero ?? data?.sexo);
    const empresaContratualValor = data?.empresaContratual || data?.empresaContratualId || '';
    const empresaContratualLabel = data?.empresaContratualNome || '';

    if (mode === 'create') {
      modalTitle.textContent = 'Adicionar Funcionário';
      inputId.value = '';
      setCodigoValue('');
      setDataCadastroValue('');
      inputNome.value = '';
      inputEmail.value = '';
      if (inputCelular) inputCelular.value = '';
      if (inputTelefone) inputTelefone.value = '';
      inputPassword.value = '';
      if (selectSituacao) selectSituacao.value = 'ativo';
      if (selectSexo) selectSexo.value = '';
      setEmpresaContratualValue('');
      roleSelect.value = opts[0] || 'funcionario';
      passwordBar.style.width = '0%';
      setGruposSelected([]);
      setEmpresasSelected([]);
      enderecos = [];
      enderecoEditandoIndex = null;
    } else {
      modalTitle.textContent = 'Editar Funcionário';
      inputId.value = data._id;
      setCodigoValue(codigoValor);
      setDataCadastroValue(dataCadastroValor);
      inputNome.value = getNome(data);
      inputEmail.value = data.email || '';
      if (inputCelular) inputCelular.value = formatPhone(data.celular || '');
      if (inputTelefone) inputTelefone.value = formatPhone(data.telefone || '');
      inputPassword.value = '';
      if (selectSituacao) selectSituacao.value = situacaoValor;
      if (selectSexo) selectSexo.value = sexoValor;
      setEmpresaContratualValue(empresaContratualValor, empresaContratualLabel);
      roleSelect.value = opts.includes(data.role) ? data.role : (opts[0] || 'funcionario');
      passwordBar.style.width = '0%';
      setGruposSelected(Array.isArray(data.grupos) ? data.grupos : []);
      setEmpresasSelected(Array.isArray(data.empresas) ? data.empresas : []);
      enderecos = Array.isArray(data.enderecos) ? data.enderecos.map(normalizeEndereco) : [];
      enderecoEditandoIndex = null;
    }

    if (mode === 'create' && empresaContratualSelect) {
      empresaContratualSelect.dataset.selectedValue = '';
    }
    if (mode === 'edit' && empresaContratualSelect) {
      empresaContratualSelect.dataset.selectedValue = empresaContratualValor || '';
    }

    renderEnderecosList();
    clearEnderecoForm();
    activateTab('dados');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    if (mode === 'edit' && data?._id) {
      carregarEnderecosFuncionario(data._id);
    }
  }
  function closeModal()      { modal.classList.add('hidden'); modal.classList.remove('flex'); }
  function openSearchModal() { modalSearch.classList.remove('hidden'); modalSearch.classList.add('flex'); searchInput.value = ''; searchUsers(''); }
  function closeSearchModal(){ modalSearch.classList.add('hidden'); modalSearch.classList.remove('flex'); }

  function passwordScore(pwd) {
    if (!pwd) return 0; let s = 0;
    if (pwd.length >= 8) s += 25;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s += 25;
    if (/\d/.test(pwd)) s += 25;
    if (/[^A-Za-z0-9]/.test(pwd)) s += 25;
    return Math.min(100, s);
  }

  // Render com fallback de ordenação (servidor já manda ordenado)
  function renderTable(funcionarios) {
    if (!Array.isArray(funcionarios) || funcionarios.length === 0) {
      tabela.innerHTML = `<p class="text-gray-500">Nenhum funcionário cadastrado.</p>`;
      return;
    }
    funcionarios.sort((a, b) => {
      const r = (roleRank[b.role] ?? -1) - (roleRank[a.role] ?? -1);
      if (r !== 0) return r;
      return getNome(a).localeCompare(getNome(b), 'pt-BR');
    });

    const rows = funcionarios.map(f => `
      <tr class="border-b">
        <td class="py-2 px-4">${getNome(f) || '-'}</td>
        <td class="py-2 px-4">${f.email || '-'}</td>
        <td class="py-2 px-4 capitalize">${ROLE_LABEL[f.role] || f.role}</td>
        <td class="py-2 px-4 text-right">
          <button class="text-blue-600 hover:text-blue-800 mr-3" data-action="edit" data-id="${f._id}">
            <i class="fa-solid fa-pen-to-square"></i> Editar
          </button>
          <button class="text-red-600 hover:text-red-800" data-action="delete" data-id="${f._id}">
            <i class="fa-solid fa-trash"></i> Remover do quadro
          </button>
        </td>
      </tr>
    `).join('');

    tabela.innerHTML = `
      <table class="min-w-full bg-white border rounded-lg overflow-hidden">
        <thead>
          <tr class="bg-gray-50 text-left">
            <th class="py-2 px-4">Nome</th>
            <th class="py-2 px-4">Email</th>
            <th class="py-2 px-4">Cargo</th>
            <th class="py-2 px-4 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  async function loadFuncionarios() {
    tabela.innerHTML = `<p class="text-gray-600">Carregando funcionários...</p>`;
    try {
      const res = await fetch(API.list, { headers: headers() });
      if (!res.ok) throw new Error('Falha ao listar funcionários');
      renderTable(await res.json());
    } catch (e) {
      console.error(e);
      tabela.innerHTML = `<p class="text-red-600">Erro ao carregar funcionários.</p>`;
      toastError('Não foi possível carregar os funcionários.');
    }
  }

  // ===== Pesquisa (backend já não retorna quem está no quadro) =====
  function renderSearchResults(items) {
    if (!Array.isArray(items) || items.length === 0) {
      searchResults.innerHTML = `<div class="p-4 text-gray-500">Nenhum usuário encontrado.</div>`;
      return;
    }
    const allowed = optionsForActor(ACTOR_ROLE);

    const html = items.slice(0, 5).map(u => {
      const nome = getNome(u) || '(Sem nome)';
      const doc = u.cpf || u.cnpj || '';
      const opts = allowed.map(v => `<option value="${v}">${ROLE_LABEL[v]}</option>`).join('');
      return `
        <div class="p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div class="flex-1">
            <div class="font-medium">${nome}</div>
            <div class="text-sm text-gray-600">${u.email || '-'}</div>
            <div class="text-xs text-gray-500">${doc ? `Doc: ${doc}` : ''}</div>
          </div>
          <div class="flex items-center gap-2">
            <select class="border rounded px-2 py-1" data-role-select="${u._id}">
              ${opts}
            </select>
            <button class="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    data-action="promote" data-id="${u._id}">
              Adicionar
            </button>
          </div>
        </div>
      `;
    }).join('');
    searchResults.innerHTML = html;
  }

  async function searchUsers(q) {
    try {
      const res = await fetch(API.searchUsers(q, 5), { headers: headers() });
      if (!res.ok) throw new Error('Falha na busca');
      renderSearchResults(await res.json());
    } catch (e) {
      console.error(e);
      searchResults.innerHTML = `<div class="p-4 text-red-600">Erro ao buscar usuários.</div>`;
      toastError('Não foi possível buscar usuários.');
    }
  }

  function debounce(fn, wait = 300) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }
  const debouncedSearch = debounce((val) => searchUsers((val || '').trim()), 300);

  // ===== Eventos globais / modais =====
  btnAdd?.addEventListener('click', openSearchModal);

  modal.addEventListener('click', (e) => {
    const back = e.target === modal;
    const x = e.target.closest('#modal-close');
    const cancel = e.target.closest('#btn-cancelar');
    if (back || x || cancel) { e.preventDefault(); closeModal(); }
  });
  modalSearch.addEventListener('click', (e) => {
    const back = e.target === modalSearch;
    const x = e.target.closest('#modal-search-close');
    const cancel = e.target.closest('#btn-search-cancel');
    if (back || x || cancel) { e.preventDefault(); closeSearchModal(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen(modal)) closeModal();
    if (e.key === 'Escape' && isModalOpen(modalSearch)) closeSearchModal();
  });

  togglePassword?.addEventListener('click', () => {
    const willShow = inputPassword.type === 'password';
    inputPassword.type = willShow ? 'text' : 'password';
    togglePassword.setAttribute('aria-label', willShow ? 'Ocultar senha' : 'Mostrar senha');
    if (togglePasswordIcon) {
      togglePasswordIcon.classList.remove('fa-eye', 'fa-eye-slash');
      togglePasswordIcon.classList.add(willShow ? 'fa-eye-slash' : 'fa-eye');
    }
  });
  inputPassword.addEventListener('input', () => passwordBar.style.width = `${passwordScore(inputPassword.value)}%`);

  function attachPhoneMask(input) {
    if (!input) return;
    input.addEventListener('input', (event) => {
      const digits = onlyDigits(event.target.value);
      event.target.value = formatPhone(digits);
    });
    input.addEventListener('blur', (event) => {
      event.target.value = formatPhone(event.target.value);
    });
  }

  attachPhoneMask(inputCelular);
  attachPhoneMask(inputTelefone);

  function getSelectedGrupos() {
    if (!gruposBox) return [];
    return Array.from(gruposBox.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  }
  function setGruposSelected(arr) {
    if (!gruposBox) return;
    const sel = new Set(arr || []);
    gruposBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = sel.has(cb.value));
  }

  // --- Empresas (Lojas) ---
  async function loadEmpresasOptions() {
    if (!empresasBox) return;
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/stores`);
      if (!res.ok) throw new Error('Falha ao carregar empresas');
      const stores = await res.json();
      empresasDisponiveis = Array.isArray(stores) ? stores : [];
      empresasBox.innerHTML = empresasDisponiveis.map(s => `
        <label class="inline-flex items-center gap-2">
          <input type="checkbox" value="${s._id}" class="rounded border-gray-300">
          <span>${s.nome || 'Sem nome'}</span>
        </label>
      `).join('');

      if (empresaContratualSelect) {
        const selected = empresaContratualSelect.dataset.selectedValue || '';
        const selectOptions = ['<option value="">Selecione uma empresa</option>',
          ...empresasDisponiveis.map(s => `<option value="${s._id}">${s.nome || 'Sem nome'}</option>`)
        ];
        empresaContratualSelect.innerHTML = selectOptions.join('');
        const selectedEmpresa = empresasDisponiveis.find((s) => s._id === selected);
        setEmpresaContratualValue(selected, selectedEmpresa?.nome || 'Empresa selecionada');
      }
    } catch (err) {
      console.error(err);
      empresasBox.innerHTML = '<p class="text-sm text-red-600">Erro ao carregar empresas.</p>';
      if (empresaContratualSelect) {
        empresaContratualSelect.innerHTML = '<option value="">Selecione uma empresa</option>';
      }
    }
  }
  function getSelectedEmpresas() {
    if (!empresasBox) return [];
    return Array.from(empresasBox.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  }
  function setEmpresasSelected(arr) {
    if (!empresasBox) return;
    const sel = new Set(arr || []);
    empresasBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = sel.has(cb.value));
  }

  searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));

  // transformar usuário (selecionado na busca)
  searchResults.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="promote"]');
    if (!btn) return;
    const userId = btn.getAttribute('data-id');
    const select = searchResults.querySelector(`select[data-role-select="${userId}"]`);
    const newRole = select?.value || 'funcionario';

    btn.disabled = true;
    try {
      const res = await fetch(API.transform, { method: 'POST', headers: headers(), body: JSON.stringify({ userId, role: newRole }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Falha ao transformar usuário.');
      }
      toastOk(`Usuário adicionado ao quadro como ${ROLE_LABEL[newRole]}.`);
      await loadFuncionarios();
      closeSearchModal();
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao transformar usuário.');
    } finally {
      btn.disabled = false;
    }
  });

  // Ações da tabela (editar/remover)
  tabela.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'edit') {
      try {
        const res = await fetch(API.get(id), { headers: headers() });
        if (!res.ok) throw new Error('Falha ao obter funcionário');
        openModal('edit', await res.json());
      } catch (err) {
        console.error(err);
        toastError('Não foi possível abrir o funcionário.');
      }
    }

    if (action === 'delete') {
      const ok = await confirmAction({
        title: 'Remover do quadro',
        message: 'Tem certeza que deseja remover este funcionário do quadro? (o usuário volta a ser cliente)',
        confirmText: 'Remover', cancelText: 'Cancelar'
      });
      if (!ok) return;

      try {
        const res = await fetch(API.remove(id), { method: 'DELETE', headers: headers() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'Falha ao remover');
        toastOk('Funcionário removido com sucesso.');
        await loadFuncionarios();
      } catch (err) {
        console.error(err);
        toastError(err.message || 'Erro ao remover funcionário.');
      }
    }
  });

  // Submit Edit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      nome: inputNome.value.trim(),
      email: inputEmail.value.trim(),
      role: roleSelect.value,
      grupos: getSelectedGrupos(),
      empresas: getSelectedEmpresas(),
    };

    if (inputCelular) {
      const celularDigits = onlyDigits(inputCelular.value);
      if (!celularDigits) {
        toastWarn('Informe um celular válido.');
        inputCelular.focus();
        return;
      }
      payload.celular = celularDigits;
    }

    if (inputTelefone) {
      const telefoneDigits = onlyDigits(inputTelefone.value);
      payload.telefone = telefoneDigits;
    }
    if (selectSituacao) {
      payload.situacao = selectSituacao.value || 'ativo';
    }
    if (selectSexo) {
      const sexoVal = selectSexo.value || '';
      payload.genero = sexoVal;
    }
    if (empresaContratualSelect) {
      const contratualVal = empresaContratualSelect.value || '';
      if (contratualVal) payload.empresaContratual = contratualVal;
    }
    if (Array.isArray(enderecos)) {
      payload.enderecos = enderecos;
    }
    if (inputCodigo && inputCodigo.dataset?.hasValue === 'true') {
      payload.codigo = inputCodigo.dataset.originalValue || inputCodigo.value;
    }
    if (inputDataCadastro && inputDataCadastro.dataset?.hasValue === 'true') {
      payload.dataCadastro = inputDataCadastro.dataset.originalValue || inputDataCadastro.value;
    }
    const pwd = inputPassword.value.trim();
    if (pwd) payload.senha = pwd;

    const id = inputId.value.trim();
    const isCreate = !id;

    try {
      const res = await fetch(isCreate ? API.create : API.update(id), {
        method: isCreate ? 'POST' : 'PUT',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Falha ao salvar');

      closeModal();
      toastOk('Dados do funcionário salvos.');
      await loadFuncionarios();
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao salvar funcionário.');
    }
  });

  // Init
  (async () => {
    await ensureActorRole();
    await loadEmpresasOptions();
    await loadFuncionarios();
  })()
});
