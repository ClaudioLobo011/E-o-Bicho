import { AxiosRequestConfig } from 'axios';
import { usersWithSessions } from './data';

export const authMock = [
  {
    method: 'POST' as const,
    test: (url: string) => url === '/auth/login',
    handler: async (config: AxiosRequestConfig) => {
      const { identifier, senha } = (config.data as string ? JSON.parse(config.data as string) : {}) as {
        identifier?: string;
        senha?: string;
      };

      if (!identifier || !senha) {
        throw new Error('Credenciais inválidas');
      }

      const session = usersWithSessions.find(
        (user) => user.email === identifier || user.cpf === identifier || user.id === identifier
      );

      if (!session) {
        throw new Error('Usuário não encontrado');
      }

      if (senha !== '123456') {
        throw new Error('Senha incorreta');
      }

      return {
        token: session.token,
        user: session
      };
    }
  },
  {
    method: 'POST' as const,
    test: (url: string) => url === '/auth/logout',
    handler: async () => ({ success: true })
  }
];
