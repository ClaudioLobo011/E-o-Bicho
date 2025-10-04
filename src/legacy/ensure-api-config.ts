import { useEffect } from "react";

type LegacyApiConfig = {
  SERVER_URL: string;
  BASE_URL: string;
  ADMIN_EMAIL?: string;
};

declare global {
  interface Window {
    API_CONFIG?: LegacyApiConfig;
  }
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";
const DEFAULT_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? `${DEFAULT_SERVER_URL.replace(/\/$/, "")}/api`;
const DEFAULT_ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL ?? "claudio.lobo@lobosti.com.br";

function mergeConfig(current: LegacyApiConfig | undefined): LegacyApiConfig {
  if (!current) {
    return {
      SERVER_URL: DEFAULT_SERVER_URL,
      BASE_URL: DEFAULT_BASE_URL,
      ADMIN_EMAIL: DEFAULT_ADMIN_EMAIL
    };
  }

  return {
    SERVER_URL: current.SERVER_URL || DEFAULT_SERVER_URL,
    BASE_URL: current.BASE_URL || DEFAULT_BASE_URL,
    ADMIN_EMAIL: current.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL
  };
}

export function ensureLegacyApiConfig(): LegacyApiConfig {
  if (typeof window === "undefined") {
    return {
      SERVER_URL: DEFAULT_SERVER_URL,
      BASE_URL: DEFAULT_BASE_URL,
      ADMIN_EMAIL: DEFAULT_ADMIN_EMAIL
    };
  }

  const merged = mergeConfig(window.API_CONFIG);
  window.API_CONFIG = merged;
  return merged;
}

export function useLegacyApiConfig(): LegacyApiConfig {
  useEffect(() => {
    ensureLegacyApiConfig();
  }, []);

  return ensureLegacyApiConfig();
}
