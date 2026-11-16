import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, refreshTokens, tokenStore } from './api';
import type { AuthResponse, Family, MeResponse, User } from './api';

type Status = 'loading' | 'guest' | 'authed';

interface RegisterInput {
  displayName: string;
  email: string;
  password: string;
  phone?: string;
  locale?: 'en' | 'gu';
  acceptTerms: boolean;
}

interface AuthValue {
  status: Status;
  user: User | null;
  families: Family[];
  family: Family | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  demoLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);

  const applyAuth = useCallback((payload: { user: User; families: Family[] }) => {
    setUserState(payload.user);
    setFamilies(payload.families);
    setStatus('authed');
  }, []);

  const clearAuth = useCallback(() => {
    tokenStore.clear();
    setUserState(null);
    setFamilies([]);
    setStatus('guest');
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!tokenStore.refresh) {
        if (active) setStatus('guest');
        return;
      }
      const refreshed = await refreshTokens();
      if (!refreshed) {
        tokenStore.clear();
        if (active) setStatus('guest');
        return;
      }
      try {
        const me = await apiFetch<MeResponse>('/me');
        if (active) applyAuth(me);
      } catch {
        if (active) clearAuth();
      }
    })();

    const onSignedOut = () => {
      setUserState(null);
      setFamilies([]);
      setStatus('guest');
    };
    window.addEventListener('suraksha:signed-out', onSignedOut);
    return () => {
      active = false;
      window.removeEventListener('suraksha:signed-out', onSignedOut);
    };
  }, [applyAuth, clearAuth]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password },
      });
      tokenStore.set(result.tokens);
      applyAuth(result);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const result = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        auth: false,
        body: input,
      });
      tokenStore.set(result.tokens);
      applyAuth(result);
    },
    [applyAuth],
  );

  const demoLogin = useCallback(async () => {
    await login('demo@suraksha.app', 'Demo1234!');
  }, [login]);

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refresh;
    try {
      if (refreshToken) {
        await apiFetch('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } });
      }
    } catch {
      // Local sign-out must still succeed when offline.
    }
    clearAuth();
  }, [clearAuth]);

  const refreshMe = useCallback(async () => {
    const me = await apiFetch<MeResponse>('/me');
    applyAuth(me);
  }, [applyAuth]);

  const setUser = useCallback((next: User) => setUserState(next), []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      families,
      family: families[0] ?? null,
      login,
      register,
      demoLogin,
      logout,
      refreshMe,
      setUser,
    }),
    [status, user, families, login, register, demoLogin, logout, refreshMe, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
