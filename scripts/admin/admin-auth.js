export async function ensureAdminAccess() {
  document.body.style.visibility = 'hidden';

  try {
    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    const token = loggedInUser?.token;

    if (!loggedInUser || !token) {
      alert('Você precisa estar logado para acessar o painel interno.');
      window.location.replace('/pages/login.html');
      return;
    }

    const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/check`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      alert('Sessão expirada. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return;
    }

    const data = await resp.json();
    const role = data?.role;
    const allowed = ['funcionario', 'admin', 'admin_master'].includes(role);

    if (!allowed) {
      alert('Acesso negado. Esta área é restrita a colaboradores autorizados.');
      window.location.replace('/pages/login.html');
      return;
    }

    document.body.style.visibility = 'visible';
  } catch (err) {
    console.error('Erro ao verificar permissões:', err);
    alert('Erro ao verificar permissões. Faça login novamente.');
    window.location.replace('/pages/login.html');
  }
}
