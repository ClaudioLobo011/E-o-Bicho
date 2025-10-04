import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { SessionUser, UserRole } from '../../entities/user';
import { STORAGE_KEYS } from '../../shared/lib/storage-migrations';
import { apiPost } from '../../shared/api/client';

interface AuthState {
  user: SessionUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error?: string;
}

interface AuthActions {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
  hasRole: (roles?: UserRole[]) => boolean;
}

function loadStoredSession(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    if (parsed && typeof parsed === 'object' && 'token' in parsed) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.warn('[auth] sessão inválida no armazenamento', error);
    return null;
  }
}

function persistSession(session: SessionUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (session) {
      window.localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.session);
    }
  } catch (error) {
    console.warn('[auth] não foi possível persistir a sessão', error);
  }
}

const initialUser = loadStoredSession();

export const useAuthStore = create<AuthState & AuthActions>()(
  immer((set, get) => ({
    user: initialUser,
    status: initialUser ? 'authenticated' : 'idle',
    error: undefined,
    async login(identifier: string, password: string) {
      set({ status: 'loading', error: undefined });
      try {
        const response = await apiPost<{ token: string; user: SessionUser }>('/auth/login', {
          identifier,
          senha: password
        });
        const session: SessionUser = {
          ...response.user,
          token: response.token
        };
        persistSession(session);
        set({ user: session, status: 'authenticated' });
      } catch (error) {
        console.error(error);
        set({ status: 'error', error: 'Não foi possível iniciar sessão.' });
        throw error;
      }
    },
    async logout() {
      try {
        await apiPost('/auth/logout');
      } catch (error) {
        console.warn('Falha ao encerrar sessão', error);
      }
      persistSession(null);
      set({ user: null, status: 'idle' });
    },
    setUser(user) {
      persistSession(user);
      set({ user, status: user ? 'authenticated' : 'idle' });
    },
    hasRole(roles) {
      if (!roles || roles.length === 0) return true;
      const user = get().user;
      if (!user) return false;
      return roles.includes(user.role);
    }
  }))
);
