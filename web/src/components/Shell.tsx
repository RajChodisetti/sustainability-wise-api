import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import {
  appNav,
  appOrder,
  apps,
  isAdmin,
  navigate,
  utilityNav,
} from '../lib/navigation';

interface ShellProps {
  children: ReactNode;
  pathname: string;
}

export function Shell({ children, pathname }: ShellProps) {
  const { activeApp, logoutCurrent, notice, session, sessions, switchApp, user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentApp = activeApp ? apps[activeApp] : null;

  const navigation = useMemo(() => {
    if (!activeApp || !user) return [];
    return appNav[activeApp].filter((item) => !item.adminOnly || isAdmin(user.role));
  }, [activeApp, user]);

  const utility = useMemo(() => {
    if (!user) return [];
    return utilityNav.filter((item) => !item.adminOnly || isAdmin(user.role));
  }, [user]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="brand-block">
          <button
            className="icon-button mobile-only"
            type="button"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose aria-hidden="true" />
          </button>
          <div className="brand-mark">SW</div>
          <div className="brand-copy">
            <strong>SustainabilityWiseUI</strong>
            <span>{currentApp?.label ?? 'Portal'}</span>
          </div>
        </div>

        <div className="app-switcher" aria-label="Application switcher">
          {appOrder.map((appId) => {
            const app = apps[appId];
            const hasSession = Boolean(sessions[appId]);
            const active = appId === activeApp;
            return (
              <button
                key={appId}
                className={`app-switch ${active ? 'active' : ''}`}
                type="button"
                onClick={() => void switchApp(appId)}
                title={hasSession ? app.label : `Sign in to ${app.label}`}
              >
                <span className="app-initials" style={{ borderColor: app.accent, color: app.accent }}>
                  {app.shortLabel}
                </span>
                <span className="app-switch-copy">
                  <strong>{app.label}</strong>
                  <small>{hasSession ? 'Signed in' : 'Sign in'}</small>
                </span>
              </button>
            );
          })}
        </div>

        <nav className="nav-list" aria-label="Module navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.path;
            return (
              <button
                key={item.path}
                className={`nav-item ${active ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  navigate(item.path);
                  setSidebarOpen(false);
                }}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <nav className="nav-list utility" aria-label="Utility navigation">
          {utility.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.path;
            return (
              <button
                key={item.path}
                className={`nav-item ${active ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  navigate(item.path);
                  setSidebarOpen(false);
                }}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className="nav-item collapse-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            <span>{sidebarCollapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            type="button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>

          <div className="topbar-title">
            <span>{currentApp?.label ?? 'SustainabilityWiseUI'}</span>
            <small>{currentApp?.description ?? 'Web portal'}</small>
          </div>

          <div className="user-menu">
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">
                {(user?.fullName || user?.email || 'U').slice(0, 1).toUpperCase()}
              </span>
              <span className="user-copy">
                <strong>{user?.fullName || user?.email || 'User'}</strong>
                <small>{user?.role ?? session?.user.role}</small>
              </span>
            </div>
            <button className="button secondary icon-text" type="button" onClick={() => void logoutCurrent()}>
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}

        <main className="content">{children}</main>
      </div>
    </div>
  );
}

