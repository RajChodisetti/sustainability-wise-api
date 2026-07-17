import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, login as apiLogin, logout as apiLogout, me, refresh } from './api';
import { appOrder, defaultPathForApp, navigate } from './navigation';
import type { AppId, AuthUser, Session, TokenSet } from './types';

const STORAGE_KEY = 'swui.sessions.v1';
const ACTIVE_APP_KEY = 'swui.activeApp.v1';

type Sessions = Partial<Record<AppId, Session>>;

interface AuthContextValue {
  bootstrapping: boolean;
  sessions: Sessions;
  activeApp: AppId | null;
  session: Session | null;
  user: AuthUser | null;
  notice: string | null;
  setNotice: (message: string | null) => void;
  login: (app: AppId, email: string, password: string) => Promise<void>;
  logoutCurrent: () => Promise<void>;
  switchApp: (app: AppId) => Promise<boolean>;
  ensureFreshSession: () => Promise<Session | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readSessions(): Sessions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Sessions;
  } catch {
    return {};
  }
}

function writeSessions(sessions: Sessions): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function readActiveApp(sessions: Sessions): AppId | null {
  const stored = localStorage.getItem(ACTIVE_APP_KEY) as AppId | null;
  if (stored && sessions[stored]) return stored;
  return appOrder.find((app) => sessions[app]) ?? null;
}

function writeActiveApp(app: AppId | null): void {
  if (app) {
    localStorage.setItem(ACTIVE_APP_KEY, app);
  } else {
    localStorage.removeItem(ACTIVE_APP_KEY);
  }
}

function mergeTokens(session: Session, tokens: TokenSet): Session {
  return {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    issuedAt: Date.now(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [sessions, setSessions] = useState<Sessions>({});
  const [activeApp, setActiveApp] = useState<AppId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const persistSessions = useCallback((nextSessions: Sessions, nextActiveApp: AppId | null) => {
    setSessions(nextSessions);
    setActiveApp(nextActiveApp);
    writeSessions(nextSessions);
    writeActiveApp(nextActiveApp);
  }, []);

  const removeSession = useCallback((app: AppId) => {
    setSessions((current) => {
      const next = { ...current };
      delete next[app];
      const nextActive = activeApp === app ? readActiveApp(next) : activeApp;
      writeSessions(next);
      writeActiveApp(nextActive);
      setActiveApp(nextActive);
      return next;
    });
  }, [activeApp]);

  useEffect(() => {
    const storedSessions = readSessions();
    const storedActiveApp = readActiveApp(storedSessions);
    setSessions(storedSessions);
    setActiveApp(storedActiveApp);
    setBootstrapping(false);
  }, []);

  const session = activeApp ? sessions[activeApp] ?? null : null;
  const user = session?.user ?? null;

  const ensureFreshSession = useCallback(async (): Promise<Session | null> => {
    if (!activeApp) return null;
    const current = sessions[activeApp];
    if (!current) return null;

    try {
      const currentUser = await me(current.accessToken);
      if (currentUser.app !== activeApp) throw new ApiError('Wrong application namespace', 403);
      const verified = { ...current, user: currentUser };
      const next = { ...sessions, [activeApp]: verified };
      persistSessions(next, activeApp);
      return verified;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }

      try {
        const tokens = await refresh(current.refreshToken);
        const refreshed = mergeTokens(current, tokens);
        const currentUser = await me(refreshed.accessToken);
        const verified = { ...refreshed, user: currentUser };
        const next = { ...sessions, [activeApp]: verified };
        persistSessions(next, activeApp);
        return verified;
      } catch {
        removeSession(activeApp);
        return null;
      }
    }
  }, [activeApp, sessions, persistSessions, removeSession]);

  const doLogin = useCallback(async (app: AppId, email: string, password: string) => {
    const response = await apiLogin(app, email, password);
    const nextSession: Session = {
      ...response,
      issuedAt: Date.now(),
    };
    const nextSessions = { ...sessions, [app]: nextSession };
    persistSessions(nextSessions, app);
    setNotice(null);
    navigate(defaultPathForApp(app));
  }, [sessions, persistSessions]);

  const logoutCurrent = useCallback(async () => {
    if (!activeApp || !sessions[activeApp]) return;
    const currentApp = activeApp;
    const currentSession = sessions[currentApp];
    if (!currentSession) return;
    const nextSessions = { ...sessions };
    delete nextSessions[currentApp];
    const nextActiveApp = readActiveApp(nextSessions);

    persistSessions(nextSessions, nextActiveApp);
    try {
      await apiLogout(currentSession.refreshToken);
    } catch {
      // Local logout still succeeds if the token is already expired or revoked.
    }

    setNotice(null);
    navigate(nextActiveApp ? defaultPathForApp(nextActiveApp) : '/login');
  }, [activeApp, sessions, persistSessions]);

  const switchApp = useCallback(async (app: AppId): Promise<boolean> => {
    if (!sessions[app]) {
      writeActiveApp(app);
      setActiveApp(null);
      navigate(`/login?app=${app}`);
      return false;
    }

    persistSessions(sessions, app);
    navigate(defaultPathForApp(app));
    return true;
  }, [sessions, persistSessions]);

  const value = useMemo<AuthContextValue>(() => ({
    bootstrapping,
    sessions,
    activeApp,
    session,
    user,
    notice,
    setNotice,
    login: doLogin,
    logoutCurrent,
    switchApp,
    ensureFreshSession,
  }), [
    bootstrapping,
    sessions,
    activeApp,
    session,
    user,
    notice,
    doLogin,
    logoutCurrent,
    switchApp,
    ensureFreshSession,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
