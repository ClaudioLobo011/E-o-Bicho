// Guarda de acesso: permite funcionario, admin e admin_master.
// Esconde o conteúdo até validar o papel do usuário.
(async function () {
  try {
    document.body.style.visibility = 'hidden';

    const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    const token = cached?.token;

    if (!token) {
      console.error('[Funcionários] Token não encontrado no cache local.');
      alert('Você precisa estar logado para acessar o painel de Funcionários.');
      window.location.replace('/pages/login.html');
      return;
    }

    const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/check`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!resp.ok) {
      console.error('[Funcionários] Sessão inválida ou expirada. Resposta:', resp.status);
      alert('Sessão inválida ou expirada. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return;
    }

    const data = await resp.json();
    const role = data?.role || cached?.role;

    // Apenas funcionario, admin e admin_master entram.
    if (!['funcionario', 'admin', 'admin_master'].includes(role)) {
      console.error('[Funcionários] Acesso negado para o papel:', role);
      alert('Acesso restrito aos Funcionários.');
      window.location.replace('/index.html');
      return;
    }

    // Atualiza o cache local com o role confirmado (sem perder outras infos)
    if (cached && role && cached.role !== role) {
      localStorage.setItem('loggedInUser', JSON.stringify({ ...cached, role }));
    }

    console.log('[Funcionários] Acesso validado com sucesso para o papel:', role);

    // Conteúdo liberado
    document.body.style.visibility = 'visible';
  } catch (err) {
    console.error('[Funcionários] Erro ao validar acesso:', err);
    alert('Não foi possível validar sua sessão.');
    window.location.replace('/pages/login.html');
  }
})();