document.addEventListener('DOMContentLoaded', () => {
  const cardsWrap = document.getElementById('cargo-users-cards');
  const emptyState = document.getElementById('cargo-users-empty');
  const addButton = document.getElementById('cargo-add-btn');
  const countLabel = document.getElementById('cargo-users-count');

  const modal = document.getElementById('cargo-modal');
  const modalCard = document.querySelector('[data-cargo-modal-card]');
  const modalClose = document.getElementById('cargo-modal-close');
  const modalCancel = document.getElementById('cargo-modal-cancel');
  const modalSave = document.getElementById('cargo-modal-save');
  const roleSelect = document.getElementById('cargo-role-select');
  const companiesWrap = document.getElementById('cargo-companies');
  const companiesFeedback = document.getElementById('cargo-companies-feedback');
  const userName = document.getElementById('cargo-user-name');
  const userEmail = document.getElementById('cargo-user-email');
  const userRole = document.getElementById('cargo-user-role');
  const removeModal = document.getElementById('cargo-remove-modal');
  const removeModalCard = document.querySelector('[data-remove-modal-card]');
  const removeModalClose = document.getElementById('cargo-remove-close');
  const removeModalCancel = document.getElementById('cargo-remove-cancel');
  const removeModalFuncionario = document.getElementById('cargo-remove-funcionario');
  const removeModalCliente = document.getElementById('cargo-remove-cliente');
  const removeUserLabel = document.getElementById('cargo-remove-user');

  if (!cardsWrap) return;

  const API = {
    list: `${API_CONFIG.BASE_URL}/admin/funcionarios`,
    transform: `${API_CONFIG.BASE_URL}/admin/funcionarios/transformar`,
    storesAllowed: `${API_CONFIG.BASE_URL}/stores/allowed`,
    remove: (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
  };

  const ROLE_LABEL = {
    funcionario: 'Funcionario',
    franqueado: 'Franqueado',
    franqueador: 'Franqueador',
    admin: 'Administrador',
    admin_master: 'Admin Master',
  };
  const DISPLAY_ROLES = new Set(['franqueado', 'franqueador']);
  const SELECTABLE_ROLES = new Set(['funcionario', 'franqueado', 'franqueador']);

  let allowedStores = [];
  let allowedStoreMap = new Map();
  let users = [];
  let activeUser = null;
  let removeTarget = null;
  let storesLoaded = false;

  const getToken = () => {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  };

  const headers = () => {
    const token = getToken();
    const base = { 'Content-Type': 'application/json' };
    if (token) base.Authorization = `Bearer ${token}`;
    return base;
  };

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type, 2400);
    }
  };

  const getUserName = (user) =>
    (user?.nome || user?.nomeCompleto || user?.nomeContato || user?.razaoSocial || '').trim();

  const getUserLabel = (user) => {
    const name = getUserName(user) || '-';
    const email = (user?.email || '').trim();
    return email ? `${name} - ${email}` : name;
  };

  const buildStoreMap = (stores) => {
    allowedStoreMap = new Map();
    (stores || []).forEach((store) => {
      const id = store?._id || store?.id;
      if (id) allowedStoreMap.set(id, store);
    });
  };

  const getStoreLabel = (id) => {
    if (!id) return '';
    const store = allowedStoreMap.get(id);
    const label = store?.nome || store?.razaoSocial || store?.nomeFantasia || store?.fantasia || store?.label;
    return (label || id || '').trim();
  };

  const getUserCompanyNames = (user) => {
    const list = Array.isArray(user?.empresas) ? user.empresas : [];
    const names = [];
    const seen = new Set();
    list.forEach((item) => {
      const id = typeof item === 'string' ? item : (item?._id || item?.id || '');
      if (!id) return;
      const label = getStoreLabel(id);
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(label);
    });
    return names;
  };

  const setCountLabel = (count) => {
    if (!countLabel) return;
    const safe = Number.isFinite(count) ? count : 0;
    countLabel.textContent = `${safe} franqueados/franqueadores encontrados`;
  };

  const renderCards = (list) => {
    if (!cardsWrap) return;
    if (!Array.isArray(list) || list.length === 0) {
      cardsWrap.innerHTML = '';
      emptyState?.classList.remove('hidden');
      setCountLabel(0);
      return;
    }

    emptyState?.classList.add('hidden');

    const cards = list.map((user) => {
      const name = getUserName(user) || '-';
      const email = (user?.email || '-').trim();
      const roleLabel = ROLE_LABEL[user?.role] || user?.role || '-';
      const companies = getUserCompanyNames(user);
      const companiesTags = companies.length
        ? companies.map((name) => (
          `<span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600">${name}</span>`
        )).join('')
        : '<span class="text-xs text-gray-400">Sem empresas</span>';

      return `
        <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-gray-800">${name}</p>
              <p class="text-xs text-gray-500">${email}</p>
            </div>
            <span class="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700">${roleLabel}</span>
          </div>
          <div class="mt-3 text-xs text-gray-600">
            <p class="text-[11px] uppercase tracking-wide text-gray-400">Empresas</p>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              ${companiesTags}
              <button data-action="add-company" data-id="${user?._id || ''}" class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 text-[10px] text-gray-500 transition hover:border-emerald-200 hover:text-emerald-600" aria-label="Adicionar empresa" title="Adicionar empresa">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
          <div class="mt-4 flex justify-end">
            <div class="flex items-center gap-2">
              <button data-action="edit" data-id="${user?._id || ''}" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50">
                <i class="fa-solid fa-pen"></i>
                Editar
              </button>
              <button data-action="remove" data-id="${user?._id || ''}" class="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50">
                <i class="fa-solid fa-trash"></i>
                Remover
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    cardsWrap.innerHTML = cards;
    setCountLabel(list.length);
  };

  const openAddSelector = () => {
    const selectable = Array.isArray(users)
      ? users.filter((user) => SELECTABLE_ROLES.has(user?.role) && !DISPLAY_ROLES.has(user?.role))
      : [];
    if (selectable.length === 0) {
      notify('Nenhum funcionario encontrado.', 'warning');
      return;
    }

    if (typeof window.showModal !== 'function') {
      notify('Modal indisponivel no momento.', 'error');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'space-y-3';

    const label = document.createElement('label');
    label.className = 'block text-sm font-semibold text-gray-700';
    label.textContent = 'Selecione o funcionario';

    const select = document.createElement('select');
    select.className = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';

    const options = selectable
      .slice()
      .sort((a, b) => getUserLabel(a).localeCompare(getUserLabel(b)))
      .map((user) => {
        const option = document.createElement('option');
        option.value = user?._id || '';
        option.textContent = getUserLabel(user);
        return option;
      });

    options.forEach((option) => select.appendChild(option));
    if (options.length) {
      select.value = options[0].value;
    }

    const error = document.createElement('p');
    error.className = 'hidden text-xs text-red-600';
    error.textContent = 'Selecione um funcionario valido.';

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapper.appendChild(error);

    window.showModal({
      title: 'Adicionar funcionario',
      message: wrapper,
      confirmText: 'Continuar',
      cancelText: 'Cancelar',
      onConfirm: () => {
        const selectedId = select.value;
        const selectedUser = selectable.find((item) => item?._id === selectedId);
        if (!selectedUser) {
          error.classList.remove('hidden');
          return false;
        }
        openModalForUser(selectedUser);
        return true;
      },
    });
  };

  const getSelectedCompanies = () => {
    if (!companiesWrap) return [];
    return Array.from(companiesWrap.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.value)
      .filter(Boolean);
  };

  const renderCompanies = (user) => {
    if (!companiesWrap) return;
    if (!Array.isArray(allowedStores) || allowedStores.length === 0) {
      companiesWrap.innerHTML = '<p class="text-xs text-gray-500">Nenhuma empresa vinculada.</p>';
      if (companiesFeedback) companiesFeedback.textContent = 'Nenhuma empresa vinculada ao seu usuario.';
      return;
    }

    const selected = new Set();
    const current = Array.isArray(user?.empresas) ? user.empresas : [];
    current.forEach((item) => {
      const id = typeof item === 'string' ? item : (item?._id || item?.id || '');
      if (id) selected.add(id);
    });

    companiesWrap.innerHTML = allowedStores.map((store) => {
      const id = store?._id || store?.id || '';
      const label = store?.nome || store?.razaoSocial || store?.nomeFantasia || store?.fantasia || 'Empresa sem nome';
      const checked = selected.has(id) ? 'checked' : '';
      return `
        <label class="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
          <input type="checkbox" value="${id}" class="rounded border-gray-300" ${checked} />
          <span>${label}</span>
        </label>
      `;
    }).join('');

    if (companiesFeedback) companiesFeedback.textContent = 'Selecione uma ou mais empresas.';
  };

  const showModal = () => {
    if (!modal) return;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      modalCard?.classList.remove('opacity-0', 'scale-95');
      modalCard?.classList.add('opacity-100', 'scale-100');
    });
  };

  const hideModal = () => {
    if (!modal) return;
    modalCard?.classList.add('opacity-0', 'scale-95');
    modalCard?.classList.remove('opacity-100', 'scale-100');
    setTimeout(() => {
      modal.classList.add('hidden');
    }, 150);
  };

  const showRemoveModal = () => {
    if (!removeModal) return;
    removeModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      removeModalCard?.classList.remove('opacity-0', 'scale-95');
      removeModalCard?.classList.add('opacity-100', 'scale-100');
    });
  };

  const hideRemoveModal = () => {
    if (!removeModal) return;
    removeModalCard?.classList.add('opacity-0', 'scale-95');
    removeModalCard?.classList.remove('opacity-100', 'scale-100');
    setTimeout(() => {
      removeModal.classList.add('hidden');
    }, 150);
  };

  const openModalForUser = (user) => {
    activeUser = user;
    if (userName) userName.textContent = getUserName(user) || '-';
    if (userEmail) userEmail.textContent = user?.email || '-';
    if (userRole) userRole.textContent = `Cargo atual: ${ROLE_LABEL[user?.role] || user?.role || '-'}`;
    if (roleSelect) {
      const targetRole = user?.role === 'franqueador' ? 'franqueador' : 'franqueado';
      roleSelect.value = targetRole;
    }
    renderCompanies(user);
    showModal();
  };

  const closeModal = () => {
    activeUser = null;
    hideModal();
  };

  const openRemoveModalForUser = (user) => {
    removeTarget = user;
    if (removeUserLabel) {
      const name = getUserName(user) || '-';
      const email = user?.email ? ` (${user.email})` : '';
      removeUserLabel.textContent = `${name}${email}`;
    }
    showRemoveModal();
  };

  const closeRemoveModal = () => {
    removeTarget = null;
    hideRemoveModal();
  };

  const setSaveState = (isSaving) => {
    if (!modalSave) return;
    modalSave.disabled = isSaving;
    modalSave.classList.toggle('opacity-60', isSaving);
    modalSave.classList.toggle('cursor-not-allowed', isSaving);
  };

  const setRemoveState = (isSaving) => {
    [removeModalFuncionario, removeModalCliente].forEach((btn) => {
      if (!btn) return;
      btn.disabled = isSaving;
      btn.classList.toggle('opacity-60', isSaving);
      btn.classList.toggle('cursor-not-allowed', isSaving);
    });
  };

  const saveChanges = async () => {
    if (!activeUser) return;
    if (!storesLoaded) {
      notify('Nao foi possivel carregar empresas.', 'error');
      return;
    }
    const role = roleSelect?.value || 'franqueado';
    const empresas = getSelectedCompanies();

    setSaveState(true);
    try {
      const payload = {
        userId: activeUser._id,
        role,
        empresas,
        replaceEmpresas: true,
      };
      const res = await fetch(API.transform, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || 'Falha ao salvar cargo.');
      }
      notify('Configuracao salva.', 'success');
      closeModal();
      await loadUsers();
    } catch (err) {
      console.error(err);
      notify(err.message || 'Nao foi possivel salvar.', 'error');
    } finally {
      setSaveState(false);
    }
  };

  const setUserFuncionario = async (user) => {
    if (!user?._id) return;
    try {
      const res = await fetch(API.transform, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ userId: user._id, role: 'funcionario' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || 'Falha ao remover.');
      }
      notify('Usuario voltou para funcionario.', 'success');
      await loadUsers();
      return true;
    } catch (err) {
      console.error(err);
      notify(err.message || 'Nao foi possivel remover.', 'error');
      return false;
    }
  };

  const removeToCliente = async (user) => {
    if (!user?._id) return false;
    try {
      const res = await fetch(API.remove(user._id), { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || 'Falha ao remover.');
      }
      notify('Usuario removido do quadro.', 'success');
      await loadUsers();
      return true;
    } catch (err) {
      console.error(err);
      notify(err.message || 'Nao foi possivel remover.', 'error');
      return false;
    }
  };

  const loadAllowedStores = async () => {
    try {
      const res = await fetch(API.storesAllowed, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Falha ao carregar empresas.');
      const stores = Array.isArray(data?.stores) ? data.stores : (Array.isArray(data) ? data : []);
      allowedStores = Array.isArray(stores) ? stores : [];
      buildStoreMap(allowedStores);
      storesLoaded = true;
    } catch (err) {
      console.error(err);
      allowedStores = [];
      buildStoreMap([]);
      storesLoaded = false;
    }
  };

  const loadUsers = async () => {
    cardsWrap.innerHTML = '<div class="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">Carregando...</div>';
    try {
      const res = await fetch(API.list, { headers: headers() });
      const data = await res.json().catch(() => ([]));
      if (!res.ok) throw new Error(data?.message || 'Falha ao carregar funcionarios.');
      const list = Array.isArray(data) ? data : [];
      users = list.filter((user) => SELECTABLE_ROLES.has(user?.role));
      const visible = users.filter((user) => DISPLAY_ROLES.has(user?.role));
      renderCards(visible);
    } catch (err) {
      console.error(err);
      users = [];
      cardsWrap.innerHTML = '';
      emptyState?.classList.remove('hidden');
      setCountLabel(0);
      notify('Nao foi possivel carregar os funcionarios.', 'error');
    }
  };

  addButton?.addEventListener('click', openAddSelector);

  cardsWrap.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const id = button.getAttribute('data-id');
    const user = users.find((item) => item?._id === id);
    if (!user) return;

    if (action === 'remove') {
      openRemoveModalForUser(user);
      return;
    }

    if (action === 'edit' || action === 'add-company') {
      openModalForUser(user);
    }
  });

  modal?.addEventListener('click', (event) => {
    const shouldClose = event.target === modal || event.target.hasAttribute('data-close-modal');
    if (shouldClose) closeModal();
  });

  removeModal?.addEventListener('click', (event) => {
    const shouldClose = event.target === removeModal || event.target.hasAttribute('data-remove-close');
    if (shouldClose) closeRemoveModal();
  });

  modalClose?.addEventListener('click', closeModal);
  modalCancel?.addEventListener('click', closeModal);
  modalSave?.addEventListener('click', saveChanges);
  removeModalClose?.addEventListener('click', closeRemoveModal);
  removeModalCancel?.addEventListener('click', closeRemoveModal);

  removeModalFuncionario?.addEventListener('click', async () => {
    if (!removeTarget) return;
    setRemoveState(true);
    const ok = await setUserFuncionario(removeTarget);
    setRemoveState(false);
    if (ok) closeRemoveModal();
  });

  removeModalCliente?.addEventListener('click', async () => {
    if (!removeTarget) return;
    setRemoveState(true);
    const ok = await removeToCliente(removeTarget);
    setRemoveState(false);
    if (ok) closeRemoveModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeModal();
    }
    if (event.key === 'Escape' && removeModal && !removeModal.classList.contains('hidden')) {
      closeRemoveModal();
    }
  });

  (async () => {
    await loadAllowedStores();
    await loadUsers();
  })();
});
