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

    if (config.baseURL === '/mock') {
      return config;
    }

    if (BASE_URL === '/api' && import.meta.env.DEV) {
      return { ...config, baseURL: '/mock' };
    }

    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (error.config?.baseURL === '/mock') {
        const handler = mockHandlers.find((mock) => mock.method === error.config.method?.toUpperCase() && mock.test(error.config?.url ?? ''));
        if (handler) {
          const result = await handler.handler(error.config as AxiosRequestConfig);
          return { data: result, status: 200, statusText: 'OK', headers: {}, config: error.config };
        }
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
