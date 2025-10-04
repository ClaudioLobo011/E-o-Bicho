const LEGACY_KEYS = {
  loggedInUser: 'loggedInUser',
  rememberLogin: 'rememberLogin',
  authToken: 'auth_token',
  user: 'user'
} as const;

const NEW_KEYS = {
  session: 'loggedInUser',
  remember: 'rememberLogin',
  cart: 'eobicho.cart.v1'
} as const;

export function applyStorageMigrations(): void {
  if (typeof window === 'undefined') return;

  try {
    const legacySession = window.localStorage.getItem(LEGACY_KEYS.loggedInUser);
    if (legacySession && !window.localStorage.getItem(NEW_KEYS.session)) {
      window.localStorage.setItem(NEW_KEYS.session, legacySession);
    }
  } catch (error) {
    console.warn('[storage] não foi possível migrar sessão legacy', error);
  }

  try {
    const remember = window.localStorage.getItem(LEGACY_KEYS.rememberLogin);
    if (remember && !window.localStorage.getItem(NEW_KEYS.remember)) {
      window.localStorage.setItem(NEW_KEYS.remember, remember);
    }
  } catch (error) {
    console.warn('[storage] não foi possível migrar remember-me', error);
  }
}

export const STORAGE_KEYS = NEW_KEYS;
