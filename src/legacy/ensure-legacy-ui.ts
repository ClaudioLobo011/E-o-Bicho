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
