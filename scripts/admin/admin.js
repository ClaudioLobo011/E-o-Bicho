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

      const updateEmbeddedModalState = () => {
        const modals = document.querySelectorAll('[data-admin-modal]');
        const hasOpenModal = Array.from(modals).some((modal) => {
          if (!(modal instanceof HTMLElement)) {
            return false;
          }

          if (modal.classList.contains('hidden')) {
            return false;
          }

          const style = window.getComputedStyle(modal);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
          }

          return true;
        });

        document.body.classList.toggle('admin-modal-open', hasOpenModal);
      };

      const modalObserver = new MutationObserver((mutations) => {
        let shouldCheck = false;

        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (
              mutation.target instanceof HTMLElement &&
              mutation.target.hasAttribute('data-admin-modal')
            ) {
              shouldCheck = true;
              break;
            }
          } else if (mutation.type === 'childList') {
            const inspectNodes = (nodes) => {
              for (const node of nodes) {
                if (!(node instanceof HTMLElement)) {
                  continue;
                }

                if (node.matches('[data-admin-modal]')) {
                  shouldCheck = true;
                  return true;
                }

                if (node.querySelector('[data-admin-modal]')) {
                  shouldCheck = true;
                  return true;
                }
              }

              return false;
            };

            if (inspectNodes(mutation.addedNodes) || inspectNodes(mutation.removedNodes)) {
              break;
            }
          }
        }

        if (shouldCheck) {
          updateEmbeddedModalState();
        }
      });

      modalObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
      });

      window.addEventListener('beforeunload', () => modalObserver.disconnect(), { once: true });

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

        const mainGrid = document.querySelector('main > .grid');
        if (mainGrid) {
          mainGrid.classList.add('admin-embedded-grid');
        }

        const mainElement = document.querySelector('main');
        if (mainElement) {
          mainElement.classList.remove('container', 'mx-auto', 'px-4', 'py-8', 'min-h-screen');
          mainElement.classList.add('admin-embedded-main');
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', adjustLayout, { once: true });
      } else {
        adjustLayout();
      }

      updateEmbeddedModalState();
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
