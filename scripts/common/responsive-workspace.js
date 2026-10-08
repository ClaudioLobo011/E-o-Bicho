(() => {
  'use strict';
  const body = document.body;
  const main = body.querySelector(':scope > main');
  if (!body.classList.contains('responsive-workspace') || !main) return;
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
  function visible(element) { return element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'; }
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
    sections = [...main.querySelectorAll('h2')].filter(h => visible(h) && !h.closest('[role=dialog],.fixed,[aria-modal=true]'));
    const nextSignature = sections.map(h => h.textContent.trim()).join('|');
    if (nextSignature !== signature) {
      signature = nextSignature;
      select.replaceChildren();
      const start = document.createElement('option'); start.value = ''; start.textContent = 'Selecionar seção'; select.append(start);
      sections.forEach((h,index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = h.textContent.trim(); select.append(option); });
    }
    const hideNavigation = sections.length < 2 || main.classList.contains('commission-page');
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
    if (select.value === '') return;
    const target = sections[Number(select.value)];
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
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
