import legacyUiSource from "../../scripts/core/ui.js?raw";

let isLegacyUiReady = false;

function runLegacyUiBootstrap(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if (typeof window.basePath !== "string") {
    window.basePath = "/";
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const factory = new Function("window", "document", legacyUiSource);
    factory(window, document);
  } catch (error) {
    console.error("Erro ao inicializar utilitários legados de UI:", error);
  }
}

export function ensureLegacyUi(): void {
  if (isLegacyUiReady) {
    return;
  }
  runLegacyUiBootstrap();
  isLegacyUiReady = true;
}

declare global {
  interface Window {
    basePath?: string;
  }
}
