(function () {
  // Só roda quando a página está dentro de um iframe
  if (window.top === window) return;

  const send = (type, extra = {}) => {
    window.parent.postMessage({ source: 'eo-bicho', type, ...extra }, '*');
  };

  const MODAL_SELECTOR =
    '[role="dialog"][open], [role="dialog"].show, .modal.show, .modal[open], [data-modal-open="true"]';

  const toNumber = (value) => Number.parseFloat(value || '0') || 0;

  const computeModalMetrics = () => {
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const modals = Array.from(document.querySelectorAll(MODAL_SELECTOR));

    let maxExtent = 0;
    let maxHeight = 0;

    modals.forEach((modal) => {
      if (!modal || !modal.isConnected) return;

      const rect = modal.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      const styles = window.getComputedStyle(modal);
      if (!styles || styles.display === 'none' || styles.visibility === 'hidden') return;

      const marginTop = toNumber(styles.marginTop);
      const marginBottom = toNumber(styles.marginBottom);

      const shell = modal.matches('.modal-shell')
        ? modal
        : modal.querySelector('.modal-shell');

      const top = rect.top + scrollY - marginTop;
      const modalHeight = Math.max(rect.height, modal.scrollHeight || 0) + marginTop + marginBottom;
      const modalBottom = top + modalHeight;

      maxExtent = Math.max(maxExtent, modalBottom);
      maxHeight = Math.max(maxHeight, modalHeight);

      if (shell) {
        const shellRect = shell.getBoundingClientRect();
        const shellStyles = window.getComputedStyle(shell);
        const shellMarginTop = toNumber(shellStyles.marginTop);
        const shellMarginBottom = toNumber(shellStyles.marginBottom);
        const shellHeight = Math.max(shellRect.height, shell.scrollHeight || 0) + shellMarginTop + shellMarginBottom;
        const shellTop = shellRect.top + scrollY - shellMarginTop;
        const shellBottom = shellTop + shellHeight;

        maxExtent = Math.max(maxExtent, shellBottom);
        maxHeight = Math.max(maxHeight, shellHeight);
      }
    });

    return {
      modalExtent: maxExtent ? Math.ceil(maxExtent + 16) : 0,
      modalHeight: maxHeight ? Math.ceil(maxHeight) : 0
    };
  };

  // Mede a altura total do documento
  const measure = () => {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const body = document.body;
    const scrollHeights = [];

    if (scrollingElement) {
      if (typeof scrollingElement.scrollHeight === 'number') {
        scrollHeights.push(scrollingElement.scrollHeight);
      }
      if (typeof scrollingElement.offsetHeight === 'number') {
        scrollHeights.push(scrollingElement.offsetHeight);
      }
    }

    if (body) {
      if (typeof body.scrollHeight === 'number') {
        scrollHeights.push(body.scrollHeight);
      }
      if (typeof body.offsetHeight === 'number') {
        scrollHeights.push(body.offsetHeight);
      }
    }

    const docHeight = scrollHeights.length ? Math.max(...scrollHeights) : 0;
    const { modalExtent, modalHeight } = computeModalMetrics();

    const height = Math.max(docHeight, modalExtent);

    return {
      height,
      docHeight,
      modalExtent,
      modalHeight
    };
  };

  const notifyResize = () => {
    const sizes = measure();
    send('TAB_CONTENT_RESIZE', sizes);
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
      const sizes = measure();
      if (open) send('MODAL_OPEN', sizes);
      else send('MODAL_CLOSE', sizes);
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
