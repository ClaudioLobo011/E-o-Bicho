var basePath = basePath || '';

async function loadComponents() {
    try {
        const placeholders = {
            'header-placeholder': `${basePath}components/shared/header.html`,
            'admin-header-placeholder': `${basePath}components/admin/header.html`,
            'footer-placeholder': `${basePath}components/shared/footer.html`,
            'admin-footer-placeholder': `${basePath}components/admin/footer.html`,
            'cart-placeholder': `${basePath}components/shared/cart.html`,
            'modal-placeholder': `${basePath}components/shared/info-modal.html`,
            'confirm-modal-placeholder': `${basePath}components/shared/confirm-modal.html`,
            'admin-sidebar-placeholder': `${basePath}components/admin/sidebar.html`,
            'account-sidebar-placeholder': `${basePath}components/account/account-sidebar.html`,
            'func-header-placeholder': `${basePath}components/funcionarios/header.html`,
            'func-sidebar-placeholder': `${basePath}components/funcionarios/sidebar.html`,
            'func-footer-placeholder': `${basePath}components/funcionarios/footer.html`,
            'nossas-lojas-sidebar-placeholder': `${basePath}components/store/nossas-lojas-sidebar.html`
        };
        for (const id in placeholders) {
            const element = document.getElementById(id);
            if (element) {
                const response = await fetch(placeholders[id]);
                if (!response.ok) throw new Error(`Falha ao carregar ${placeholders[id]}`);
                element.innerHTML = await response.text();
                if (id === 'account-sidebar-placeholder') {
                    updateActiveAccountLink();
                    checkAdminLink();
                }

                if (id === 'header-placeholder') {
                    initializeHeaderScripts();
                    try { initializeHeaderSearch(); } catch(_) {}
                    checkLoginState();
                    initializeHideOnScroll();
                    initializeFlyoutMenu();
                    checkAdminLink();
                    setupSiteMainSpacing();
                }

                if (id === 'admin-header-placeholder') {
                    try { initializeAdminHeaderSearch(); } catch(_) {}
                }

                if (id === 'cart-placeholder') {
                    initializeCart(); // A função agora é chamada aqui!
                }
                
                if (id === 'admin-sidebar-placeholder') {
                    updateActiveAdminLink();
                    try { initAdminSidebar(); } catch(_) {}
                }

                if (id === 'func-sidebar-placeholder') {
                    updateActiveFuncionariosLink();
                    try { initFuncionarioVetHoverMenu(); } catch(_) {}
                }
            }
        }
    } catch (error) {
        console.error("Erro ao carregar os componentes:", error);
    }
}

function updateActiveAccountLink() {
  const wrapper = document.getElementById('account-sidebar-placeholder');
  if (!wrapper) return;

  const navLinks = wrapper.querySelectorAll('nav a[href]');
  if (!navLinks.length) return;

  const inactiveClasses = ['text-gray-600', 'hover:bg-gray-100'];
  const activeClasses   = ['bg-primary/10', 'text-primary', 'font-semibold'];

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    const url = new URL(href, window.location.origin);
    const isActive = window.location.pathname.endsWith(url.pathname);

    if (isActive) {
      link.classList.remove(...inactiveClasses);
      link.classList.add(...activeClasses);
      link.classList.remove('hover:bg-gray-100');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove(...activeClasses);
      link.classList.add(...inactiveClasses);
      link.removeAttribute('aria-current');
    }
  });
}
window.loadComponents = loadComponents;

function updateActiveAdminLink() {
    const wrapper = document.getElementById('admin-sidebar-placeholder');
    if (!wrapper) return;

    const panel = wrapper.querySelector('[data-admin-sidebar-panel]');
    if (!panel) return;

    const inactiveClasses = ['text-gray-600', 'hover:bg-gray-50'];
    const activeClasses   = ['bg-primary/10', 'text-primary', 'font-semibold'];

    const navLinks = panel.querySelectorAll('nav a[href]');
    let activeLink = null;

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href === '#') {
        link.classList.remove(...activeClasses);
        link.classList.add('text-gray-600');
        link.removeAttribute('aria-current');
        return;
      }

      const url = new URL(href, window.location.origin);
      const isActive = window.location.pathname.endsWith(url.pathname);

      if (isActive) {
        activeLink = link;
        link.classList.remove(...inactiveClasses);
        link.classList.add(...activeClasses);
        link.classList.remove('hover:bg-gray-50');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove(...activeClasses);
        link.classList.add(...inactiveClasses);
        link.removeAttribute('aria-current');
      }
    });

    if (!activeLink) return;

    let parentContent = activeLink.closest('[data-accordion-content]');
    while (parentContent) {
      parentContent.classList.remove('hidden');
      parentContent.dataset.open = 'true';

      const toggle = parentContent.previousElementSibling;
      if (toggle && toggle.hasAttribute('data-accordion-button')) {
        toggle.setAttribute('aria-expanded', 'true');
        const chevron = toggle.querySelector('[data-chevron]');
        if (chevron) chevron.classList.add('rotate-180');
      }

      parentContent = toggle ? toggle.closest('[data-accordion-content]') : null;
    }
}

