(function () {
  const root = document.querySelector('[data-admin-tabs-root]');
  if (!root) {
    return;
  }

  const tabList = root.querySelector('[data-admin-tab-list]');
  const panelContainer = root.querySelector('[data-admin-tab-panels]');
  if (!tabList || !panelContainer) {
    return;
  }

  const tabs = new Map();
  const hrefToId = new Map();
  const order = [];
  let activeId = null;
  let counter = 0;

  const BASE_TRIGGER_CLASSES = [
    'admin-tab-trigger',
    'inline-flex',
    'items-center',
    'gap-2',
    'rounded-lg',
    'border',
    'border-transparent',
    'bg-white',
    'px-3',
    'py-2',
    'text-xs',
    'font-semibold',
    'text-gray-600',
    'shadow-sm',
    'transition',
    'hover:bg-primary/10',
    'focus:outline-none',
    'focus:ring-2',
    'focus:ring-primary/20',
  ];

  const ACTIVE_TRIGGER_CLASSES = [
    'border-primary/30',
    'bg-primary/10',
    'text-primary',
    'shadow',
  ];

  const INACTIVE_TRIGGER_CLASSES = [
    'border-transparent',
    'bg-white',
    'text-gray-600',
    'shadow-sm',
  ];

  function applyTriggerState(trigger, isActive) {
    if (!trigger) return;

    ACTIVE_TRIGGER_CLASSES.forEach((cls) => {
      trigger.classList.toggle(cls, isActive);
    });

    INACTIVE_TRIGGER_CLASSES.forEach((cls) => {
      trigger.classList.toggle(cls, !isActive);
    });

    trigger.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  function updatePanels(targetId) {
    tabs.forEach((entry, id) => {
      const isActive = id === targetId;
      applyTriggerState(entry.trigger, isActive);
      if (entry.panel) {
        entry.panel.classList.toggle('hidden', !isActive);
      }
    });
  }

  function setActive(id) {
    const entry = tabs.get(id);
    if (!entry) return;

    activeId = id;
    updatePanels(id);

    const currentIndex = order.indexOf(id);
    if (currentIndex !== -1) {
      order.splice(currentIndex, 1);
    }
    order.push(id);

    if (entry.trigger) {
      entry.trigger.focus({ preventScroll: true });
    }
  }

  function ensureTabVisible(item) {
    if (!item) return;
    const containerRect = tabList.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    if (itemRect.right > containerRect.right) {
      const delta = itemRect.right - containerRect.right;
      tabList.scrollTo({ left: tabList.scrollLeft + delta + 24, behavior: 'smooth' });
    } else if (itemRect.left < containerRect.left) {
      const delta = containerRect.left - itemRect.left;
      tabList.scrollTo({ left: tabList.scrollLeft - delta - 24, behavior: 'smooth' });
    }
  }

  function normalizeHref(href) {
    try {
      const url = new URL(href, window.location.href);
      url.hash = '';
      url.searchParams.delete('embedded');
      const search = url.searchParams.toString();
      return `${url.pathname}${search ? `?${search}` : ''}`;
    } catch (err) {
      return null;
    }
  }

  function buildIframeSrc(href) {
    try {
      const url = new URL(href, window.location.href);
      url.hash = '';
      url.searchParams.set('embedded', '1');
      return `${url.pathname}${url.search}`;
    } catch (err) {
      return href;
    }
  }

  function createTabElements(label) {
    const safeLabel = label && label.trim() ? label.trim() : 'Nova aba';

    const item = document.createElement('div');
    item.className = 'flex items-center';
    item.dataset.tabItem = 'true';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    BASE_TRIGGER_CLASSES.forEach((cls) => trigger.classList.add(cls));
    trigger.dataset.tabTrigger = 'true';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'max-w-[12rem] truncate';
    labelSpan.textContent = safeLabel;
    trigger.appendChild(labelSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', `Fechar aba ${safeLabel}`);
    closeBtn.className = 'ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20';
    closeBtn.innerHTML = '<i class="fas fa-times text-[10px]"></i>';

    item.appendChild(trigger);
    item.appendChild(closeBtn);

    return { item, trigger, closeBtn, label: safeLabel };
  }

  function createIframePanel(id, href, label) {
    const panel = document.createElement('section');
    panel.id = `admin-tab-panel-${id}`;
    panel.dataset.tabPanel = 'true';
    panel.dataset.tabId = id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `admin-tab-trigger-${id}`);
    panel.className = 'admin-tab-panel hidden';

    const frameWrapper = document.createElement('div');
    frameWrapper.className = 'relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm';

    const loader = document.createElement('div');
    loader.className = 'absolute inset-0 flex items-center justify-center bg-white/80';
    loader.innerHTML = `
      <div class="flex items-center gap-2 text-sm text-gray-500">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
        Carregando "${label}"...
      </div>
    `;

    const iframe = document.createElement('iframe');
    iframe.className = 'h-[72vh] w-full border-0';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', label);
    iframe.src = buildIframeSrc(href);

    iframe.addEventListener('load', () => {
      loader.classList.add('hidden');
    }, { once: true });

    frameWrapper.appendChild(iframe);
    frameWrapper.appendChild(loader);
    panel.appendChild(frameWrapper);

    return { panel, iframe, loader };
  }

  function closeTab(id) {
    const entry = tabs.get(id);
    if (!entry || entry.locked) return;

    if (entry.item) entry.item.remove();
    if (entry.panel) entry.panel.remove();

    tabs.delete(id);
    if (entry.href) {
      hrefToId.delete(entry.href);
    }

    const idx = order.indexOf(id);
    if (idx !== -1) {
      order.splice(idx, 1);
    }

    if (activeId === id) {
      const fallback = order.length ? order[order.length - 1] : 'dashboard';
      if (tabs.has(fallback)) {
        setActive(fallback);
      } else {
        setActive('dashboard');
      }
    }
  }

  function openTab(href, label) {
    const normalized = normalizeHref(href);
    if (!normalized) {
      window.location.href = href;
      return;
    }

    if (!normalized.includes('/pages/admin/')) {
      window.location.href = normalized;
      return;
    }

    const existingId = hrefToId.get(normalized);
    if (existingId && tabs.has(existingId)) {
      setActive(existingId);
      ensureTabVisible(tabs.get(existingId).item);
      return;
    }

    const newId = `tab-${++counter}`;
    const { item, trigger, closeBtn, label: resolvedLabel } = createTabElements(label);
    item.dataset.tabId = newId;
    trigger.dataset.tabId = newId;
    trigger.id = `admin-tab-trigger-${newId}`;
    trigger.setAttribute('aria-controls', `admin-tab-panel-${newId}`);
    trigger.addEventListener('click', () => setActive(newId));

    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(newId);
    });

    tabList.appendChild(item);
    ensureTabVisible(item);

    const { panel } = createIframePanel(newId, href, resolvedLabel);
    panelContainer.appendChild(panel);

    const record = {
      id: newId,
      href: normalized,
      trigger,
      panel,
      item,
      closeBtn,
      locked: false,
    };

    tabs.set(newId, record);
    hrefToId.set(normalized, newId);
    order.push(newId);

    setActive(newId);
  }

  function registerDefaultTab() {
    const defaultItem = tabList.querySelector('[data-tab-item][data-tab-id="dashboard"]');
    const defaultTrigger = defaultItem ? defaultItem.querySelector('[data-tab-trigger]') : null;
    const defaultPanel = panelContainer.querySelector('[data-tab-panel][data-tab-id="dashboard"]');

    if (!defaultItem || !defaultTrigger || !defaultPanel) {
      return;
    }

    defaultTrigger.id = defaultTrigger.id || 'admin-tab-trigger-dashboard';
    defaultTrigger.addEventListener('click', () => setActive('dashboard'));

    const defaultHref = normalizeHref(window.location.pathname) || '/pages/admin.html';

    tabs.set('dashboard', {
      id: 'dashboard',
      href: defaultHref,
      trigger: defaultTrigger,
      panel: defaultPanel,
      item: defaultItem,
      locked: true,
    });

    hrefToId.set(defaultHref, 'dashboard');

    order.push('dashboard');
    setActive('dashboard');
  }

  registerDefaultTab();

  function shouldHandleLink(anchor) {
    if (!anchor) return false;
    if (anchor.target && anchor.target !== '_self') return false;
    if (anchor.getAttribute('download') !== null) return false;
    const href = anchor.getAttribute('href');
    if (!href || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    const normalized = normalizeHref(href);
    if (!normalized) return false;
    if (!normalized.includes('/pages/admin/')) return false;
    return true;
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest('a[href]');
    if (!anchor) return;

    if (!shouldHandleLink(anchor)) return;

    event.preventDefault();
    const href = anchor.getAttribute('href');
    const label = anchor.dataset.tabLabel || anchor.textContent.replace(/\s+/g, ' ').trim();
    openTab(href, label);
  });

  window.AdminTabs = {
    open(href, label) {
      openTab(href, label);
    },
    close(id) {
      closeTab(id);
    },
    setActive,
    get activeId() {
      return activeId;
    },
  };
})();
