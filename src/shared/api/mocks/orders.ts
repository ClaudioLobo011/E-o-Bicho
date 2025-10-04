import { AxiosRequestConfig } from 'axios';
import { orders } from './data';

export const ordersMock = [
  {
    method: 'GET' as const,
    test: (url: string) => url === '/orders',
    handler: async (config: AxiosRequestConfig) => {
      const token = config.headers?.Authorization?.toString().replace('Bearer ', '');
      if (!token) throw new Error('Sessão inválida');
      return orders;
    }
  }
];
