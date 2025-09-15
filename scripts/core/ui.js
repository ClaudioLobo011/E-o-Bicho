/* ============================================================================
 * scripts/ui.js  â€”  UtilitÃ¡rios de UI do site
 * CompatÃ­vel com os componentes:
 *   - components/info-modal.html          (id=-info-modal-)
 *   - components/confirm-modal.html       (id=-confirm-modal-)
 *
 * Este arquivo expÃµe:
 *   - ensureModalReady(isConfirm: boolean) -> Promise<HTMLElement|null>
 *   - showModal({ title, message, confirmText, onConfirm, cancelText, onCancel })
 *   - showToast(message, type='info', timeout=3000)
 *   - loadIcons()  // carrega SVGs em elementos com [data-icon]
 * ========================================================================== */

(function () {
  // Base para caminhos relativos (ex.: '../' dentro de /pages)
  const BASE = (typeof window.basePath !== 'undefined') ? window.basePath : './';
  const ICON_BASE = `${BASE}public/icons/`;

  /* ------------------------------------------------------------------------
   * Helpers DOM
   * ---------------------------------------------------------------------- */
  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function noop() {}

  /* ------------------------------------------------------------------------
   * Garantir que o HTML do modal esteja no DOM
   * - Tenta pegar pelo ID
   * - Tenta dentro do placeholder correspondente
   * - Pede para o main.js injetar (loadComponents), se existir
   * - Fallback: busca o HTML do componente e injeta no placeholder
   * ---------------------------------------------------------------------- */
  async function ensureModalReady(isConfirm) {
    const id = isConfirm ? 'confirm-modal' : 'info-modal';
    let el = document.getElementById(id);
    if (el) return el;

    const phId = isConfirm ? 'confirm-modal-placeholder' : 'modal-placeholder';
    let ph = document.getElementById(phId);
    if (ph) {
      el = ph.querySelector('#' + id);
      if (el) return el;
    }

    // tenta pedir pro main.js injetar componentes
    if (typeof window.loadComponents === 'function') {
      try {
        await window.loadComponents();
        ph = document.getElementById(phId);
        if (ph) {
          el = ph.querySelector('#' + id);
          if (el) return el;
        }
      } catch (_) { /* ignora */ }
    }

    // fallback final: injeta diretamente o componente
    if (!ph) {
      ph = document.createElement('div');
      ph.id = phId;
      document.body.appendChild(ph);
    }

    const path = `${BASE}components/shared/${isConfirm ? 'confirm-modal' : 'info-modal'}.html`;
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (res.ok) {
        ph.innerHTML = await res.text();
        el = ph.querySelector('#' + id);
        if (el) return el;
      }
    } catch (_) { /* ignora */ }

    return null;
  }
  // expÃµe global para uso opcional
  window.ensureModalReady = ensureModalReady;

  /* ------------------------------------------------------------------------
   * showModal â€” modal unificado (info/confirm)
   * - Usa os componentes jÃ¡ existentes do projeto
   * - Se nÃ£o houver HTML ainda, injeta/espera; se falhar, usa alert()
   * ---------------------------------------------------------------------- */
  async function showModal({ title, message, confirmText = 'OK', onConfirm, cancelText, onCancel }) {
    const isConfirm = !!cancelText;
    const modal = await ensureModalReady(isConfirm);

    // Sem HTML disponível: fallback silencioso
    if (!modal) {
      console.warn('Modal HTML não encontrado; usando alert() como fallback.');
      if (message) alert(message);
      (onConfirm || noop)();
      return;
    }

    // INFO (um botÃ£o)
    if (!isConfirm) {
      const msgEl = qs('#info-modal-message', modal);
      const okBtn = qs('#info-modal-btn', modal) || qs('button', modal);

      if (msgEl) msgEl.textContent = message || '';
      if (okBtn) okBtn.textContent = confirmText || 'OK';

      modal.classList.remove('hidden');

      if (okBtn) {
        okBtn.onclick = () => {
          modal.classList.add('hidden');
          (onConfirm || noop)();
        };
      }
      return;
    }

    // CONFIRM (dois botÃµes)
    const titleEl   = qs('#confirm-modal-title', modal) || qs('h2', modal);
    const msgEl     = qs('#confirm-modal-message', modal);
    const btnCancel = qs('#confirm-modal-cancel-btn', modal);
    const btnOk     = qs('#confirm-modal-confirm-btn', modal);

    if (titleEl) titleEl.textContent = title || 'Atenção';
    if (msgEl)   msgEl.textContent   = message || '';
    if (btnOk)   btnOk.textContent   = confirmText || 'Confirmar';
    if (btnCancel) btnCancel.textContent = cancelText || 'Cancelar';

    modal.classList.remove('hidden');

    if (btnCancel) {
      btnCancel.onclick = () => {
        modal.classList.add('hidden');
        (onCancel || noop)();
      };
    }
    if (btnOk) {
      btnOk.onclick = () => {
        modal.classList.add('hidden');
        (onConfirm || noop)();
      };
    }
  }
  // expÃµe global
  window.showModal = showModal;

  /* ------------------------------------------------------------------------
   * Toast simples (nÃ£o depende dos modais)
   * - type: 'info' | 'success' | 'error' | 'warning'
   * ---------------------------------------------------------------------- */
  function showToast(message, type = 'info', timeout = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed top-4 right-4 z-[9999] space-y-2';
      document.body.appendChild(container);
    }

    const base =
      'px-4 py-2 rounded shadow text-sm text-white transition transform';
    const color = {
      info:    'bg-slate-700',
      success: 'bg-green-600',
      error:   'bg-red-600',
      warning: 'bg-yellow-600'
    }[type] || 'bg-slate-700';

    const el = document.createElement('div');
    el.className = `${base} ${color} opacity-0 translate-y-2`;
    el.textContent = message || '';
    container.appendChild(el);

    // animaÃ§Ã£o simples
    requestAnimationFrame(() => {
      el.classList.remove('opacity-0', 'translate-y-2');
      el.classList.add('opacity-100', 'translate-y-0');
    });

    setTimeout(() => {
      el.classList.remove('opacity-100', 'translate-y-0');
      el.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => el.remove(), 200);
    }, Math.max(1200, timeout | 0));
  }
  window.showToast = showToast;

  /* ------------------------------------------------------------------------
   * loadIcons â€” injeta SVGs em elementos com [data-icon=-nome-]
   * Busca em `${BASE}public/icons/<nome>.svg`
   * ---------------------------------------------------------------------- */
  async function loadIcons() {
    const nodes = qsa('[data-icon]');
    if (!nodes.length) return;

    const jobs = nodes.map(async (el) => {
      const iconName = (el.getAttribute('data-icon') || '').trim();
      if (!iconName) return;

      try {
        const res = await fetch(`${ICON_BASE}${iconName}.svg`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`Ícone não encontrado: ${iconName}`);
        el.innerHTML = await res.text(); try { const svg = el.querySelector('svg'); if (svg) { svg.setAttribute('width','100%'); svg.setAttribute('height','100%'); svg.style.width='100%'; svg.style.height='100%'; } } catch(_) {}
      } catch (err) {
        console.error(`Falha ao carregar o ícone: ${iconName}`, err);
        el.innerHTML = '';
      }
    });

    await Promise.all(jobs);
  }
  window.loadIcons = loadIcons;

  /* ------------------------------------------------------------------------
   * Logout unificado
   * - Limpa todas as possÃ­veis chaves de sessÃ£o usadas no site
   * - Redireciona (por padrÃ£o) para a pÃ¡gina de login, respeitando basePath
   * ---------------------------------------------------------------------- */
  function clearSession() {
    try { localStorage.removeItem('auth_token'); } catch(_) {}
    try { localStorage.removeItem('user'); } catch(_) {}
    try { localStorage.removeItem('loggedInUser'); } catch(_) {}
  }

  function doRedirect(url) {
    try { window.location.href = url; } catch(_) { /* ignore */ }
  }

  window.logout = function(opts = {}) {
    const redirect = opts.redirect || `${BASE}pages/login.html`;
    clearSession();
    doRedirect(redirect);
  };

  /* ------------------------------------------------------------------------
   * Fechar modais com ESC (se estiverem visÃ­veis)
   * ---------------------------------------------------------------------- */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const confirmModal = document.getElementById('confirm-modal');
    const infoModal = document.getElementById('info-modal');
    let closed = false;

    if (confirmModal && !confirmModal.classList.contains('hidden')) {
      confirmModal.classList.add('hidden');
      closed = true;
    }
    if (!closed && infoModal && !infoModal.classList.contains('hidden')) {
      infoModal.classList.add('hidden');
    }
  });

  // Alterna visÃµes logado/deslogado pela presenÃ§a de token/usuÃ¡rio
  // Unifica as chaves usadas no projeto: 'auth_token' | 'user' | 'loggedInUser'
  function syncUserViews() {
    let isLogged = false;
    try {
      const token = localStorage.getItem('auth_token');
      const user  = localStorage.getItem('user');
      // Suporta o cache usado pelo main.js/hydrate-user
      const cachedStr = localStorage.getItem('loggedInUser');
      let cached = null;
      try { cached = cachedStr ? JSON.parse(cachedStr) : null; } catch(_) { /* ignore */ }

      // Considera logado se existir qualquer um dos indicadores
      isLogged = !!(
        token ||
        user  ||
        (cached && (cached.token || cached.nome || cached.email))
      );
    } catch(_) {
      // fallback defensivo
      try { isLogged = !!localStorage.getItem('loggedInUser'); } catch(_) {}
    }

    document.querySelectorAll('.user-logged-in-view')
      .forEach(el => {
        el.classList.toggle('hidden', !isLogged);
        el.style.display = !isLogged ? 'none' : '';
        el.setAttribute('aria-hidden', String(!isLogged));
      });
    document.querySelectorAll('.user-logged-out-view')
      .forEach(el => {
        el.classList.toggle('hidden', isLogged);
        el.style.display = isLogged ? 'none' : '';
        el.setAttribute('aria-hidden', String(isLogged));
      });
    // painÃ©is associados (se existirem)
    const outPanel = document.getElementById('user-logged-out-panel');
    if (outPanel) {
      if (isLogged) { outPanel.classList.add('hidden'); outPanel.style.display = 'none'; }
      else { outPanel.classList.remove('hidden'); outPanel.style.display = ''; }
    }
  }

  // Menu do usuÃ¡rio (abre no clique; hover jÃ¡ funciona via CSS)
  function initUserMenu() {
    const wrap  = document.getElementById('user-menu-wrapper');
    const btn   = document.getElementById('user-logged-in-view') || document.getElementById('user-menu-trigger');
    const panel = document.getElementById('user-menu-panel');
    if (!wrap || !btn || !panel) return;

    const open = () => { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); };
    const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };

    btn.addEventListener('click', (e) => { e.preventDefault(); wrap.classList.contains('open') ? close() : open(); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // DelegaÃ§Ã£o global do logout (Sidebar, Admin etc.)
  // Evita interferir no botÃ£o do header (#logout-btn) que jÃ¡ possui confirm.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('#admin-logout-btn, [data-logout]');
    if (!el) return;
    e.preventDefault();
    if (typeof window.logout === 'function') {
      window.logout();
    } else {
      clearSession();
      doRedirect('/pages/login.html');
    }
  });

  // Rodar nos momentos certos
  document.addEventListener('DOMContentLoaded', () => { initUserMenu(); syncUserViews(); });
  document.addEventListener('components:ready', () => { initUserMenu(); syncUserViews(); });
  // Atualiza se outro tab fizer login/logout
  window.addEventListener('storage', (e) => { if (['auth_token','user','loggedInUser'].includes(e.key)) syncUserViews(); });


})();

