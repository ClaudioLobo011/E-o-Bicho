const DEFAULTS = {
  title: 'Confirmação',
  message: 'Deseja prosseguir?',
  confirmText: 'Confirmar',
  cancelText: 'Cancelar',
};

function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch (error) {
    console.error('confirmWithModal callback error', error);
  }
}

export async function confirmWithModal(options = {}) {
  const {
    title = DEFAULTS.title,
    message = DEFAULTS.message,
    confirmText = DEFAULTS.confirmText,
    cancelText = DEFAULTS.cancelText,
    onConfirm,
    onCancel,
    onFinally,
  } = options || {};

  const runCallbacks = (didConfirm) => {
    if (didConfirm) {
      safeCall(onConfirm, didConfirm);
    } else {
      safeCall(onCancel, didConfirm);
    }
    safeCall(onFinally, didConfirm);
  };

  const hasWindow = typeof window !== 'undefined';

  if (hasWindow && typeof window.showModal === 'function') {
    return new Promise((resolve) => {
      window.showModal({
        title,
        message,
        confirmText,
        cancelText,
        onConfirm: () => {
          runCallbacks(true);
          resolve(true);
        },
        onCancel: () => {
          runCallbacks(false);
          resolve(false);
        },
      });
    });
  }

  if (hasWindow && typeof window.ensureModalReady === 'function') {
    try {
      const modal = await window.ensureModalReady(true);
      if (modal) {
        const titleEl = modal.querySelector('#confirm-modal-title') || modal.querySelector('h2');
        const messageEl = modal.querySelector('#confirm-modal-message');
        const confirmBtn = modal.querySelector('#confirm-modal-confirm-btn') || modal.querySelector('[data-confirm]');
        const cancelBtn = modal.querySelector('#confirm-modal-cancel-btn') || modal.querySelector('[data-cancel]');

        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (confirmBtn) confirmBtn.textContent = confirmText || DEFAULTS.confirmText;
        if (cancelBtn) cancelBtn.textContent = cancelText || DEFAULTS.cancelText;

        const previousActive = document.activeElement;
        const previousTabIndex = modal.getAttribute('tabindex');
        const previousAriaHidden = modal.getAttribute('aria-hidden');

        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.remove('hidden');

        return new Promise((resolve) => {
          function cleanup() {
            modal.classList.add('hidden');
            if (previousAriaHidden === null) {
              modal.removeAttribute('aria-hidden');
            } else {
              modal.setAttribute('aria-hidden', previousAriaHidden);
            }
            if (previousTabIndex === null) {
              modal.removeAttribute('tabindex');
            } else {
              modal.setAttribute('tabindex', previousTabIndex);
            }
            confirmBtn?.removeEventListener('click', handleConfirm);
            cancelBtn?.removeEventListener('click', handleCancel);
            modal.removeEventListener('click', handleBackdropClick);
            modal.removeEventListener('keydown', handleKeydown);
            if (previousActive && typeof previousActive.focus === 'function') {
              try {
                previousActive.focus();
              } catch (_) {}
            }
          }

          function handleConfirm(event) {
            if (event) event.preventDefault();
            cleanup();
            runCallbacks(true);
            resolve(true);
          }

          function handleCancel(event) {
            if (event) event.preventDefault();
            cleanup();
            runCallbacks(false);
            resolve(false);
          }

          function handleBackdropClick(event) {
            if (event.target === modal) {
              handleCancel(event);
            }
          }

          function handleKeydown(event) {
            if (event.key === 'Escape') {
              event.preventDefault();
              handleCancel(event);
              return;
            }

            if (event.key === 'Tab') {
              const focusables = [confirmBtn, cancelBtn].filter((el) => el && typeof el.focus === 'function');
              if (!focusables.length) return;
              const currentIndex = focusables.indexOf(document.activeElement);
              if (event.shiftKey) {
                if (currentIndex <= 0) {
                  focusables[focusables.length - 1].focus();
                  event.preventDefault();
                }
              } else if (currentIndex === focusables.length - 1) {
                focusables[0].focus();
                event.preventDefault();
              }
            }
          }

          confirmBtn?.addEventListener('click', handleConfirm);
          cancelBtn?.addEventListener('click', handleCancel);
          modal.addEventListener('click', handleBackdropClick);
          modal.addEventListener('keydown', handleKeydown);

          const focusTarget = confirmBtn || cancelBtn || modal;
          requestAnimationFrame(() => {
            try {
              focusTarget.focus({ preventScroll: true });
            } catch (_) {}
          });
        });
      }
    } catch (error) {
      console.error('confirmWithModal fallback failed', error);
    }
  }

  console.warn('confirmWithModal: modal component indisponível; prosseguindo automaticamente.');
  runCallbacks(true);
  return true;
}

if (typeof window !== 'undefined' && typeof window.confirmWithModal !== 'function') {
  window.confirmWithModal = confirmWithModal;
}

export default confirmWithModal;
