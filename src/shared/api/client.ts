import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { STORAGE_KEYS } from '../lib/storage-migrations';
import { mockHandlers } from './mocks';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

function createClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: 10_000,
    headers: { 'Content-Type': 'application/json' }
  });

  instance.interceptors.request.use((config) => {
    const sessionRaw = window.localStorage.getItem(STORAGE_KEYS.session);
    if (sessionRaw) {
      try {
        const session = JSON.parse(sessionRaw);
        if (session?.token) {
          config.headers = config.headers ?? {};
          config.headers.Authorization = `Bearer ${session.token}`;
        }
      } catch (error) {
        console.warn('[api] sessão inválida', error);
      }
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalConfig = error.config as (AxiosRequestConfig & { __isMockFallback?: boolean }) | undefined;

      if (!originalConfig || originalConfig.__isMockFallback) {
        return Promise.reject(error);
      }

      const method = originalConfig.method?.toUpperCase() ?? 'GET';
      const url = originalConfig.url ?? '';

      const handler = mockHandlers.find((mock) => mock.method === method && mock.test(url));

      if (handler && import.meta.env.DEV) {
        originalConfig.__isMockFallback = true;
        const result = await handler.handler(originalConfig);
        return { data: result, status: 200, statusText: 'OK', headers: {}, config: originalConfig };
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

export const apiClient = createClient();

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.get<T>(url, config);
  return response.data;
}

export async function apiPost<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.post<T>(url, data, config);
  return response.data;
}

export async function apiPut<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.put<T>(url, data, config);
  return response.data;
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.delete<T>(url, config);
  return response.data;
}
