// scripts/admin/admin.js
async function checkAdminAccess() {
  // Esconde conteúdo até validar
  document.body.style.visibility = 'hidden';

  try {
    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    const token = loggedInUser?.token;

    // Sem login -> login
    if (!loggedInUser || !token) {
      alert('Você precisa estar logado para acessar o painel interno.');
      window.location.replace('/pages/login.html');
      return;
    }

    // Valida token e obtém role
    const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/check`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      // token inválido/expirado
      alert('Sessão expirada. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return;
    }

    const data = await resp.json();
    const role = data?.role;

    // Libera funcionários, admin e admin_master
    const allowed = ['funcionario', 'admin', 'admin_master'].includes(role);
    if (!allowed) {
      alert('Acesso negado. Esta área é restrita a colaboradores autorizados.');
      // se quiser mandar para home em vez do login, troque a URL abaixo
      window.location.replace('/pages/login.html');
      return;
    }

    // Ok, mostra a página
    const params = new URLSearchParams(window.location.search);
    const isEmbedded = params.get('embedded') === '1' || window.top !== window;

    if (isEmbedded) {
      document.body.classList.add('admin-embedded');

      const adjustLayout = () => {
        const headerPlaceholder = document.getElementById('admin-header-placeholder');
        if (headerPlaceholder) {
          headerPlaceholder.remove();
        }

        const footerPlaceholder = document.getElementById('admin-footer-placeholder');
        if (footerPlaceholder) {
          footerPlaceholder.remove();
        }

        const sidebarPlaceholder = document.getElementById('admin-sidebar-placeholder');
        if (sidebarPlaceholder) {
          const aside = sidebarPlaceholder.closest('aside');
          if (aside) {
            aside.remove();
          } else {
            sidebarPlaceholder.remove();
          }
        }

        const mainElement = document.querySelector('main');
        if (mainElement) {
          mainElement.classList.remove('container', 'mx-auto', 'px-4', 'py-8', 'min-h-screen');
          mainElement.classList.add('admin-embedded-main');
          // Tornar grid mais compacta no embed
          const mainGrid = document.querySelector('main > .grid');
          if (mainGrid) mainGrid.classList.add('admin-embedded-grid');

          // Remover aparência de card das seções de primeiro nível
          const contentCol = document.querySelector('main .md\\:col-span-4');
          if (contentCol) {
            contentCol.classList.remove('space-y-4');
            contentCol.classList.add('space-y-0');

            contentCol.querySelectorAll(':scope > section').forEach((sec) => {
              [
                'bg-white','bg-gray-50',
                'border','border-gray-100','border-gray-200',
                'rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl',
                'shadow','shadow-sm','shadow-md','shadow-lg',
                'p-3','p-4','p-5','p-6','p-8'
              ].forEach(cls => sec.classList.remove(cls));

              sec.classList.add('p-0'); // conteúdo fluido
            });
          }
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', adjustLayout, { once: true });
      } else {
        adjustLayout();
      }
    }

    document.body.style.visibility = 'visible';
  } catch (err) {
    console.error('Erro ao verificar permissões:', err);
    alert('Erro ao verificar permissões. Faça login novamente.');
    window.location.replace('/pages/login.html');
  }
}

// Garante que o body não pisca antes da validação
document.body.style.visibility = 'hidden';

// Aguarda config.js estar carregado
if (typeof API_CONFIG !== 'undefined') {
  checkAdminAccess();
} else {
  console.error('API_CONFIG não definido. Garanta que config.js é carregado antes de admin.js');
  // mesmo assim tenta validar após um pequeno delay
  setTimeout(checkAdminAccess, 100);
}
