(function () {
  // Só roda quando a página está dentro de um iframe
  if (window.top === window) return;

  const send = (type, extra = {}) => {
    window.parent.postMessage({ source: 'eo-bicho', type, ...extra }, '*');
  };

  const MODAL_SELECTOR =
    '[role="dialog"][open], [role="dialog"].show, .modal.show, .modal[open], [data-modal-open="true"]';

  const computeModalExtent = () => {
    let maxBottom = 0;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

    const modals = Array.from(document.querySelectorAll(MODAL_SELECTOR));
    modals.forEach((modal) => {
      if (!modal || !modal.isConnected) return;

      const rect = modal.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      const styles = window.getComputedStyle(modal);
      if (!styles || styles.display === 'none' || styles.visibility === 'hidden') return;

      const marginTop = Number.parseFloat(styles.marginTop || '0') || 0;
      const marginBottom = Number.parseFloat(styles.marginBottom || '0') || 0;
      const top = rect.top + scrollY - marginTop;
      const bottom = rect.bottom + scrollY + marginBottom;

      maxBottom = Math.max(maxBottom, bottom, bottom - top);
    });

    return maxBottom ? Math.ceil(maxBottom + 16) : 0;
  };

  // Mede a altura total do documento
  const measure = () => {
    const d = document;
    const b = d.body;
    const e = d.documentElement;
    const docHeight = Math.max(
      e.scrollHeight, e.offsetHeight, e.clientHeight,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0
    );
    const modalExtent = computeModalExtent();
    return Math.max(docHeight, modalExtent);
  };

  const notifyResize = () => {
    send('TAB_CONTENT_RESIZE', { height: measure() });
  };

  // Observa crescimento/encolhimento do conteúdo
  const ro = new ResizeObserver(() => notifyResize());
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);

  // Detecta abertura/fechamento de modais (genérico: Bootstrap, headless, custom)
  const isOpen = () => !!document.querySelector(MODAL_SELECTOR);

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
