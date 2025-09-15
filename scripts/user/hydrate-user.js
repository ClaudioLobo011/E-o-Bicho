// scripts/user/hydrate-user.js
(function () {
  // Extrai um "primeiro nome" amigável para saudação
  function firstNameFrom(str) {
    if (!str || typeof str !== 'string') return '';
    const clean = str.trim();
    if (!clean) return '';
    // pega a primeira palavra não vazia
    return clean.split(/\s+/)[0];
  }

  // Deriva o nome de exibição a partir do objeto de usuário (PF ou PJ)
  function getDisplayName(u) {
    if (!u) return '';
    const nome =
      (u.nome && String(u.nome).trim()) ||
      (u.nomeCompleto && String(u.nomeCompleto).trim()) ||
      (u.nomeContato && String(u.nomeContato).trim()) ||
      (u.razaoSocial && String(u.razaoSocial).trim()) ||
      '';
    if (nome) return firstNameFrom(nome);
    if (u.email && typeof u.email === 'string') {
      return firstNameFrom(u.email.split('@')[0]);
    }
    return '';
  }

  async function fetchCurrentUser() {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      const token = cached?.token;
      if (!token) return { user: null, cached };

      const resp = await fetch(`${API_CONFIG.BASE_URL}/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return { user: null, cached };

      const user = await resp.json();
      // Atualiza cache com role/nome se não existirem
      const next = { ...cached };
      if (user?.role) next.role = user.role;
      if (user?.nome) next.nome = user.nome;
      localStorage.setItem('loggedInUser', JSON.stringify(next));

      return { user, cached: next };
    } catch (e) {
      console.error('hydrate-user: fetchCurrentUser error', e);
      return { user: null, cached: null };
    }
  }

  async function hydrateUserUI() {
    const { user, cached } = await fetchCurrentUser();

    // decide o nome a exibir (prioriza do backend)
    const display =
      getDisplayName(user) ||
      getDisplayName(cached) ||
      'Cliente';

    // Preenche todos os lugares com data-user-name
    document.querySelectorAll('[data-user-name]').forEach((el) => {
      el.textContent = display;
    });

    // IDs comuns (caso prefira usar IDs fixos também)
    const topbar = document.getElementById('topbar-user-name');
    if (topbar) topbar.textContent = display;

    const sidebar = document.getElementById('sidebar-user-name');
    if (sidebar) sidebar.textContent = display;
  }

  // Executa após DOM pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateUserUI);
  } else {
    hydrateUserUI();
  }
  document.addEventListener('components:ready', hydrateUserUI);

})();
