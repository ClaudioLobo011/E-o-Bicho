import { AxiosRequestConfig } from 'axios';
import { usersWithSessions } from './data';

export const accountMock = [
  {
    method: 'GET' as const,
    test: (url: string) => url === '/account/me',
    handler: async (config: AxiosRequestConfig) => {
      const token = config.headers?.Authorization?.toString().replace('Bearer ', '');
      const user = usersWithSessions.find((item) => item.token === token);
      if (!user) throw new Error('Sessão expirada');
      return user;
    }
  },
  {
    method: 'PUT' as const,
    test: (url: string) => url === '/account/me',
    handler: async (config: AxiosRequestConfig) => {
      const token = config.headers?.Authorization?.toString().replace('Bearer ', '');
      const userIndex = usersWithSessions.findIndex((item) => item.token === token);
      if (userIndex === -1) throw new Error('Sessão expirada');

      const payload = JSON.parse(config.data as string);
      usersWithSessions[userIndex] = {
        ...usersWithSessions[userIndex],
        ...payload,
        updatedAt: new Date().toISOString()
      };

      return usersWithSessions[userIndex];
    }
  }
];
