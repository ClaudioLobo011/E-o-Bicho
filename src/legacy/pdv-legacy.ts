import legacyPdvSource from "../../scripts/admin/admin-pdv.js?raw";

type TrackedListener = {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

declare global {
  interface Window {
    __LEGACY_PDV_CLEANUP?: () => void;
  }
}

function bootstrapLegacyPdv(): () => void {
  const trackedListeners: TrackedListener[] = [];
  const originalAddEventListener = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (listener) {
      trackedListeners.push({
        target: this,
        type: String(type),
        listener,
        options
      });
    }

    return originalAddEventListener.call(this, type, listener, options);
  };

  let scriptCleanup: (() => void) | null = null;

  try {
    const factory = new Function(
      "window",
      "document",
      "API_CONFIG",
      `
        (function () {
          ${legacyPdvSource}
        }).call(window);
        return typeof window.__LEGACY_PDV_CLEANUP === "function" ? window.__LEGACY_PDV_CLEANUP : null;
      `
    );

    const maybeCleanup = factory(window, window.document, window.API_CONFIG);
    if (typeof maybeCleanup === "function") {
      scriptCleanup = maybeCleanup;
    }
  } catch (error) {
    console.error("Erro ao inicializar PDV legado:", error);
  } finally {
    EventTarget.prototype.addEventListener = originalAddEventListener;
  }

  return () => {
    try {
      scriptCleanup?.();
    } catch (error) {
      console.error("Erro ao executar limpeza do PDV legado:", error);
    }

    if (typeof window !== "undefined") {
      window.__LEGACY_PDV_CLEANUP = undefined;
    }

    for (let index = trackedListeners.length - 1; index >= 0; index -= 1) {
      const { target, type, listener, options } = trackedListeners[index];
      try {
        target.removeEventListener(type, listener, options);
      } catch (error) {
        console.error("Erro ao remover listener do PDV legado:", error);
      }
    }
  };
}

let activeCleanup: (() => void) | null = null;

export function initializeLegacyPdvPage() {
  if (typeof window === "undefined") {
    return () => {};
  }

  activeCleanup?.();

  let disposed = false;
  activeCleanup = bootstrapLegacyPdv();

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    activeCleanup?.();
    activeCleanup = null;
  };
}
