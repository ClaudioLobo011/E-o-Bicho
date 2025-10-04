import { useAuthStore } from './store';

export function useAuth() {
  const { user, status, error, login, logout, setUser, hasRole } = useAuthStore();
  return { user, status, error, login, logout, setUser, hasRole };
}
