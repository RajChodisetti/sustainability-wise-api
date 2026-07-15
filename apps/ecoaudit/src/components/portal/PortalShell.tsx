'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '@/api/client';
import { API_DISPLAY_URL } from '@/lib/config';
import { usePortalAuth } from '@/contexts/PortalAuthContext';

function isActive(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ExpandToggle({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border)] text-sm font-semibold leading-none text-[var(--text-sub)] hover:bg-[var(--surface2)]"
    >
      {open ? '−' : '+'}
    </button>
  );
}

function NavLink({
  href,
  label,
  exact,
  nested = false,
}: {
  href: string;
  label: string;
  exact?: boolean;
  nested?: boolean;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, href, exact);
  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        nested ? 'py-1.5 text-[13px]' : 'py-2'
      } ${
        active
          ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
          : 'text-[var(--text-sub)] hover:bg-[var(--surface2)]'
      }`}
    >
      {label}
    </Link>
  );
}

function ProfileMenu({
  displayName,
  role,
  profileHref,
  onLogout,
}: {
  displayName: string;
  role?: string | null;
  profileHref: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = (displayName[0] ?? 'U').toUpperCase();

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm hover:bg-[var(--surface2)]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-xs font-bold text-[var(--primary-fg)]">
          {initial}
        </span>
        <span className="hidden max-w-[140px] truncate font-medium text-[var(--text)] sm:inline">{displayName}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          <div className="border-b border-[var(--border)] px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-[var(--text)]">{displayName}</p>
            {role ? <p className="truncate text-xs capitalize text-[var(--text-sub)]">{role}</p> : null}
          </div>
          <Link
            href={profileHref}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface2)]"
          >
            Profile
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-[var(--red)] hover:bg-[var(--surface2)]"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout, eaUser, ssUser } = usePortalAuth();
  const eaAdmin = eaUser?.role === 'admin';
  const ssAdmin = ssUser?.role === 'admin';

  const [appsOpen, setAppsOpen] = useState(
    () => pathname.startsWith('/ecoaudit') || pathname.startsWith('/solar') || pathname.startsWith('/field'),
  );
  const [ecoOpen, setEcoOpen] = useState(() => pathname.startsWith('/ecoaudit'));
  const [solarOpen, setSolarOpen] = useState(() => pathname.startsWith('/solar'));
  const [renderedPathname, setRenderedPathname] = useState(pathname);

  // Adjust navigation state during render when the route changes. React discards
  // this pass and immediately retries, so children never render stale nav state.
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    if (pathname.startsWith('/ecoaudit') || pathname.startsWith('/solar') || pathname.startsWith('/field')) {
      setAppsOpen(true);
    }
    if (pathname.startsWith('/ecoaudit')) setEcoOpen(true);
    if (pathname.startsWith('/solar')) setSolarOpen(true);
  }

  const health = useQuery({ queryKey: ['health'], queryFn: checkHealth, refetchInterval: 60_000 });

  const hideChrome =
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/ecoaudit/login') ||
    pathname.startsWith('/ecoaudit/signup') ||
    pathname.startsWith('/solar/login') ||
    pathname.startsWith('/solar/signup');

  async function handleLogout() {
    await logout();
    window.location.assign('/login');
  }

  if (hideChrome) return <>{children}</>;

  const ecoChildren = [
    { href: '/ecoaudit/dashboard', label: 'Dashboard', exact: true },
    { href: '/ecoaudit/audits', label: 'Audits' },
    { href: '/ecoaudit/settings', label: 'Settings' },
    ...(eaAdmin ? [{ href: '/ecoaudit/admin', label: 'Admin' }] : []),
  ];

  const solarChildren = [
    { href: '/solar/dashboard', label: 'Dashboard', exact: true },
    { href: '/solar/sites', label: 'Sites' },
    { href: '/solar/assessments', label: 'Assessments' },
    { href: '/solar/settings', label: 'Settings' },
    ...(ssAdmin ? [{ href: '/solar/admin', label: 'Admin' }] : []),
  ];

  const displayName = user?.fullName || user?.email || 'User';
  const profileHref = pathname.startsWith('/solar') ? '/solar/settings' : '/ecoaudit/settings';

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <aside className="hidden w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-4 md:flex md:flex-col">
        <div className="mb-8">
          <Link href="/" className="text-lg font-bold text-[var(--primary)]">
            EcoSense Portal
          </Link>
          <p className="text-xs text-[var(--text-sub)]">Sustainability Wise</p>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          <NavLink href="/scheduler" label="Scheduler" />

          <div className="mt-2">
            <div className="flex items-center gap-1 rounded-lg px-1 py-1 text-sm font-medium text-[var(--text-sub)]">
              <ExpandToggle open={appsOpen} onClick={() => setAppsOpen((v) => !v)} label="Apps" />
              <button
                type="button"
                onClick={() => setAppsOpen((v) => !v)}
                className="flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface2)]"
              >
                Apps
              </button>
            </div>

            {appsOpen ? (
              <div className="ml-3 space-y-1 border-l border-[var(--border)] pl-2">
                <div>
                  <div className="flex items-center gap-1">
                    <ExpandToggle open={ecoOpen} onClick={() => setEcoOpen((v) => !v)} label="Eco Audit" />
                    <Link
                      href="/ecoaudit/dashboard"
                      className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium ${
                        isActive(pathname, '/ecoaudit')
                          ? 'text-[var(--primary)]'
                          : 'text-[var(--text-sub)] hover:bg-[var(--surface2)]'
                      }`}
                    >
                      Eco Audit
                    </Link>
                  </div>
                  {ecoOpen ? (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
                      {ecoChildren.map((item) => (
                        <NavLink key={item.href} href={item.href} label={item.label} exact={item.exact} nested />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <ExpandToggle open={solarOpen} onClick={() => setSolarOpen((v) => !v)} label="Solar Sense" />
                    <Link
                      href="/solar/dashboard"
                      className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium ${
                        isActive(pathname, '/solar')
                          ? 'text-[var(--primary)]'
                          : 'text-[var(--text-sub)] hover:bg-[var(--surface2)]'
                      }`}
                    >
                      Solar Sense
                    </Link>
                  </div>
                  {solarOpen ? (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
                      {solarChildren.map((item) => (
                        <NavLink key={item.href} href={item.href} label={item.label} exact={item.exact} nested />
                      ))}
                    </div>
                  ) : null}
                </div>

                <Link
                  href="/field"
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium ${
                    isActive(pathname, '/field')
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                      : 'text-[var(--text-sub)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <span>Field App</span>
                  <span className="rounded bg-[var(--surface2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-sub)]">
                    Soon
                  </span>
                </Link>
              </div>
            ) : null}
          </div>
        </nav>

        <div className="mt-auto space-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-sub)]">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health.data ? 'bg-[var(--green)]' : 'bg-[var(--red)]'}`} />
            {health.data ? 'API connected' : 'API offline'}
          </div>
          <p className="truncate">{API_DISPLAY_URL}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-6">
          <Link href="/" className="font-bold text-[var(--primary)] md:hidden">
            EcoSense Portal
          </Link>
          <div className="hidden text-xs text-[var(--text-sub)] md:block">{API_DISPLAY_URL}</div>
          <ProfileMenu
            displayName={displayName}
            role={user?.role}
            profileHref={profileHref}
            onLogout={() => void handleLogout()}
          />
        </header>

        <nav className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 md:hidden">
          <div className="mb-1">
            <NavLink href="/scheduler" label="Scheduler" />
          </div>
          <div className="flex items-center gap-1">
            <ExpandToggle open={appsOpen} onClick={() => setAppsOpen((v) => !v)} label="Apps" />
            <span className="text-sm font-medium text-[var(--text-sub)]">Apps</span>
          </div>
          {appsOpen ? (
            <div className="mt-1 space-y-1 pl-2">
              <div className="flex items-center gap-1">
                <ExpandToggle open={ecoOpen} onClick={() => setEcoOpen((v) => !v)} label="Eco Audit" />
                <Link href="/ecoaudit/dashboard" className="text-sm text-[var(--text-sub)]">
                  Eco Audit
                </Link>
              </div>
              {ecoOpen
                ? ecoChildren.map((item) => (
                    <div key={item.href} className="pl-6">
                      <NavLink href={item.href} label={item.label} exact={item.exact} nested />
                    </div>
                  ))
                : null}
              <div className="flex items-center gap-1">
                <ExpandToggle open={solarOpen} onClick={() => setSolarOpen((v) => !v)} label="Solar Sense" />
                <Link href="/solar/dashboard" className="text-sm text-[var(--text-sub)]">
                  Solar Sense
                </Link>
              </div>
              {solarOpen
                ? solarChildren.map((item) => (
                    <div key={item.href} className="pl-6">
                      <NavLink href={item.href} label={item.label} exact={item.exact} nested />
                    </div>
                  ))
                : null}
              <Link href="/field" className="block pl-7 text-sm text-[var(--text-sub)]">
                Field App
              </Link>
            </div>
          ) : null}
        </nav>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
