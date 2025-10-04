import legacyPdvSource from "../../scripts/admin/admin-pdv.js?raw";
import { ensureLegacyAuthSession } from "./ensure-legacy-auth";
import { ensureLegacyUi } from "./ensure-legacy-ui";

type TrackedListener = {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

const scheduleMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (callback: () => void) => {
        Promise.resolve()
          .then(callback)
          .catch((error) => {
            console.error("Erro ao agendar microtask para o PDV legado:", error);
          });
      };

function invokeDomContentLoadedListener(
  listener: EventListenerOrEventListenerObject,
  target: EventTarget
) {
  const event = new Event("DOMContentLoaded", { bubbles: false, cancelable: false });

  if (typeof listener === "function") {
    listener.call(target, event);
    return;
  }

  if (listener && typeof (listener as EventListenerObject).handleEvent === "function") {
    (listener as EventListenerObject).handleEvent.call(target, event);
  }
}

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

    const result = originalAddEventListener.call(this, type, listener, options);

    const isDomContentLoadedListener =
      String(type).toLowerCase() === "domcontentloaded" &&
      this === document &&
      document.readyState !== "loading" &&
      Boolean(listener);

    if (isDomContentLoadedListener) {
      // Garante que o script legado inicialize mesmo quando injetado após o DOM pronto.
      scheduleMicrotask(() => {
        if (listener) {
          try {
            invokeDomContentLoadedListener(listener, this);
          } catch (error) {
            console.error("Erro ao disparar DOMContentLoaded para o PDV legado:", error);
          }
        }
      });
    }

    return result;
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

  ensureLegacyAuthSession();
  ensureLegacyUi();

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
