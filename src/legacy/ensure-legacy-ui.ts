import legacyConfigSource from "../../scripts/core/config.js?raw";
import legacyUiSource from "../../scripts/core/ui.js?raw";

let isLegacyUiReady = false;
let isLegacyConfigReady = false;

type LegacyConfig = Record<string, unknown> & {
  BASE_URL?: string;
  SERVER_URL?: string;
};

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return ["localhost", "127.0.0.1", "[::1]"].includes(normalized);
}

function safeParseUrl(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch (error) {
    console.warn("Não foi possível interpretar a URL de configuração do legado:", url, error);
    return null;
  }
}

function buildBaseFromServer(serverUrl: string, pathname: string): string {
  const server = safeParseUrl(serverUrl);
  if (!server) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${origin}${normalizedPath}`.replace(/\/$/, "");
  }
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${server.origin}${normalizedPath}`.replace(/\/$/, "");
}

function normalizeLegacyApiConfig(config: LegacyConfig): LegacyConfig {
  if (typeof window === "undefined") {
    return config;
  }

  const result: LegacyConfig = { ...config };
  const locationHostname = window.location.hostname;
  const isLocalEnvironment = isLoopbackHost(locationHostname);

  const rawServerUrl = typeof result.SERVER_URL === "string" ? result.SERVER_URL.trim() : "";
  const rawBaseUrl = typeof result.BASE_URL === "string" ? result.BASE_URL.trim() : "";

  const parsedServer = rawServerUrl ? safeParseUrl(rawServerUrl, window.location.origin) : null;

  if (!rawServerUrl || (!isLocalEnvironment && parsedServer && isLoopbackHost(parsedServer.hostname))) {
    result.SERVER_URL = window.location.origin;
  } else if (parsedServer) {
    result.SERVER_URL = parsedServer.origin;
  }

  const parsedBase = rawBaseUrl
    ? safeParseUrl(rawBaseUrl, result.SERVER_URL || window.location.origin)
    : null;

  if (!rawBaseUrl) {
    const serverOrigin = result.SERVER_URL || window.location.origin;
    result.BASE_URL = buildBaseFromServer(serverOrigin, "/api");
  } else if (!isLocalEnvironment && parsedBase && isLoopbackHost(parsedBase.hostname)) {
    const serverOrigin = result.SERVER_URL || window.location.origin;
    result.BASE_URL = buildBaseFromServer(serverOrigin, parsedBase.pathname || "/api");
  } else if (parsedBase) {
    result.BASE_URL = parsedBase.href.replace(/\/$/, "");
  }

  return result;
}

function runLegacyConfigBootstrap(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (isLegacyConfigReady) {
    return;
  }

  try {
    const defaultsFactory = new Function(
      `${legacyConfigSource}\nreturn typeof API_CONFIG !== 'undefined' ? API_CONFIG : {};`
    );
    const defaults = (defaultsFactory() as LegacyConfig) || {};
    const existing =
      typeof window.API_CONFIG === "object" && window.API_CONFIG
        ? (window.API_CONFIG as LegacyConfig)
        : {};
    const merged = { ...defaults, ...existing };
    window.API_CONFIG = normalizeLegacyApiConfig(merged);
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
