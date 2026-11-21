(() => {
  'use strict';
  const body = document.body;
  const main = body.querySelector(':scope > main');
  if (!body.classList.contains('responsive-workspace') || !main) return;
  const isAdminV2 = body.classList.contains('admin-v2');
  if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
  const nav = document.createElement('nav');
  nav.className = 'workspace-section-nav';
  nav.setAttribute('aria-label', 'Seções da tela');
  nav.hidden = true;
  const label = document.createElement('label');
  label.htmlFor = 'workspace-section-select';
  label.textContent = 'Ir para';
  const select = document.createElement('select');
  select.id = 'workspace-section-select';
  nav.append(label, select);
  main.before(nav);
  let sections = [];
  let signature = '';
  let frame = 0;
  const tableControls = new Map();
  const tableObserver = isAdminV2 ? new ResizeObserver(schedule) : null;

  function visible(element) { return element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'; }
  function addTableControls(region, table) {
    const tools = document.createElement('div');
    tools.className = 'admin-v2-table-controls';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Navegar pelas colunas da tabela');

    function createButton(direction, icon, label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = icon;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.addEventListener('click', () => {
        region.scrollBy({ left: direction * Math.max(100, region.clientWidth * .8), behavior: 'instant' });
      });
      return button;
    }

    const previous = createButton(-1, '‹', 'Colunas anteriores');
    const next = createButton(1, '›', 'Próximas colunas');
    tools.append(previous, next);
    region.before(tools);
    function updateControls() {
      const overflow = region.scrollWidth - region.clientWidth;
      tools.hidden = overflow <= 2 || !visible(region);
      previous.disabled = region.scrollLeft <= 1;
      next.disabled = region.scrollLeft >= overflow - 1;
    }

    region.addEventListener('scroll', updateControls, { passive: true });
    tableObserver.observe(region);
    tableObserver.observe(table);
    return { table, tools, updateControls };
  }

  function refreshTableControls() {
    for (const [region, controls] of tableControls) {
      if (region.isConnected && controls.table.parentElement === region) continue;
      tableObserver.unobserve(region);
      tableObserver.unobserve(controls.table);
      controls.tools.remove();
      region.removeEventListener('scroll', controls.updateControls);
      tableControls.delete(region);
    }

    for (const region of body.querySelectorAll('[data-admin-v2-table], [data-admin-v2-modal] [data-admin-table-scroll]')) {
      const table = region.querySelector(':scope > table');
      if (!table) continue;
      if (!tableControls.has(region)) {
        if (!region.hasAttribute('tabindex')) region.tabIndex = 0;
        if (!region.hasAttribute('role')) region.setAttribute('role', 'region');
        if (!region.hasAttribute('aria-label')) region.setAttribute('aria-label', table.getAttribute('aria-label') || 'Tabela de resultados');
        tableControls.set(region, addTableControls(region, table));
      }
      tableControls.get(region).updateControls();
    }
  }

  function refresh() {
    frame = 0;
    // Only annotate existing table containers; never move fields or replace their DOM.
    main.querySelectorAll('table').forEach(table => {
      const parent = table.parentElement;
      if (parent.children.length !== 1 || parent === main || parent.closest('[role=dialog]')) return;
      if (!parent.classList.contains('responsive-table-region')) {
        parent.classList.add('responsive-table-region');
        parent.tabIndex = 0;
        parent.setAttribute('role', 'region');
        parent.setAttribute('aria-label', table.getAttribute('aria-label') || 'Tabela de resultados');
      }
    });
    if (isAdminV2) refreshTableControls();
    const sectionSelector = isAdminV2 ? '[data-admin-v2-section]' : 'h2';
    sections = [...main.querySelectorAll(sectionSelector)].filter(h => visible(h) && !h.closest('[role=dialog],.fixed,[aria-modal=true]'));
    const getSectionName = h => h.getAttribute('data-admin-v2-section') || h.textContent.trim();
    const nextSignature = sections.map(getSectionName).join('|');
    if (nextSignature !== signature) {
      signature = nextSignature;
      select.replaceChildren();
      const start = document.createElement('option'); start.value = ''; start.textContent = isAdminV2 ? 'Início da tela' : 'Selecionar seção'; select.append(start);
      sections.forEach((h,index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = getSectionName(h); select.append(option); });
    }
    const hideNavigation = sections.length < (isAdminV2 ? 1 : 2) || main.classList.contains('commission-page');
    if (nav.hidden !== hideNavigation) nav.hidden = hideNavigation;
    let bottom = 0;
    body.querySelectorAll('[id]').forEach(element => {
      if (!visible(element)) return;
      const style = getComputedStyle(element);
      if (style.position !== 'fixed' || style.bottom === 'auto' || element.closest('[role=dialog],[aria-modal=true]')) return;
      const rect = element.getBoundingClientRect();
      if (rect.width > innerWidth * .55 && rect.height < innerHeight * .4 && Math.abs(rect.bottom - innerHeight) < 3) bottom = Math.max(bottom, rect.height);
    });
    const value = `${Math.ceil(bottom)}px`;
    if (body.style.getPropertyValue('--workspace-actions-height') !== value) body.style.setProperty('--workspace-actions-height', value);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(refresh); }
  select.addEventListener('change', () => {
    if (!isAdminV2 && select.value === '') return;
    const target = select.value === '' ? main : sections[Number(select.value)];
    if (!target) return;
    if (target === main) main.scrollTo({ top: 0, behavior: 'auto' });
    else target.scrollIntoView({ block: 'start', behavior: 'auto' });
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  });
  // Validation must reveal the real control, including fields below the fold.
  main.addEventListener('invalid', event => event.target.scrollIntoView({ block: 'center', behavior: 'auto' }), true);
  new MutationObserver(schedule).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  schedule();
})();
