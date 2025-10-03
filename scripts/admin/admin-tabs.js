(function () {
  const root = document.querySelector('[data-admin-tabs-root]');
  if (!root) {
    return;
  }

  const pendingOpenCommands = [];
  const winToIframe = new Map();

  if (!window.AdminTabs || typeof window.AdminTabs.open !== 'function') {
    window.AdminTabs = {
      open(href, label) {
        pendingOpenCommands.push([href, label]);
      },
      close() {},
      setActive() {},
      get activeId() {
        return null;
      },
    };
  }

  let initialized = false;

  const STORAGE_KEY = 'admin-tab-state';
  let isRestoringState = false;

  function bootstrap(tabList, panelContainer) {
    const tabs = new Map();
    const hrefToId = new Map();
    const order = [];
    let activeId = null;
    let counter = 0;
    let persistReady = false;

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

      persistState();
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

    function setupIframeAutoHeight(iframe, cleanupFns, frameWrapper) {
      if (!iframe) return;

      const resize = () => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          const win = iframe.contentWindow;
          if (!doc || !win) {
            return;
          }

          const html = doc.documentElement;
          const body = doc.body;

          const measurements = [
            body?.scrollHeight,
            body?.offsetHeight,
            html?.clientHeight,
            html?.scrollHeight,
            html?.offsetHeight,
          ].filter((value) => typeof value === 'number');

          const targetHeight = measurements.length ? Math.max(...measurements) : 0;

          if (Number.isFinite(targetHeight) && targetHeight > 0) {
            iframe.style.height = `${targetHeight}px`;
          }
        } catch (err) {
          // Ignore cross-origin issues or transient access errors.
        }
      };

      const detachFns = [];

      const attachObservers = () => {
        resize();

        try {
          const win = iframe.contentWindow;
          const doc = win?.document;

          if (!win || !doc) {
            return;
          }

          if (frameWrapper) {
            frameWrapper.style.minHeight = '0px';
          }

          if (typeof win.ResizeObserver === 'function') {
            const resizeObserver = new win.ResizeObserver(() => resize());
            resizeObserver.observe(doc.documentElement);
            if (doc.body) {
              resizeObserver.observe(doc.body);
            }
            detachFns.push(() => resizeObserver.disconnect());
          } else {
            const intervalId = win.setInterval(() => resize(), 500);
            detachFns.push(() => win.clearInterval(intervalId));
          }

          if (typeof win.MutationObserver === 'function') {
            const mutationObserver = new win.MutationObserver(() => resize());
            mutationObserver.observe(doc.documentElement, {
              attributes: true,
              childList: true,
              subtree: true,
            });
            detachFns.push(() => mutationObserver.disconnect());
          }
        } catch (err) {
          // Ignore ResizeObserver failures when the iframe navigates away.
        }
      };

      const loadHandler = () => {
        attachObservers();
      };

      iframe.addEventListener('load', loadHandler);

      cleanupFns.push(() => iframe.removeEventListener('load', loadHandler));
      cleanupFns.push(() => {
        while (detachFns.length) {
          const fn = detachFns.pop();
          try {
            fn();
          } catch (err) {
            // noop
          }
        }
      });

      try {
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
          attachObservers();
        }
      } catch (err) {
        // Ignore access errors if the iframe is still loading.
      }
    }

    function createIframePanel(id, href, label) {
      const panel = document.createElement('section');
      panel.id = `admin-tab-panel-${id}`;
      panel.dataset.tabPanel = 'true';
      panel.dataset.tabId = id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `admin-tab-trigger-${id}`);
      panel.className = 'admin-tab-panel hidden';
      panel.dataset.embeddedPanel = 'true';

      const frameWrapper = document.createElement('div');
      frameWrapper.className = 'relative w-full admin-tab-iframe-wrapper';
      frameWrapper.style.display = 'block';
      frameWrapper.style.minHeight = '480px';

      const loader = document.createElement('div');
      loader.className = 'absolute inset-0 flex items-center justify-center bg-white/80';
      loader.innerHTML = `
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <span class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
          Carregando "${label}"...
        </div>
      `;

      const iframe = document.createElement('iframe');
      iframe.className = 'admin-tab-iframe';
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('title', label);
      iframe.style.width = '100%';
      iframe.style.height = '0px';
      iframe.dataset.autoHeight = 'true';
      iframe.src = buildIframeSrc(href);

      iframe.addEventListener('load', () => {
        loader.classList.add('hidden');
        frameWrapper.style.minHeight = '0px';
        if (iframe.contentWindow) {
          winToIframe.set(iframe.contentWindow, iframe);
        }
      }, { once: true });

      iframe.addEventListener('load', () => {
        if (iframe.contentWindow) {
          winToIframe.set(iframe.contentWindow, iframe);
        }
      });

      frameWrapper.appendChild(iframe);
      frameWrapper.appendChild(loader);
      panel.appendChild(frameWrapper);

      return { panel, iframe, loader, frameWrapper };
    }

    function closeTab(id) {
      const entry = tabs.get(id);
      if (!entry || entry.locked) return;

      if (entry.item) entry.item.remove();
      if (entry.panel) entry.panel.remove();

      if (entry.iframe && entry.iframe.contentWindow) {
        winToIframe.delete(entry.iframe.contentWindow);
      }

      if (entry.cleanupFns && Array.isArray(entry.cleanupFns)) {
        entry.cleanupFns.forEach((fn) => {
          try {
            fn();
          } catch (err) {
            // noop
          }
        });
      }

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
        } else if (tabs.has('dashboard')) {
          setActive('dashboard');
        }
      }

      persistState();
    }

    function isTabEligible(pathname) {
      if (!pathname) return false;
      const allowedPrefixes = ['/pages/admin/', '/pages/funcionarios/'];
      return allowedPrefixes.some((prefix) => pathname.startsWith(prefix));
    }

    function computeAvailablePanelHeight() {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const tabListElement = root.querySelector('[data-admin-tab-list]');
      const header = tabListElement ? tabListElement.closest('header') : null;
      const headerRect = header ? header.getBoundingClientRect() : { bottom: 0, top: 0 };
      const rootRect = root.getBoundingClientRect();
      const offsetTop = headerRect.bottom - rootRect.top;
      const available = viewportHeight - offsetTop - 16; // keep a small breathing space below the header
      const MIN_PANEL_HEIGHT = 480;
      return Math.max(available, MIN_PANEL_HEIGHT);
    }

    let pendingHeightUpdate = null;

    function applyPanelHeights() {
      const available = computeAvailablePanelHeight();
      if (!Number.isFinite(available) || available <= 0) {
        return;
      }

      panelContainer.style.minHeight = `${available}px`;

      tabs.forEach((entry) => {
        if (entry.panel) {
          entry.panel.style.minHeight = `${available}px`;
        }

        if (entry.iframe) {
          if (entry.iframe.dataset.autoHeight === 'true') {
            entry.iframe.style.minHeight = '0px';
          } else {
            entry.iframe.style.minHeight = `${available}px`;
          }
        }
      });
    }

    function queuePanelHeightUpdate() {
      if (pendingHeightUpdate !== null) {
        cancelAnimationFrame(pendingHeightUpdate);
      }

      pendingHeightUpdate = requestAnimationFrame(() => {
        pendingHeightUpdate = null;
        applyPanelHeights();
      });
    }

    window.addEventListener('message', (ev) => {
      const data = ev.data || {};
      if (data?.source !== 'eo-bicho') return;

      const iframe = winToIframe.get(ev.source);
      if (!iframe) return;

      const panel = iframe.closest('.admin-tab-panel') || iframe.parentElement;

      const minAvail = () => {
        try {
          return typeof computeAvailablePanelHeight === 'function'
            ? computeAvailablePanelHeight()
            : (window.innerHeight - 120);
        } catch (err) {
          return window.innerHeight - 120;
        }
      };

      const setH = (h) => {
        const raw = Number.isFinite(h) ? Math.ceil(h) : 0;
        // Add a tiny clearance so shadows/borders from fixed modals are not clipped.
        const EXTRA_CLEARANCE = 16;
        const height = Math.max(raw + EXTRA_CLEARANCE, minAvail());
        const value = `${height}px`;
        iframe.style.minHeight = value;
        iframe.style.height = value;
      };

      switch (data.type) {
        case 'MODAL_OPEN':
          panel?.classList.add('modal-open');
          setH(data.height);
          break;
        case 'MODAL_CLOSE':
          panel?.classList.remove('modal-open');
          iframe.style.minHeight = '';
          iframe.style.height = '';
          if (typeof applyPanelHeights === 'function') {
            applyPanelHeights();
          }
          break;
        case 'TAB_CONTENT_RESIZE':
          setH(data.height);
          break;
        default:
          break;
      }
    });

    const tabHeaderElement = root.querySelector('[data-admin-tab-list]');
    let headerResizeObserver = null;
    if (typeof ResizeObserver === 'function' && tabHeaderElement) {
      const header = tabHeaderElement.closest('header');
      if (header) {
        headerResizeObserver = new ResizeObserver(() => queuePanelHeightUpdate());
        headerResizeObserver.observe(header);
      }
    }

    window.addEventListener('resize', queuePanelHeightUpdate);

    function openTab(href, label) {
      const normalized = normalizeHref(href);
      if (!normalized) {
        window.location.href = href;
        return;
      }

      if (!isTabEligible(normalized)) {
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

      const { panel, iframe, frameWrapper } = createIframePanel(newId, href, resolvedLabel);
      panelContainer.appendChild(panel);

      const record = {
        id: newId,
        href: normalized,
        trigger,
        panel,
        item,
        closeBtn,
        iframe,
        frameWrapper,
        locked: false,
        cleanupFns: [],
        label: resolvedLabel,
      };

      tabs.set(newId, record);
      hrefToId.set(normalized, newId);
      order.push(newId);

      setActive(newId);
      setupIframeAutoHeight(iframe, record.cleanupFns, frameWrapper);
      queuePanelHeightUpdate();
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
        label: (defaultTrigger.textContent || '').replace(/\s+/g, ' ').trim() || 'Painel Principal',
      });

      hrefToId.set(defaultHref, 'dashboard');

      order.push('dashboard');
      setActive('dashboard');
    }

    function readPersistedState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.tabs)) return null;
        return parsed;
      } catch (err) {
        return null;
      }
    }

    function persistState() {
      if (isRestoringState || !persistReady) return;
      try {
        const openTabs = order
          .map((id) => tabs.get(id))
          .filter((entry) => entry && !entry.locked && entry.href)
          .map((entry) => ({
            href: entry.href,
            label: entry.label || (entry.trigger ? entry.trigger.textContent.replace(/\s+/g, ' ').trim() : ''),
          }));

        const activeEntry = tabs.get(activeId);
        const payload = {
          tabs: openTabs,
          activeHref: activeEntry && !activeEntry.locked ? activeEntry.href : null,
          timestamp: Date.now(),
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        // Ignore storage errors (e.g., private mode or quota exceeded).
      }
    }

    function restoreState() {
      const state = readPersistedState();
      if (!state || !Array.isArray(state.tabs) || !state.tabs.length) {
        return;
      }

      isRestoringState = true;
      try {
        state.tabs.forEach((tab) => {
          if (!tab || !tab.href) return;
          const label = tab.label || 'Nova aba';
          openTab(tab.href, label);
        });

        if (state.activeHref) {
          const normalizedActive = normalizeHref(state.activeHref);
          if (normalizedActive) {
            const activeRestoredId = hrefToId.get(normalizedActive);
            if (activeRestoredId && tabs.has(activeRestoredId)) {
              setActive(activeRestoredId);
              ensureTabVisible(tabs.get(activeRestoredId).item);
            }
          }
        }
      } finally {
        isRestoringState = false;
      }
    }

    registerDefaultTab();
    queuePanelHeightUpdate();
    restoreState();
    persistReady = true;
    persistState();

    if (pendingOpenCommands.length) {
      const queued = pendingOpenCommands.splice(0, pendingOpenCommands.length);
      queued.forEach(([href, label]) => openTab(href, label));
      queuePanelHeightUpdate();
    }

    function shouldHandleLink(anchor) {
      if (!anchor) return false;
      if (anchor.target && anchor.target !== '_self') return false;
      if (anchor.getAttribute('download') !== null) return false;
      const href = anchor.getAttribute('href');
      if (!href || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
      const normalized = normalizeHref(href);
      if (!normalized) return false;
      if (!isTabEligible(normalized)) return false;
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

    window.addEventListener('beforeunload', () => {
      persistState();
    });
  }

  function tryInitialize() {
    if (initialized) {
      return true;
    }

    const tabList = root.querySelector('[data-admin-tab-list]');
    const panelContainer = root.querySelector('[data-admin-tab-panels]');
    if (!tabList || !panelContainer) {
      return false;
    }

    initialized = true;
    bootstrap(tabList, panelContainer);
    return true;
  }

  if (!tryInitialize()) {
    const observer = new MutationObserver(() => {
      if (tryInitialize()) {
        observer.disconnect();
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  }
})();
