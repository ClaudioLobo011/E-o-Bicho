import legacyConfigSource from "../../scripts/core/config.js?raw";
import legacyUiSource from "../../scripts/core/ui.js?raw";

let isLegacyUiReady = false;
let isLegacyConfigReady = false;

function runLegacyConfigBootstrap(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (isLegacyConfigReady) {
    return;
  }

  if (window.API_CONFIG && typeof window.API_CONFIG === "object") {
    isLegacyConfigReady = true;
    return;
  }

  const normalizedSource = legacyConfigSource.replace(
    /const\s+API_CONFIG\s*=\s*/u,
    "window.API_CONFIG = window.API_CONFIG || "
  );

  try {
    const factory = new Function("window", normalizedSource);
    factory(window);
    isLegacyConfigReady = true;
  } catch (error) {
    console.error("Erro ao inicializar configuração legada:", error);
  }
}

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
  runLegacyConfigBootstrap();
  runLegacyUiBootstrap();
  isLegacyUiReady = true;
}

declare global {
  interface Window {
    basePath?: string;
    API_CONFIG?: Record<string, unknown> | undefined;
  }
}