function initAdminSidebar() {
  const wrapper = document.getElementById('admin-sidebar-placeholder');
  if (!wrapper) return;

  const panel = wrapper.querySelector('[data-admin-sidebar-panel]');
  if (!panel) return;

  const overlay = wrapper.querySelector('[data-admin-sidebar-overlay]');
  const toggleButtons = document.querySelectorAll('[data-admin-sidebar-trigger]');
  const closeButtons = wrapper.querySelectorAll('[data-admin-sidebar-close]');

  const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

  const openSidebar = () => {
    panel.classList.add('translate-x-0');
    panel.classList.remove('-translate-x-full');
    panel.setAttribute('aria-hidden', 'false');
    if (overlay) {
      if (!isDesktop()) {
        overlay.classList.remove('pointer-events-none');
        overlay.classList.add('opacity-100');
      }
    }
    if (!isDesktop()) {
      document.body.classList.add('overflow-hidden');
    }
  };

  const closeSidebar = () => {
    panel.classList.remove('translate-x-0');
    panel.classList.add('-translate-x-full');
    panel.setAttribute('aria-hidden', 'true');
    if (overlay) {
      overlay.classList.add('pointer-events-none');
      overlay.classList.remove('opacity-100');
    }
    document.body.classList.remove('overflow-hidden');
  };

  toggleButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (panel.classList.contains('-translate-x-full')) {
        openSidebar();
      } else {
        closeSidebar();
      }
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      closeSidebar();
    });
  });

  overlay?.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSidebar();
    }
  });

  const accordionButtons = wrapper.querySelectorAll('[data-accordion-button]');
  accordionButtons.forEach(button => {
    const content = button.nextElementSibling;
    if (!content || !content.hasAttribute('data-accordion-content')) return;

    const chevron = button.querySelector('[data-chevron]');

    const setOpenState = (isOpen) => {
      if (isOpen) {
        content.classList.remove('hidden');
        content.dataset.open = 'true';
        button.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.classList.add('rotate-180');
      } else {
        content.classList.add('hidden');
        content.dataset.open = 'false';
        button.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    };

    const shouldOpen = button.dataset.defaultOpen === 'true' || content.dataset.open === 'true' || !content.classList.contains('hidden');
    setOpenState(shouldOpen);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      const currentlyOpen = button.getAttribute('aria-expanded') === 'true';
      setOpenState(!currentlyOpen);
    });
  });

  panel.querySelectorAll('a[href="#"]').forEach(link => {
    link.addEventListener('click', (event) => event.preventDefault());
  });
}

