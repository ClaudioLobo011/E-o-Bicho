(function () {
  // Só roda quando a página está dentro de um iframe
  if (window.top === window) return;

  const send = (type, extra = {}) => {
    window.parent.postMessage({ source: 'eo-bicho', type, ...extra }, '*');
  };

  // Mede a altura total do documento
  const measure = () => {
    const d = document;
    const b = d.body;
    const e = d.documentElement;
    return Math.max(
      e.scrollHeight, e.offsetHeight, e.clientHeight,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0
    );
  };

  const notifyResize = () => {
    send('TAB_CONTENT_RESIZE', { height: measure() });
  };

  // Observa crescimento/encolhimento do conteúdo
  const ro = new ResizeObserver(() => notifyResize());
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);

  // Detecta abertura/fechamento de modais (genérico: Bootstrap, headless, custom)
  const isOpen = () =>
    !!document.querySelector(
      '[role="dialog"][open], [role="dialog"].show, .modal.show, .modal[open], [data-modal-open="true"]'
    );

  let lastOpen = false;
  const mo = new MutationObserver(() => {
    const open = isOpen();
    if (open !== lastOpen) {
      lastOpen = open;
      if (open) send('MODAL_OPEN', { height: measure() });
      else send('MODAL_CLOSE', { height: measure() });
    }
    notifyResize();
  });

  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'open', 'data-modal-open', 'style']
  });

  // Primeira medição
  window.addEventListener('load', notifyResize);
  document.addEventListener('DOMContentLoaded', notifyResize);
})();
