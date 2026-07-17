import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './components/Shell';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { ModulePage } from './pages/ModulePage';
import { SettingsPage } from './pages/SettingsPage';
import { BacklogPage } from './pages/BacklogPage';
import { useAuth } from './lib/auth';
import {
  appForPath,
  defaultPathForApp,
  isAdmin,
  navigate,
  pathRequiresAdmin,
} from './lib/navigation';
import type { AppId } from './lib/types';

function useLocationPath(): string {
  const [path, setPath] = useState(`${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    const onLocationChange = () => {
      setPath(`${window.location.pathname}${window.location.search}`);
    };

    window.addEventListener('popstate', onLocationChange);
    return () => window.removeEventListener('popstate', onLocationChange);
  }, []);

  return path;
}

function requestedLoginApp(path: string): AppId {
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const requested = params.get('app');
  return requested === 'ecoaudit' || requested === 'solarsense' ? requested : 'solarsense';
}

function LoadingScreen({ label = 'Loading SustainabilityWiseUI' }: { label?: string }) {
  return (
    <main className="full-screen-status">
      <Loader2 className="spin" aria-hidden="true" />
      <span>{label}</span>
    </main>
  );
}

function NotFoundPage() {
  const { activeApp } = useAuth();
  return (
    <main className="full-screen-status">
      <AlertTriangle aria-hidden="true" />
      <span>Page not found</span>
      <button
        className="button primary"
        type="button"
        onClick={() => navigate(activeApp ? defaultPathForApp(activeApp) : '/login')}
      >
        Go to dashboard
      </button>
    </main>
  );
}

export function App() {
  const path = useLocationPath();
  const pathname = path.split('?')[0] || '/';
  const {
    activeApp,
    bootstrapping,
    ensureFreshSession,
    session,
    sessions,
    switchApp,
    user,
  } = useAuth();
  const [checkingSession, setCheckingSession] = useState(false);

  useEffect(() => {
    if (bootstrapping || !session) return;

    let cancelled = false;
    setCheckingSession(true);
    ensureFreshSession()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapping]);

  const requestedApp = useMemo(() => appForPath(pathname), [pathname]);

  useEffect(() => {
    if (bootstrapping || pathname !== '/') return;
    navigate(activeApp ? defaultPathForApp(activeApp) : '/login');
  }, [bootstrapping, pathname, activeApp]);

  useEffect(() => {
    if (bootstrapping || !requestedApp || requestedApp === activeApp) return;
    if (sessions[requestedApp]) {
      void switchApp(requestedApp);
    }
  }, [bootstrapping, requestedApp, activeApp, sessions, switchApp]);

  if (bootstrapping || checkingSession || pathname === '/') {
    return <LoadingScreen />;
  }

  if (pathname === '/login') {
    return <LoginPage initialApp={requestedLoginApp(path)} />;
  }

  if (!session || !user || !activeApp) {
    return <LoginPage initialApp={requestedApp ?? requestedLoginApp(path)} />;
  }

  if (requestedApp && requestedApp !== activeApp) {
    if (sessions[requestedApp]) {
      return <LoadingScreen label="Switching workspace" />;
    }
    return <LoginPage initialApp={requestedApp} />;
  }

  if (pathRequiresAdmin(pathname) && !isAdmin(user.role)) {
    return (
      <Shell pathname={pathname}>
        <AccessDeniedPage />
      </Shell>
    );
  }

  let page = <NotFoundPage />;
  if (requestedApp) {
    page = <ModulePage app={requestedApp} pathname={pathname} />;
  } else if (pathname === '/settings') {
    page = <SettingsPage />;
  } else if (pathname === '/diagnostics') {
    page = <DiagnosticsPage />;
  } else if (pathname === '/api-keys' || pathname === '/system') {
    page = <SettingsPage mode={pathname === '/api-keys' ? 'api-keys' : 'system'} />;
  } else if (pathname === '/backlog') {
    page = <BacklogPage />;
  }

  return (
    <Shell pathname={pathname}>
      {page}
      <div className="sr-only" role="status" aria-live="polite">
        <CheckCircle2 aria-hidden="true" />
      </div>
    </Shell>
  );
}