function initFuncionarioVetHoverMenu() {
  const wrap = document.getElementById('func-sidebar-placeholder');
  if (!wrap) return;

  const trigger = wrap.querySelector('#func-vet-hover');
  if (!trigger) return;

  // Itens do menu
  const ITEMS = [
    { label: 'Ficha Clínica', icon: 'fas fa-notes-medical', href: '/pages/funcionarios/vet-ficha-clinica.html', status: 'Em breve' },
    { label: 'Documentos',    icon: 'fas fa-file-medical', href: '/pages/funcionarios/vet-documentos.html',    status: '' },
    { label: 'Receitas',      icon: 'fas fa-prescription-bottle-medical', href: '/pages/funcionarios/vet-receitas.html', status: '' },
    { label: 'Assinatura',    icon: 'fas fa-signature',     href: '/pages/funcionarios/vet-assinatura.html',   status: 'Em breve' },
  ];

  // Painel flutuante (fora do nav) — mesmo padrão visual do admin
  let panel = document.getElementById('func-hover-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'func-hover-panel';
    panel.className = 'fixed z-50 bg-white rounded-lg shadow-xl ring-1 ring-black/5 w-[320px] opacity-0 pointer-events-none translate-y-2 transition-all';
    panel.innerHTML = `
      <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <i class="fas fa-stethoscope text-primary"></i>
        <h3 class="font-semibold text-gray-800">Veterinário</h3>
      </div>
      <div class="p-2 space-y-1" data-list></div>
    `;
    document.body.appendChild(panel);
  }
  const list = panel.querySelector('[data-list]');

  // Render dos itens
  function renderItems() {
    list.innerHTML = ITEMS.map((it) => {
      const status = typeof it.status === 'string' ? it.status.trim() : '';
      const badge = status
        ? `<span class="text-[10px] uppercase tracking-wide bg-gray-200 text-gray-700 rounded px-2 py-0.5">${status}</span>`
        : '';
      return `
      <a href="${it.href}" class="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-50">
        <span class="flex items-center gap-3">
          <i class="${it.icon} w-5 text-center"></i>
          <span>${it.label}</span>
        </span>
        ${badge}
      </a>
    `;
    }).join('');
  }
  renderItems();

  let hideTimer = null;

  const showPanel = () => {
    const r = trigger.getBoundingClientRect();
    // posiciona logo abaixo e alinhado à esquerda do botão
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 336, r.left))}px`;
    panel.style.top  = `${r.bottom + 6}px`;
    panel.classList.remove('opacity-0','pointer-events-none','translate-y-2');
  };
  const hidePanel = () => {
    panel.classList.add('opacity-0','pointer-events-none','translate-y-2');
  };

  // Interações (hover/click)
  trigger.addEventListener('mouseenter', () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    showPanel();
  });
  trigger.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(hidePanel, 120);
  });
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    if (panel.classList.contains('pointer-events-none')) showPanel(); else hidePanel();
  });

  panel.addEventListener('mouseenter', () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  panel.addEventListener('mouseleave', () => hidePanel());

  // Fecha ao clicar fora
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !trigger.contains(e.target)) hidePanel();
  });

  // Deixa o botão ativo (verde) se estiver em alguma página vet-*
  const path = window.location.pathname;
  const isVetInner = /\/pages\/funcionarios\/vet-(ficha-clinica|documentos|receitas|assinatura)\.html$/.test(path);
  if (isVetInner) {
    trigger.classList.add('bg-primary/10','text-primary','font-bold');
    trigger.classList.remove('text-gray-600');
  }
}

function updateActiveFuncionariosLink() {
  const wrapper = document.getElementById('func-sidebar-placeholder');
  if (!wrapper) return;

  const navLinks = wrapper.querySelectorAll('nav a');
  const inactiveClasses = ['text-gray-600', 'hover:bg-gray-100'];
  const activeClasses   = ['bg-primary/10', 'text-primary', 'font-bold', 'border-l-4', 'border-primary'];

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    // Normaliza comparando apenas o pathname (mesma regra usada no projeto)
    const url = new URL(href, window.location.origin);
    const isActive = window.location.pathname.endsWith(url.pathname);

    if (isActive) {
      link.classList.remove(...inactiveClasses);
      link.classList.add(...activeClasses);
      link.classList.remove('hover:bg-gray-100');
    } else {
      link.classList.remove(...activeClasses);
      link.classList.add(...inactiveClasses);
    }
  });
}

async function initializeHeaderScripts() {
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const menu = document.getElementById('mobile-menu');
    if (mobileMenuButton && menu) {
        mobileMenuButton.addEventListener('click', () => menu.classList.toggle('hidden'));
    }

    // Alinhar o popover do telefone à mesma posição do popover de usuário
    try {
        const phoneTrigger = document.getElementById('phone-menu-trigger');
        const phonePanel = document.getElementById('phone-menu-panel');
        if (phoneTrigger && phonePanel) {
            const show = () => {
                phonePanel.classList.remove('opacity-0','pointer-events-none','scale-95');
            };
            const hide = () => {
                phonePanel.classList.add('opacity-0','pointer-events-none','scale-95');
            };
            let hideTimer = null;
            const delayedHide = () => { hideTimer = setTimeout(hide, 120); };
            const cancelHide = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } };

            phoneTrigger.addEventListener('mouseenter', () => { cancelHide(); show(); });
            phoneTrigger.addEventListener('mouseleave', () => { delayedHide(); });
            phonePanel.addEventListener('mouseenter', () => { cancelHide(); });
            phonePanel.addEventListener('mouseleave', () => { delayedHide(); });
            document.addEventListener('click', (e) => {
                if (!phoneTrigger.contains(e.target) && !phonePanel.contains(e.target)) hide();
            });
        }
    } catch(_) { /* ignora */ }
}

let siteHeaderSpacingInitialized = false;

function adjustSiteMainSpacing() {
    const mains = document.querySelectorAll('main[data-header-offset="site"]');
    if (!mains.length) return;

    const headerTop = document.getElementById('header-top');
    const categoryNav = document.getElementById('category-nav');
    const gap = 8;

    let offset = gap;

    if (categoryNav) {
        const navRect = categoryNav.getBoundingClientRect();
        if (navRect.height > 0) {
            offset = Math.max(offset, Math.round(navRect.bottom + gap));
        }
    }

    if (headerTop && offset === gap) {
        const headerRect = headerTop.getBoundingClientRect();
        if (headerRect.height > 0) {
            offset = Math.max(offset, Math.round(headerRect.bottom + gap));
        }
    }

    mains.forEach((main) => {
        main.style.paddingTop = `${offset}px`;
    });
}

function setupSiteMainSpacing() {
    const recalc = () => adjustSiteMainSpacing();

    adjustSiteMainSpacing();

    if (!siteHeaderSpacingInitialized) {
        siteHeaderSpacingInitialized = true;
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => recalc(), 100);
        });
        window.addEventListener('load', recalc);
    }

    if (typeof ResizeObserver !== 'undefined') {
        const headerTop = document.getElementById('header-top');
        const categoryNav = document.getElementById('category-nav');

        if (!window.__siteHeaderResizeObserver) {
            window.__siteHeaderResizeObserver = new ResizeObserver(() => recalc());
        }
        if (!window.__siteNavResizeObserver) {
            window.__siteNavResizeObserver = new ResizeObserver(() => recalc());
        }

        if (headerTop) {
            window.__siteHeaderResizeObserver.disconnect();
            window.__siteHeaderResizeObserver.observe(headerTop);
        }

        if (categoryNav) {
            window.__siteNavResizeObserver.disconnect();
            window.__siteNavResizeObserver.observe(categoryNav);
        }
    }
}

// Busca do topo (auto-complete + sugestões)
function initializeHeaderSearch() {
  const input = document.getElementById('top-search');
  const btn = document.getElementById('top-search-btn');
  const panel = document.getElementById('top-search-panel');
  if (!input || !panel) return;

  let topTerms = [];
  let abortCtrl;
  const DEBOUNCE_MS = 200;
  let tmr;

  const navigateToSearch = (term) => {
    if (!term) return;
    fetch(`${API_CONFIG.BASE_URL}/search/track`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ term }) }).catch(()=>{});
    window.location.href = `/pages/menu-departments-item/search.html?search=${encodeURIComponent(term)}`;
  };

  const priceHtml = (p)=>{
    if (p.promocao?.ativa && p.promocao.porcentagem>0) {
      const disc = p.venda * (1 - p.promocao.porcentagem/100);
      return `<div><span class="block text-sm text-gray-500 line-through">R$ ${p.venda.toFixed(2).replace('.', ',')}</span><span class="text-base font-bold text-primary">R$ ${disc.toFixed(2).replace('.', ',')}</span></div>`;
    }
    if (p.precoClube && p.precoClube < p.venda) {
      return `<div><span class="block text-sm text-gray-500">R$ ${p.venda.toFixed(2).replace('.', ',')}</span><span class="text-base font-bold text-primary">R$ ${p.precoClube.toFixed(2).replace('.', ',')}</span></div>`;
    }
    return `<span class="text-base font-bold text-gray-900">R$ ${p.venda.toFixed(2).replace('.', ',')}</span>`;
  };

  const renderTop = ()=>{
    panel.innerHTML = `
      <div class="p-3 border-b bg-gray-50 rounded-t-xl font-semibold text-gray-700">Termos mais buscados</div>
      <ul class="max-h-80 overflow-auto">
        ${topTerms.map(t=>`<li class="px-4 py-3 hover:bg-primary/10 cursor-pointer flex items-center gap-3" data-term="${t}"><i class="fa-solid fa-magnifying-glass text-gray-500"></i><span>${t}</span></li>`).join('')}
      </ul>`;
    panel.classList.remove('hidden');
  };

  const renderSuggest = (terms, products)=>{
    const visibleProducts = Array.isArray(products)
      ? products.filter(item => item && item.naoMostrarNoSite !== true)
      : [];
    const productCards = visibleProducts.map(p=>{
      const imgSrc = p.imagemPrincipal ? `${API_CONFIG.SERVER_URL}${p.imagemPrincipal}` : `${API_CONFIG.SERVER_URL}/image/placeholder.png`;
      return `<a href="/pages/menu-departments-item/product.html?id=${p._id}" class="flex gap-3 border rounded-lg p-2 hover:shadow">
              <img src="${imgSrc}" class="w-16 h-16 object-contain bg-white rounded" alt="${p.nome}">
              <div class="min-w-0">
                <div class="text-sm text-gray-800 line-clamp-2">${p.nome}</div>
                <div class="mt-1">${priceHtml(p)}</div>
              </div>
            </a>`;
    }).join('');

    panel.innerHTML = `
      <ul class="divide-y">
        ${terms.map(t=>`<li class="px-4 py-3 hover:bg-primary/10 cursor-pointer flex items-center gap-3" data-term="${t}"><i class=\"fa-solid fa-magnifying-glass text-gray-500\"></i><span>${t}</span></li>`).join('')}
      </ul>
      <div class="mt-2 border-t">
        <div class="p-3 bg-gray-50 font-semibold text-gray-700">Produtos sugeridos</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3">
          ${productCards || '<p class="col-span-full text-sm text-gray-500">Nenhum produto disponível.</p>'}
        </div>
      </div>`;
    panel.classList.remove('hidden');
  };

  const fetchTop = async ()=>{
    try {
      const r = await fetch(`${API_CONFIG.BASE_URL}/search/top?limit=5`);
      topTerms = await r.json().catch(()=>[]);
    } catch { topTerms = []; }
  };

  const suggest = async (q)=>{
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    try {
      const r = await fetch(`${API_CONFIG.BASE_URL}/search/suggest?q=${encodeURIComponent(q)}&limit=4`, { signal: abortCtrl.signal });
      const j = await r.json();
      renderSuggest(j.terms || [], j.products || []);
    } catch(_) {}
  };

  input.addEventListener('focus', async ()=>{
    if (!topTerms.length) await fetchTop();
    renderTop();
  });
  input.addEventListener('input', ()=>{
    const v = input.value.trim();
    clearTimeout(tmr);
    if (v.length >= 3) tmr = setTimeout(()=> suggest(v), DEBOUNCE_MS);
    else renderTop();
  });
  btn?.addEventListener('click', ()=> navigateToSearch(input.value.trim()));
  input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') navigateToSearch(input.value.trim()); });

  document.addEventListener('click', (e)=>{
    if (!panel.contains(e.target) && e.target !== input) panel.classList.add('hidden');
  });
  panel.addEventListener('click', (e)=>{
    const li = e.target.closest('[data-term]');
    if (li) navigateToSearch(li.dataset.term);
  });
}

function initializeAdminHeaderSearch() {
  const root = document.querySelector('[data-admin-screen-search]');
  if (!root || root.dataset.enhanced === 'true') return;

  const input = root.querySelector('[data-admin-screen-search-input]');
  const panel = root.querySelector('[data-admin-screen-search-results]');
  const list = root.querySelector('[data-results-list]');
  const emptyState = root.querySelector('[data-empty-state]');
  const noResultsState = root.querySelector('[data-no-results]');
  if (!input || !panel || !list || !emptyState || !noResultsState) return;

  root.dataset.enhanced = 'true';

  const normalize = (value = '') => value
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

  let screens = [];
  let matches = [];
  let activeIndex = -1;

  const MIN_LENGTH = 2;

  const placeholder = document.getElementById('admin-sidebar-placeholder');

  const collectGroups = (link) => {
    const groups = [];
    let current = link.closest('[data-accordion-content]');
    while (current) {
      const toggle = current.previousElementSibling;
      if (toggle && toggle.hasAttribute('data-accordion-button')) {
        const text = toggle.textContent.replace(/\s+/g, ' ').trim();
        if (text) groups.unshift(text);
        current = toggle.closest('[data-accordion-content]');
      } else {
        break;
      }
    }
    return groups;
  };

  const collectScreens = () => {
    if (!placeholder) return [];
    const panelEl = placeholder.querySelector('[data-admin-sidebar-panel]');
    if (!panelEl) return [];

    const links = Array.from(panelEl.querySelectorAll('a[href]:not([href="#"])'));
    const unique = new Map();

    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;
      const label = link.textContent.replace(/\s+/g, ' ').trim();
      if (!label) return;

      const groups = collectGroups(link);
      const searchText = normalize(`${label} ${groups.join(' ')}`);

      if (!unique.has(href)) {
        unique.set(href, {
          label,
          href,
          groups,
          searchText,
        });
      }
    });

    return Array.from(unique.values());
  };

  const refreshScreens = () => {
    const collected = collectScreens();
    if (collected.length) {
      screens = collected;
    }
  };

  refreshScreens();

  if (placeholder && !screens.length) {
    const observer = new MutationObserver(() => {
      refreshScreens();
      if (screens.length) observer.disconnect();
    });
    observer.observe(placeholder, { childList: true, subtree: true });
  }

  const hidePanel = () => {
    panel.classList.add('hidden');
    activeIndex = -1;
    matches = [];
  };

  const showPanel = () => {
    panel.classList.remove('hidden');
  };

  const setState = (state) => {
    showPanel();
    if (state === 'empty') {
      emptyState.classList.remove('hidden');
      noResultsState.classList.add('hidden');
      list.classList.add('hidden');
    } else if (state === 'no-results') {
      emptyState.classList.add('hidden');
      noResultsState.classList.remove('hidden');
      list.classList.add('hidden');
    } else if (state === 'results') {
      emptyState.classList.add('hidden');
      noResultsState.classList.add('hidden');
      list.classList.remove('hidden');
    }
  };

  const highlight = (index) => {
    const items = list.querySelectorAll('a[data-index]');
    items.forEach((item, idx) => {
      if (idx === index) {
        item.classList.add('bg-primary/10');
      } else {
        item.classList.remove('bg-primary/10');
      }
    });
    activeIndex = index;
  };

  const openMatch = (index) => {
    const match = matches[index];
    if (!match) return;

    window.location.href = match.href;

    hidePanel();
  };

  const renderMatches = () => {
    list.innerHTML = matches
      .map((screen, index) => {
        const breadcrumb = screen.groups.length ? `<span class="text-xs text-gray-500">${screen.groups.join(' • ')}</span>` : '';
        return `
          <li>
            <a href="${screen.href}" data-index="${index}" class="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-sm text-gray-800 transition focus:outline-none focus:ring-0 hover:bg-primary/10">
              <span class="font-semibold text-gray-900 leading-tight">${screen.label}</span>
              ${breadcrumb}
            </a>
          </li>
        `;
      })
      .join('');
    highlight(matches.length ? 0 : -1);
  };

  const filterScreens = (value) => {
    const term = value.trim();
    if (!term) {
      matches = [];
      list.innerHTML = '';
      setState('empty');
      highlight(-1);
      return;
    }

    if (term.length < MIN_LENGTH) {
      matches = [];
      list.innerHTML = '';
      setState('empty');
      highlight(-1);
      return;
    }

    const normalized = normalize(term);
    matches = screens
      .filter((screen) => screen.searchText.includes(normalized))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

    if (!matches.length) {
      list.innerHTML = '';
      setState('no-results');
      highlight(-1);
      return;
    }

    renderMatches();
    setState('results');
  };

  list.classList.add('hidden');

  input.addEventListener('focus', () => {
    refreshScreens();
    if (input.value.trim().length >= MIN_LENGTH) {
      filterScreens(input.value);
    } else {
      setState('empty');
    }
  });

  input.addEventListener('input', () => {
    refreshScreens();
    filterScreens(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      if (!matches.length) return;
      event.preventDefault();
      const next = activeIndex < matches.length - 1 ? activeIndex + 1 : 0;
      highlight(next);
    } else if (event.key === 'ArrowUp') {
      if (!matches.length) return;
      event.preventDefault();
      const prev = activeIndex > 0 ? activeIndex - 1 : matches.length - 1;
      highlight(prev);
    } else if (event.key === 'Enter') {
      if (matches.length === 1 && activeIndex === -1) {
        event.preventDefault();
        openMatch(0);
      } else if (activeIndex >= 0) {
        event.preventDefault();
        openMatch(activeIndex);
      }
    } else if (event.key === 'Escape') {
      hidePanel();
      input.blur();
    }
  });

  list.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-index]');
    if (!anchor) return;
    event.preventDefault();
    const index = Number(anchor.dataset.index);
    if (!Number.isNaN(index)) {
      openMatch(index);
    }
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) {
      hidePanel();
    }
  });
}

const BANNER_SETTINGS_KEY = 'bannerDisplaySettings';

const getBannerDisplaySettings = () => {
    try {
        return JSON.parse(localStorage.getItem(BANNER_SETTINGS_KEY)) || {};
    } catch (error) {
        console.warn('Não foi possível ler ajustes de banner salvos localmente.', error);
        return {};
    }
};

const resolveFitMode = (fitMode, scaleX, scaleY) => {
    if (fitMode === 'cover' && (scaleX < 1 || scaleY < 1)) {
        return 'contain';
    }
    return fitMode;
};

const applyBannerStyles = (imgElement, bannerId, settingsMap = null) => {
    const settings = (settingsMap || getBannerDisplaySettings())[bannerId];
    if (!imgElement || !settings) return;

    const { fitMode = 'cover', positionX = 50, positionY = 50, zoom = 100, widthScale = 100, heightScale = 100 } = settings;
    const baseScale = Math.max(50, zoom) / 100;
    const scaleX = baseScale * (widthScale / 100);
    const scaleY = baseScale * (heightScale / 100);
    const effectiveFit = resolveFitMode(fitMode, scaleX, scaleY);
    imgElement.style.objectFit = effectiveFit;
    imgElement.style.objectPosition = `${positionX}% ${positionY}%`;
    imgElement.style.transform = `scale(${scaleX}, ${scaleY})`;
    imgElement.style.transformOrigin = `${positionX}% ${positionY}%`;
};

async function initializeCarousel() {
    const carousel = document.querySelector('#carousel');
    if (!carousel) return;

    const carouselContainer = carousel.querySelector('.carousel-container');
    const indicators = Array.from(document.querySelectorAll('.indicator')); // Convertido para Array
    const prevButton = document.getElementById('prev');
    const nextButton = document.getElementById('next');
    let bannerAspectRatio = null;

    if (!carouselContainer || !prevButton || !nextButton) {
        console.warn('Elementos essenciais do carrossel (container, botões) não encontrados.');
        return;
    }

    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/banners`);
        const banners = await response.json();
        const displaySettings = getBannerDisplaySettings();

        carouselContainer.innerHTML = ''; // Limpa o container de slides
        banners.forEach(banner => {
            const slide = document.createElement('div');
            slide.className = 'slide w-full h-full';
            const resolveImageSrc = (url) => {
                if (!url) return '';
                const isAbsolute = /^https?:\/\//i.test(url);
                return isAbsolute ? url : `${API_CONFIG.SERVER_URL}${url}`;
            };

            const desktopSrc = resolveImageSrc(banner.imageUrl);
            const mobileSrc = resolveImageSrc(banner.mobileImageUrl);
            slide.innerHTML = `
                <a href="${banner.link}" class="block w-full h-full">
                    <picture class="block w-full h-full">
                        ${mobileSrc ? `<source media="(max-width: 768px)" srcset="${mobileSrc}">` : ''}
                        <img src="${desktopSrc}" alt="${banner.title || 'Banner Promocional'}" class="w-full h-full object-contain" loading="lazy" decoding="async">
                    </picture>
                </a>
            `;
            const img = slide.querySelector('img');
            applyBannerStyles(img, banner._id, displaySettings);
            const setAspectFromImage = () => {
                if (!img?.naturalWidth || !img?.naturalHeight) return;
                bannerAspectRatio = img.naturalWidth / img.naturalHeight;
                carousel.style.setProperty('--carousel-aspect-ratio', `${img.naturalWidth} / ${img.naturalHeight}`);

                const styles = getComputedStyle(carousel);
                const slideWidth = parseFloat(styles.getPropertyValue('--carousel-slide-width')) || carousel.clientWidth;
                const minHeight = parseFloat(styles.getPropertyValue('--carousel-min-height')) || 0;
                const maxHeight = parseFloat(styles.getPropertyValue('--carousel-max-height')) || Number.POSITIVE_INFINITY;
                const baseWidth = Math.min(carousel.clientWidth, slideWidth);
                const targetHeight = baseWidth ? baseWidth / bannerAspectRatio : 0;
                if (targetHeight > 0) {
                    const boundedHeight = Math.min(Math.max(targetHeight, minHeight), maxHeight);
                    carousel.style.setProperty('--carousel-height', `${boundedHeight}px`);
                }
            };

            if (img?.complete && img.naturalWidth && img.naturalHeight) {
                setAspectFromImage();
            } else if (img) {
                img.addEventListener('load', setAspectFromImage, { once: true });
            }
            carouselContainer.appendChild(slide);
        });

    } catch (error) {
        console.error("Erro ao carregar banners para o carrossel:", error);
        carouselContainer.innerHTML = '<p class="text-center text-white font-semibold">Não foi possível carregar os banners no momento.</p>';
        return; // Interrompe a execução se não conseguir carregar os banners
    }

    const updateHeightOnResize = () => {
        if (!bannerAspectRatio) return;
        const styles = getComputedStyle(carousel);
        const slideWidth = parseFloat(styles.getPropertyValue('--carousel-slide-width')) || carousel.clientWidth;
        const minHeight = parseFloat(styles.getPropertyValue('--carousel-min-height')) || 0;
        const maxHeight = parseFloat(styles.getPropertyValue('--carousel-max-height')) || Number.POSITIVE_INFINITY;
        const baseWidth = Math.min(carousel.clientWidth, slideWidth);
        const targetHeight = baseWidth ? baseWidth / bannerAspectRatio : 0;
        if (targetHeight > 0) {
            const boundedHeight = Math.min(Math.max(targetHeight, minHeight), maxHeight);
            carousel.style.setProperty('--carousel-height', `${boundedHeight}px`);
        }
    };

    const slides = Array.from(carousel.querySelectorAll('.slide'));

    // Se não houver slides após o carregamento, não faz nada
    if (slides.length === 0) {
        prevButton.style.display = 'none';
        nextButton.style.display = 'none';
        indicators.forEach(ind => ind.style.display = 'none');
        return;
    }

    const N = slides.length;
    let currentIndex = 0; // Começa do primeiro slide
    let autoPlayInterval;
    const AUTO_PLAY_INTERVAL = 5000;

    // Atualiza as classes CSS dos slides para criar o efeito 3D
    function updateCarouselState() {
        slides.forEach((slide, index) => {
            slide.classList.remove('slide-ativo', 'slide-anterior', 'slide-proximo', 'slide-escondido-esquerda', 'slide-escondido-direita');
            
            if (index === currentIndex) {
                slide.classList.add('slide-ativo');
            } else if (index === (currentIndex - 1 + N) % N) {
                slide.classList.add('slide-anterior');
            } else if (index === (currentIndex + 1) % N) {
                slide.classList.add('slide-proximo');
            } else if (index === (currentIndex - 2 + N) % N) {
                slide.classList.add('slide-escondido-esquerda');
            } else {
                slide.classList.add('slide-escondido-direita');
            }
        });
        
        // Atualiza os indicadores (as barras de progresso)
        indicators.forEach((indicator, i) => {
            if (i < N) { // Garante que só tentamos manipular indicadores que existem
                const progressBar = indicator.querySelector('.progress');
                const barBg = indicator.querySelector('.bar-bg');
                const dot = indicator.querySelector('.dot');
                indicator.style.display = 'flex'; // Garante que o indicador é visível
                const isActive = i === currentIndex;
                indicator.classList.toggle('active', isActive);

                // Controle explícito de visibilidade para evitar interferência do SVG
                if (dot) {
                    dot.style.display = isActive ? 'none' : 'block';
                    try { dot.setAttribute('r', isActive ? '0' : '4'); } catch(_) {}
                }
                if (barBg) barBg.style.display = isActive ? 'block' : 'none';
                if (progressBar) {
                    progressBar.style.display = isActive ? 'block' : 'none';
                    progressBar.style.animation = 'none';
                    if (isActive) {
                        void progressBar.offsetWidth; // Reinicia a animação
                        progressBar.style.animation = `fillIndicator ${AUTO_PLAY_INTERVAL / 1000}s linear forwards`;
                    }
                }
            } else {
                indicator.style.display = 'none'; // Esconde indicadores extra
            }
        });
    }

    function moveNext() {
        currentIndex = (currentIndex + 1) % N;
        updateCarouselState();
    }

    function movePrev() {
        currentIndex = (currentIndex - 1 + N) % N;
        updateCarouselState();
    }
    
    function startAutoPlay() {
        stopAutoPlay();
        autoPlayInterval = setInterval(moveNext, AUTO_PLAY_INTERVAL);
    }

    function stopAutoPlay() {
        clearInterval(autoPlayInterval);
    }

    window.addEventListener('resize', updateHeightOnResize);

    nextButton.addEventListener('click', () => {
        stopAutoPlay();
        moveNext();
        startAutoPlay();
    });

    prevButton.addEventListener('click', () => {
        stopAutoPlay();
        movePrev();
        startAutoPlay();
    });

    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            if (index >= N) return;
            stopAutoPlay();
            currentIndex = index;
            updateCarouselState();
            startAutoPlay();
        });
    });
    
    // Inicia o carrossel
    updateCarouselState();
    startAutoPlay();
}

