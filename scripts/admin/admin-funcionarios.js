document.addEventListener('DOMContentLoaded', () => {
  const tabela = document.getElementById('tabela-funcionarios');
  const btnAdd = document.getElementById('btn-add-funcionario');

  // Modal Edit
  const modal = document.getElementById('modal-edit-funcionario');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('edit-funcionario-form');
  const inputId = document.getElementById('edit-id');
  const inputNome = document.getElementById('edit-nome');
  const inputEmail = document.getElementById('edit-email');
  const inputPassword = document.getElementById('edit-password');
  const togglePassword = document.getElementById('toggle-password');
  const roleSelect = document.getElementById('edit-role');
  const passwordBar = document.getElementById('password-bar');
  const gruposBox = document.getElementById('edit-grupos');
  const empresasBox = document.getElementById('edit-empresas');

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

  if (mode === 'create') {
    modalTitle.textContent = 'Adicionar Funcionário';
    inputId.value = ''; inputNome.value = ''; inputEmail.value = ''; inputPassword.value = '';
    roleSelect.value = opts[0] || 'funcionario';
    passwordBar.style.width = '0%';
    setGruposSelected([]);
    setEmpresasSelected([]);
  } else {
    modalTitle.textContent = 'Editar Funcionário';
    inputId.value = data._id;
    inputNome.value = getNome(data);
    inputEmail.value = data.email || '';
    inputPassword.value = '';
    roleSelect.value = opts.includes(data.role) ? data.role : (opts[0] || 'funcionario');
    passwordBar.style.width = '0%';
    setGruposSelected(Array.isArray(data.grupos) ? data.grupos : []);
    setEmpresasSelected(Array.isArray(data.empresas) ? data.empresas : []);
  }
    modal.classList.remove('hidden'); modal.classList.add('flex');
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

  togglePassword.addEventListener('click', () => {
    if (inputPassword.type === 'password') { inputPassword.type = 'text'; togglePassword.textContent = 'Ocultar'; }
    else { inputPassword.type = 'password'; togglePassword.textContent = 'Mostrar'; }
  });
  inputPassword.addEventListener('input', () => passwordBar.style.width = `${passwordScore(inputPassword.value)}%`);

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
      empresasBox.innerHTML = (stores || []).map(s => `
        <label class="inline-flex items-center gap-2">
          <input type="checkbox" value="${s._id}" class="rounded border-gray-300">
          <span>${s.nome || 'Sem nome'}</span>
        </label>
      `).join('');
    } catch (err) {
      console.error(err);
      empresasBox.innerHTML = '<p class="text-sm text-red-600">Erro ao carregar empresas.</p>';
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