function checkLoginState() {
    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
    const loggedOutView = document.getElementById('user-logged-out-view');
    const loggedInView = document.getElementById('user-logged-in-view');
    const userAreaLink = document.querySelector('.user-area');
    const userGreeting = loggedInView ? loggedInView.querySelector('.user-greeting') : null;
    const logoutBtn = document.getElementById('logout-btn');

    // novo: painel do menu e item de logout dentro do painel
    const userMenuPanel = document.getElementById('user-menu-panel');
    const userMenuLogout = document.getElementById('user-menu-logout');

    if (!loggedOutView || !loggedInView || !userAreaLink || !logoutBtn) return;

    if (loggedInUser && loggedInUser.nome) {
        // LOGADO
        loggedOutView.classList.add('hidden');
        loggedInView.classList.remove('hidden');
        userAreaLink.href = `${basePath}pages/meus-dados.html`;
        // Ajusta visual do topo: azul + ícone + ponto final
        try {
          loggedInView.classList.remove('text-gray-700');
          ['flex','items-center','gap-2','text-primary','cursor-pointer'].forEach(c => loggedInView.classList.add(c));
          if (!loggedInView.querySelector('.login-user-icon')) {
            const icon = document.createElement('i');
            icon.className = 'login-user-icon fa-regular fa-user text-lg';
            loggedInView.prepend(icon);
          }
          const nameBold = loggedInView.querySelector('#topbar-user-name');
          if (nameBold && !document.getElementById('greeting-dot')) {
            const dot = document.createElement('span');
            dot.id = 'greeting-dot';
            dot.textContent = '.';
            dot.style.marginLeft = '0.1rem';
            nameBold.insertAdjacentElement('afterend', dot);
          }
        } catch(_) {}
        if (userGreeting) userGreeting.textContent = loggedInUser.nome.split(' ')[0];

        // reaproveita lógica de sair existente
        logoutBtn.classList.remove('hidden');
        logoutBtn.onclick = () => {
            showModal({
                title: 'Confirmar Saída',
                message: 'Tem a certeza que deseja sair da sua conta?',
                confirmText: 'Sair',
                cancelText: 'Cancelar',
                onConfirm: () => {
                    try { localStorage.removeItem('loggedInUser'); } catch(_) {}
                    try { localStorage.removeItem('auth_token'); } catch(_) {}
                    try { localStorage.removeItem('user'); } catch(_) {}
                    window.location.href = `${basePath}index.html`;
                },
            });
        };

        // habilita popover
        if (userMenuPanel) {
            userMenuPanel.classList.remove('hidden');
            userMenuPanel.classList.add('peer-hover:block','hover:block');
        }
        // oculta botão circular antigo, se existir
        const oldBtn = document.getElementById('user-menu-trigger');
        if (oldBtn) { oldBtn.style.display = 'none'; oldBtn.setAttribute('aria-hidden','true'); }
        if (userMenuLogout && logoutBtn) {
            userMenuLogout.onclick = (e) => { e.preventDefault(); logoutBtn.click(); };
        }
    } else {
        // DESLOGADO
        loggedOutView.classList.remove('hidden');
        loggedInView.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        userAreaLink.href = `${basePath}pages/login.html`;

        // desabilita popover quando deslogado (não deve aparecer)
        if (userMenuPanel) {
            userMenuPanel.classList.add('hidden');
            userMenuPanel.classList.remove('peer-hover:block','hover:block');
        }
    }
}

function initializeHideOnScroll() {
    let lastScroll = 0;
    const categoryNav = document.getElementById('category-nav');
    if (!categoryNav) return;
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        if (currentScroll > lastScroll && currentScroll > 80) {
            categoryNav.classList.add('hide');
        } else {
            categoryNav.classList.remove('hide');
        }
        lastScroll = currentScroll;
    });
}

function initializeFlyoutMenu() {
    const menuPanels = document.querySelectorAll('#dog-menu-panel, #cat-menu-panel, #bird-menu-panel, #fish-menu-panel, #other-menu-panel, #garden-menu-panel');
    menuPanels.forEach(panel => {
        const mainCategoriesList = panel.querySelector('ul[id$="-main-categories"]');
        if (!mainCategoriesList) return;
        const mainCategories = mainCategoriesList.querySelectorAll('li');
        const allSubmenus = panel.querySelectorAll('.submenu-content, .submenu-content-cat, .submenu-content-bird, .submenu-content-fish, .submenu-content-other, .submenu-content-garden');
        mainCategories.forEach(category => {
            category.addEventListener('mouseenter', () => {
                mainCategories.forEach(c => c.querySelector('a').classList.remove('bg-primary/10', 'text-primary', 'font-semibold'));
                category.querySelector('a').classList.add('bg-primary/10', 'text-primary', 'font-semibold');
                allSubmenus.forEach(submenu => submenu.classList.add('hidden'));
                const submenuId = category.dataset.submenu;
                const newSubmenu = document.getElementById(submenuId);
                if (newSubmenu) newSubmenu.classList.remove('hidden');
            });
        });
        panel.addEventListener('mouseleave', () => {
            allSubmenus.forEach(submenu => submenu.classList.add('hidden'));
            mainCategories.forEach(c => c.querySelector('a').classList.remove('bg-primary/10', 'text-primary', 'font-semibold'));
        });
    });
}

function checkAdminLink() {
  return checkRoleLink('admin-link', ['funcionario','admin','admin_master']);
}

let __roleCachePromise = null;
async function __getUserRoleOnce() {
  if (__roleCachePromise) return __roleCachePromise;
  __roleCachePromise = (async () => {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null'); } catch {}
    let role = cached?.role;
    // Se não houver role mas tiver token, confirma no backend
    if (!role && cached?.token) {
      try {
        const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/check`, {
          headers: { Authorization: `Bearer ${cached.token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          role = data?.role || role;
          localStorage.setItem('loggedInUser', JSON.stringify({ ...cached, role }));
        }
      } catch (_) {}
    }
    return role || null;
  })();
  return __roleCachePromise;
}

async function checkRoleLink(linkId, allowedRoles) {
  const el = document.getElementById(linkId);
  if (!el) return;
  const toggle = (ok) => el.classList.toggle('hidden', !ok);
  try {
    const role = await __getUserRoleOnce();
    toggle(allowedRoles.includes(role));
  } catch (e) {
    console.error('checkRoleLink:', e);
    toggle(false);
  }
}

async function loadFeaturedProducts() {
    const container = document.getElementById('featured-products-container');
    const wrapper = document.getElementById('featured-slider-wrapper');
    const prevButton = document.getElementById('prev-featured-btn');
    const nextButton = document.getElementById('next-featured-btn');

    // Se os elementos do slider não existirem na página, a função para.
    if (!container || !wrapper || !prevButton || !nextButton) {
        return;
    }

    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/products/destaques`);
        if (!response.ok) throw new Error('Não foi possível buscar os produtos em destaque.');
        
        const products = await response.json();

        if (products.length === 0) {
            wrapper.innerHTML = '<p class="text-center text-gray-500 col-span-full">Nenhum produto em destaque no momento.</p>';
            return;
        }

        container.innerHTML = ''; 

        products.forEach(product => {
            // A lógica de preços que já definimos continua igual
            let priceHtml = '';
            if (product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0) {
                const discountedPrice = product.venda * (1 - product.promocao.porcentagem / 100);
                priceHtml = `
                    <div>
                        <span class="block text-sm text-gray-500 line-through">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
                        <div class="flex items-center">
                            <span class="text-lg font-bold text-primary">R$ ${discountedPrice.toFixed(2).replace('.', ',')}</span>
                            <span class="ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">Promo</span>
                        </div>
                    </div>
                `;
            } else if (product.promocaoCondicional && product.promocaoCondicional.ativa) {
                let promoText = 'Oferta Especial';
                if (product.promocaoCondicional.tipo === 'leve_pague') {
                    promoText = `Leve ${product.promocaoCondicional.leve} Pague ${product.promocaoCondicional.pague}`;
                } else if (product.promocaoCondicional.tipo === 'acima_de') {
                    promoText = `+${product.promocaoCondicional.quantidadeMinima} un. com ${product.promocaoCondicional.descontoPorcentagem}%`;
                }
                priceHtml = `
                    <div>
                        <span class="block text-lg font-bold text-gray-800">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
                        <div class="flex items-center">
                            <span class="text-xs font-bold text-white bg-primary rounded-full px-2 py-1">${promoText}</span>
                        </div>
                    </div>
                `;
            } else if (product.precoClube && product.precoClube < product.venda) {
                priceHtml = `
                    <div>
                        <span class="block text-lg font-bold text-gray-950">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
                        <div class="flex items-center">
                            <span class="text-lg font-bold text-primary">R$ ${product.precoClube.toFixed(2).replace('.', ',')}</span>
                            <span class="ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">Club</span>
                        </div>
                    </div>
                `;
            } else {
                priceHtml = `<span class="block text-lg font-bold text-gray-950">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>`;
            }

            // Criação do card completo do produto
            const productCard = `
                <a href="${basePath}pages/menu-departments-item/product.html?id=${product._id}" class="relative block bg-white rounded-lg shadow product-card transition duration-300 group overflow-hidden w-60 sm:w-64 flex-shrink-0">
                    
                    ${product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0 ? `
                        <div class="absolute top-3 left-0 w-auto bg-primary text-white text-xs font-bold py-1 pl-2 pr-3 rounded-r z-10">
                            -${product.promocao.porcentagem}% DE DESCONTO
                        </div>
                    ` : ''}

                    <div class="p-4 product-info flex flex-col h-full">
                        <div class="relative w-full h-48 mb-4">
                            <img src="${API_CONFIG.SERVER_URL}${product.imagemPrincipal}" alt="${product.nome}" class="w-full h-full object-cover rounded-md">
                            
                            <div class="add-to-cart absolute bottom-3 right-3 w-[55px] h-[55px] flex items-center justify-center rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 hover:bg-secondary" data-product-id="${product._id}">
                                <div data-icon="sacola" class="w-[55px] h-[55px]"></div>
                                <span class="sr-only">Adicionar ao Carrinho</span>
                            </div>
                        </div>
                        <div class="product-details flex flex-col flex-grow">
                            <h3 class="font-normal text-base h-12 line-clamp-2">${product.nome}</h3>
                            <div class="product-price flex items-center mb-2 mt-auto min-h-[2.5rem]">${priceHtml}</div>
                        </div>
                    </div>
                </a>
            `;

            container.innerHTML += productCard;
        });

        container.addEventListener('click', async (event) => { // <-- ADICIONADO ASYNC AQUI
            const cartButton = event.target.closest('.add-to-cart');
            if (cartButton) {
                event.preventDefault();
                const productId = cartButton.dataset.productId;
                await CartManager.addItem(productId);
                // Notificação leve (não bloqueia a navegação)
                if (typeof showToast === 'function') {
                showToast('Produto adicionado à sacola.', 'success');
                }
            }
        });

        // Lógica de navegação do slider
        let currentIndex = 0;
        const totalItems = products.length;
        const updateSlider = () => {
            const card = container.querySelector('.product-card');
            if (!card) return;
            const cardWidth = card.offsetWidth;
            const gap = 24;
            const itemsVisible = Math.floor(wrapper.offsetWidth / (cardWidth + gap));
            const maxIndex = Math.max(0, totalItems - itemsVisible);
            if (currentIndex > maxIndex) currentIndex = maxIndex;
            if (currentIndex < 0) currentIndex = 0;
            const moveDistance = (cardWidth + gap) * currentIndex;
            container.style.transform = `translateX(-${moveDistance}px)`;
            prevButton.disabled = currentIndex === 0;
            nextButton.disabled = currentIndex >= maxIndex;
        };
        nextButton.addEventListener('click', () => {
            const card = container.querySelector('.product-card');
            if (!card) return;
            const cardWidth = card.offsetWidth;
            const gap = 24;
            const itemsVisible = Math.floor(wrapper.offsetWidth / (cardWidth + gap));
            const maxIndex = Math.max(0, totalItems - itemsVisible);
            currentIndex = Math.min(currentIndex + itemsVisible, maxIndex);
            updateSlider();
        });
        prevButton.addEventListener('click', () => {
            const card = container.querySelector('.product-card');
            if (!card) return;
            const cardWidth = card.offsetWidth;
            const gap = 24;
            const itemsVisible = Math.floor(wrapper.offsetWidth / (cardWidth + gap));
            currentIndex = Math.max(currentIndex - itemsVisible, 0);
            updateSlider();
        });
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(updateSlider, 250);
        });
        updateSlider();
        if (typeof loadIcons === 'function') {
            await loadIcons();
        }
        
    } catch (error) {
        console.error('Erro ao carregar produtos em destaque:', error);
        wrapper.innerHTML = '<p class="text-center text-red-500">Ocorreu um erro ao carregar os produtos.</p>';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadComponents();

    document.dispatchEvent(new CustomEvent('components:ready'));
    
    if (typeof loadIcons === 'function') {
        await loadIcons();
    }

    // Inicializador de páginas específicas
    const path = window.location.pathname;

    // ----> Lógica para a página inicial
    if (path.endsWith('/') || path.endsWith('index.html')) {
        initializeCarousel();
        loadFeaturedProducts();
    }

    // ----> Lógica para as páginas de admin
    if (path.includes('/admin/')) {
        if (path.endsWith('admin-destaques.html')) {
            if (typeof initializeAdminDestaquesPage === 'function') initializeAdminDestaquesPage();
        }
    }
    
    // ----> Lógica para as páginas de conta do utilizador
    if (path.endsWith('meus-dados.html')) {
        if (typeof initializeAccountPage === 'function') initializeAccountPage();
    }
    
    // ----> Lógica para as páginas de autenticação (Login e Cadastro)
    if (path.endsWith('login.html') || path.endsWith('cadastro.html')) {
        if (typeof initializeAuth === 'function') {
            initializeAuth();
        }
    }

    // Dog Icon Hover Effect (força a transição toda vez)
    const dogLink = document.querySelector('a[href*="Cachorro"]');
    const dogIcon = dogLink?.querySelector('.dog-anim');

    if (dogLink && dogIcon) {
    dogLink.addEventListener('mouseenter', () => {
        dogIcon.classList.remove('hide-dog');
        dogIcon.classList.add('show-dog');
    });

    dogLink.addEventListener('mouseleave', () => {
        dogIcon.classList.remove('show-dog');
        dogIcon.classList.add('hide-dog');
    });
    }

});
