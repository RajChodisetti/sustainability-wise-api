'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '@/api/client';
import { API_DISPLAY_URL } from '@/lib/config';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { BrandMark, Icon, type IconName } from '@/components/ui/Icon';
import { PORTAL_FEATURES } from '@/lib/portalFeatures';
import { portalApplicationIsVisible } from '@/lib/portalApplications';
import { portalNavigationScopeForPath } from '@/lib/portalNavigation';
import {
  SCHEDULER_NAVIGATION_GROUPS,
  schedulerTabFromQuery,
  schedulerTabHref,
  type SchedulerTab,
} from '@/modules/scheduler/lib/navigation';

function isActive(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon,
  exact,
  nested = false,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, href, exact);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm font-semibold ${
        nested ? 'ml-3 pl-3' : ''
      } ${
        active
          ? 'bg-white/14 text-white shadow-[inset_3px_0_0_var(--accent)]'
          : 'text-[var(--sidebar-muted)] hover:bg-white/[0.07] hover:text-white'
      }`}
    >
      <Icon name={icon} size={18} className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

type AppRole = {
  app: 'ecoaudit' | 'solarsense' | 'installhub' | 'wattwatchers';
  appName: string;
  role: string;
};

function formatRole(role: string) {
  if (role === 'service_account') return 'Service account';
  return role
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ProfileMenu({
  displayName,
  appRoles,
  profileHref,
  onLogout,
}: {
  displayName: string;
  appRoles: AppRole[];
  profileHref: string | null;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const initial = (displayName[0] ?? 'U').toUpperCase();

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const roleSummary =
    appRoles.length === 0
      ? null
      : appRoles.length === 1
        ? `${appRoles[0].appName} · ${formatRole(appRoles[0].role)}`
        : `${appRoles.length} workspaces signed in`;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Open profile menu for ${displayName}${
          appRoles.length > 0
            ? `. ${appRoles.map(({ appName, role }) => `${appName} — ${formatRole(role)}`).join(', ')}`
            : ''
        }`}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex min-h-11 max-w-[min(100%,16rem)] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm shadow-[var(--shadow-xs)] hover:border-[var(--border-strong)] hover:bg-[var(--surface2)] sm:max-w-[18rem]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-extrabold text-[var(--primary-fg)]">
          {initial}
        </span>
        <span className="hidden min-w-0 flex-1 flex-col items-start text-left sm:flex">
          <span className="w-full truncate text-sm font-extrabold leading-tight text-[var(--text)]">
            {displayName}
          </span>
          {roleSummary ? (
            <span className="w-full truncate text-[11px] font-semibold leading-tight text-[var(--text-sub)]">
              {roleSummary}
            </span>
          ) : null}
        </span>
        <Icon
          name="chevron-down"
          size={16}
          className={`hidden shrink-0 text-[var(--muted)] sm:block ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]"
          aria-label="Profile options"
        >
          <div className="mb-1 border-b border-[var(--border)] px-3 py-2.5">
            <p className="truncate text-sm font-bold text-[var(--text)]">{displayName}</p>
            {appRoles.length > 0 ? (
              <div className="mt-2 space-y-1" aria-label="Application roles">
                {appRoles.map(({ app, appName, role }) => (
                  <p key={app} className="text-xs font-semibold text-[var(--text-sub)]">
                    {appName} — {formatRole(role)}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          {profileHref ? (
            <Link
              href={profileHref}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface2)]"
            >
              <Icon name="user" size={18} className="text-[var(--text-sub)]" />
              Profile
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-[var(--red)] hover:bg-[var(--red-soft)]"
          >
            <Icon name="log-out" size={18} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

type ChildNavItem = { href: string; label: string; icon: IconName; exact?: boolean };

function AppNavigationSection({
  label,
  href,
  icon,
  open,
  onToggle,
  items,
  regionId,
  active,
  onNavigate,
}: {
  label: string;
  href: string;
  icon: IconName;
  open: boolean;
  onToggle: () => void;
  items: ChildNavItem[];
  regionId: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <div className={`flex items-center rounded-[var(--radius-sm)] ${active ? 'bg-white/[0.05]' : ''}`}>
        <Link
          href={href}
          onClick={onNavigate}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-l-[var(--radius-sm)] px-3 text-sm font-bold ${
            active ? 'text-white' : 'text-[var(--sidebar-muted)] hover:text-white'
          }`}
        >
          <Icon name={icon} size={19} className="shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-r-[var(--radius-sm)] text-[var(--sidebar-muted)] hover:bg-white/[0.08] hover:text-white"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${label} navigation`}
          aria-expanded={open}
          aria-controls={regionId}
        >
          <Icon name="chevron-down" size={17} className={open ? 'rotate-180' : ''} />
        </button>
      </div>
      {open ? (
        <div id={regionId} className="mt-1 space-y-1 border-l border-[var(--sidebar-border)] pl-1">
          {items.map((item) => (
            <NavLink key={item.href} {...item} nested onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SchedulerNavigation({
  currentTab,
  isAdmin,
  activeScope,
  onNavigate,
}: {
  currentTab: SchedulerTab;
  isAdmin: boolean;
  activeScope: boolean;
  onNavigate?: () => void;
}) {
  const visibleGroups = SCHEDULER_NAVIGATION_GROUPS.filter((group) => !group.adminOnly || isAdmin);
  const [groupChoices, setGroupChoices] = useState<Record<string, boolean>>({});
  return (
    <section aria-label="Scheduler navigation">
      <Link
        href={schedulerTabHref('calendar')}
        onClick={onNavigate}
        className="mb-2 flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm font-extrabold text-white hover:bg-white/[0.07]"
      >
        <Icon name="calendar" size={19} />
        <span>Scheduler</span>
      </Link>
      <div className="space-y-1 border-l border-[var(--sidebar-border)] pl-2">
        {visibleGroups.map((group) => {
          const active = activeScope && group.items.some((item) => item.id === currentTab);
          const open = groupChoices[group.id] ?? activeScope;
          const regionId = `scheduler-${group.id}-navigation`;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => setGroupChoices((current) => ({ ...current, [group.id]: !open }))}
                className={`flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-sm font-bold ${active ? 'bg-white/[0.08] text-white' : 'text-[var(--sidebar-muted)] hover:bg-white/[0.06] hover:text-white'}`}
                aria-expanded={open}
                aria-controls={regionId}
              >
                <Icon name={group.icon} size={18} />
                <span className="flex-1">{group.label}</span>
                <Icon name="chevron-down" size={16} className={open ? 'rotate-180' : ''} />
              </button>
              {open ? (
                <div id={regionId} className="mt-1 space-y-1 border-l border-[var(--sidebar-border)] pl-2">
                  {group.items.map((item) => {
                    const itemActive = activeScope && currentTab === item.id;
                    return (
                      <Link
                        key={item.id}
                        href={schedulerTabHref(item.id)}
                        onClick={onNavigate}
                        aria-current={itemActive ? 'page' : undefined}
                        className={`group relative flex min-h-10 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm font-semibold ${itemActive ? 'bg-white/14 text-white shadow-[inset_3px_0_0_var(--accent)]' : 'text-[var(--sidebar-muted)] hover:bg-white/[0.07] hover:text-white'}`}
                      >
                        <Icon name={item.icon} size={17} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SidebarNavigation({
  pathname,
  schedulerTab,
  schedulerAdmin,
  idPrefix,
  appsOpen,
  setAppsOpen,
  ecoOpen,
  setEcoOpen,
  solarOpen,
  setSolarOpen,
  fieldOpen,
  setFieldOpen,
  fleetOpen,
  setFleetOpen,
  ecoChildren,
  solarChildren,
  fieldChildren,
  fleetChildren,
  showEcoNavigation,
  showSolarNavigation,
  showFieldNavigation,
  showFleetNavigation,
  healthState,
  onNavigate,
}: {
  pathname: string;
  schedulerTab: SchedulerTab;
  schedulerAdmin: boolean;
  idPrefix: string;
  appsOpen: boolean;
  setAppsOpen: (value: boolean) => void;
  ecoOpen: boolean;
  setEcoOpen: (value: boolean) => void;
  solarOpen: boolean;
  setSolarOpen: (value: boolean) => void;
  fieldOpen: boolean;
  setFieldOpen: (value: boolean) => void;
  fleetOpen: boolean;
  setFleetOpen: (value: boolean) => void;
  ecoChildren: ChildNavItem[];
  solarChildren: ChildNavItem[];
  fieldChildren: ChildNavItem[];
  fleetChildren: ChildNavItem[];
  showEcoNavigation: boolean;
  showSolarNavigation: boolean;
  showFieldNavigation: boolean;
  showFleetNavigation: boolean;
  healthState: 'checking' | 'connected' | 'offline';
  onNavigate?: () => void;
}) {
  const appsRegionId = `${idPrefix}-apps-navigation`;
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="mb-7 flex items-center gap-3 rounded-xl text-white">
        <BrandMark />
        <span className="min-w-0">
          <span className="block truncate text-base font-extrabold tracking-[-0.025em]">EcoSense Portal</span>
          <span className="block truncate text-[11px] font-semibold tracking-wide text-[var(--sidebar-muted)]">SUSTAINABILITY WISE</span>
        </span>
      </Link>

      <nav className="subtle-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Primary navigation">
        <SchedulerNavigation currentTab={schedulerTab} isAdmin={schedulerAdmin} activeScope={pathname.startsWith('/scheduler')} onNavigate={onNavigate} />

        <div className="pt-4">
          <button
            type="button"
            onClick={() => setAppsOpen(!appsOpen)}
            className="mb-2 flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--sidebar-muted)] hover:bg-white/[0.06] hover:text-white"
            aria-expanded={appsOpen}
            aria-controls={appsRegionId}
          >
            <Icon name="apps" size={18} />
            <span className="flex-1">Applications</span>
            <Icon name="chevron-down" size={16} className={appsOpen ? 'rotate-180' : ''} />
          </button>

          {appsOpen ? (
            <div id={appsRegionId} className="space-y-2">
              {showEcoNavigation ? (
                <AppNavigationSection
                  label="EcoAudit Pro"
                  href="/ecoaudit/dashboard"
                  icon="leaf"
                  open={ecoOpen}
                  onToggle={() => setEcoOpen(!ecoOpen)}
                  items={ecoChildren}
                  regionId={`${idPrefix}-eco-navigation`}
                  active={pathname.startsWith('/ecoaudit')}
                  onNavigate={onNavigate}
                />
              ) : null}
              {showSolarNavigation ? (
                <AppNavigationSection
                  label="Solar Sense"
                  href="/solar/dashboard"
                  icon="sun"
                  open={solarOpen}
                  onToggle={() => setSolarOpen(!solarOpen)}
                  items={solarChildren}
                  regionId={`${idPrefix}-solar-navigation`}
                  active={pathname.startsWith('/solar')}
                  onNavigate={onNavigate}
                />
              ) : null}
              {showFieldNavigation ? (
                <AppNavigationSection
                  label="Field App Complete"
                  href="/field"
                  icon="clipboard"
                  open={fieldOpen}
                  onToggle={() => setFieldOpen(!fieldOpen)}
                  items={fieldChildren}
                  regionId={`${idPrefix}-field-navigation`}
                  active={pathname.startsWith('/field') || pathname.startsWith('/installhub')}
                  onNavigate={onNavigate}
                />
              ) : null}
              {showFleetNavigation ? (
                <AppNavigationSection
                  label="Wattwatchers Fleet"
                  href="/fleet/dashboard"
                  icon="activity"
                  open={fleetOpen}
                  onToggle={() => setFleetOpen(!fleetOpen)}
                  items={fleetChildren}
                  regionId={`${idPrefix}-fleet-navigation`}
                  active={pathname.startsWith('/fleet')}
                  onNavigate={onNavigate}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </nav>

      <div className="mt-5 border-t border-[var(--sidebar-border)] pt-4 text-xs text-[var(--sidebar-muted)]">
        <div className="flex items-center gap-2 font-semibold" role="status">
          <Icon
            name={healthState === 'offline' ? 'wifi-off' : 'wifi'}
            size={16}
            className={healthState === 'connected' ? 'text-emerald-300' : healthState === 'offline' ? 'text-red-300' : ''}
          />
          {healthState === 'connected' ? 'API connected' : healthState === 'offline' ? 'API offline' : 'Checking connection'}
        </div>
        <p className="mt-2 truncate text-[10px]" title={API_DISPLAY_URL}>{API_DISPLAY_URL}</p>
      </div>
    </div>
  );
}

function QueryAwareSidebarNavigation(
  props: Omit<ComponentProps<typeof SidebarNavigation>, 'schedulerTab'>,
) {
  const searchParams = useSearchParams();
  return (
    <SidebarNavigation
      {...props}
      schedulerTab={schedulerTabFromQuery(
        searchParams.get('tab'),
        searchParams.get('invoiceId'),
      )}
    />
  );
}

function workspaceFor(pathname: string) {
  if (pathname.startsWith('/ecoaudit')) return { name: 'Eco Audit', icon: 'leaf' as IconName };
  if (pathname.startsWith('/solar')) return { name: 'Solar Sense', icon: 'sun' as IconName };
  if (pathname.startsWith('/installhub')) return { name: 'Field App Complete', icon: 'tool' as IconName };
  if (pathname.startsWith('/fleet')) return { name: 'Wattwatchers Fleet', icon: 'activity' as IconName };
  if (pathname.startsWith('/scheduler')) return { name: 'Scheduler', icon: 'calendar' as IconName };
  if (pathname.startsWith('/field')) return { name: 'Field App Complete', icon: 'clipboard' as IconName };
  return { name: 'Portal overview', icon: 'grid' as IconName };
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { logout, eaUser, ssUser, ihUser, wwUser } = usePortalAuth();
  const { isDark, setMode } = useTheme();
  const eaAdmin = eaUser?.role === 'admin';
  const ssAdmin = ssUser?.role === 'admin';
  const ihAdmin = ihUser?.role === 'admin';
  const wwAdmin = wwUser?.role === 'admin';
  const schedulerAdmin = Boolean(eaAdmin || ssAdmin || ihAdmin);
  const navigationScope = portalNavigationScopeForPath(pathname);
  const [appsChoice, setAppsChoice] = useState<{ scope: string; value: boolean } | null>(null);
  const [ecoChoice, setEcoChoice] = useState<{ scope: string; value: boolean } | null>(null);
  const [solarChoice, setSolarChoice] = useState<{ scope: string; value: boolean } | null>(null);
  const [fieldChoice, setFieldChoice] = useState<{ scope: string; value: boolean } | null>(null);
  const [fleetChoice, setFleetChoice] = useState<{ scope: string; value: boolean } | null>(null);
  const appsOpen = appsChoice?.scope === navigationScope
    ? appsChoice.value
    : navigationScope !== 'portal';
  const ecoOpen = ecoChoice?.scope === navigationScope
    ? ecoChoice.value
    : navigationScope === 'ecoaudit';
  const solarOpen = solarChoice?.scope === navigationScope
    ? solarChoice.value
    : navigationScope === 'solar';
  const fieldOpen = fieldChoice?.scope === navigationScope
    ? fieldChoice.value
    : navigationScope === 'field';
  const fleetOpen = fleetChoice?.scope === navigationScope
    ? fleetChoice.value
    : navigationScope === 'fleet';
  const setAppsOpen = (value: boolean) => setAppsChoice({ scope: navigationScope, value });
  const setEcoOpen = (value: boolean) => setEcoChoice({ scope: navigationScope, value });
  const setSolarOpen = (value: boolean) => setSolarChoice({ scope: navigationScope, value });
  const setFieldOpen = (value: boolean) =>
    setFieldChoice({ scope: navigationScope, value });
  const setFleetOpen = (value: boolean) => setFleetChoice({ scope: navigationScope, value });
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const menuButton = mobileMenuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileCloseRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !mobileDrawerRef.current) return;
      const focusable = Array.from(
        mobileDrawerRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      menuButton?.focus();
    };
  }, [mobileOpen]);

  const health = useQuery({ queryKey: ['health'], queryFn: checkHealth, refetchInterval: 60_000 });
  const healthState: 'checking' | 'connected' | 'offline' = health.isLoading
    ? 'checking'
    : health.data
      ? 'connected'
      : 'offline';

  const hideChrome =
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/ecoaudit/login') ||
    pathname.startsWith('/ecoaudit/signup') ||
    pathname.startsWith('/solar/login') ||
    pathname.startsWith('/solar/signup') ||
    pathname.startsWith('/installhub/login');

  async function handleLogout() {
    await logout();
    window.location.assign('/login');
  }

  if (hideChrome) return <>{children}</>;

  const ecoChildren: ChildNavItem[] = [
    { href: '/ecoaudit/dashboard', label: 'Dashboard', icon: 'grid', exact: true },
    { href: '/ecoaudit/audits', label: 'Audits', icon: 'clipboard' },
    { href: '/ecoaudit/settings', label: 'Settings', icon: 'settings' },
    ...(eaAdmin ? [{ href: '/ecoaudit/admin', label: 'Admin', icon: 'shield' as IconName }] : []),
  ];
  const solarChildren: ChildNavItem[] = [
    { href: '/solar/dashboard', label: 'Dashboard', icon: 'grid', exact: true },
    { href: '/solar/sites', label: 'Sites', icon: 'building' },
    { href: '/solar/assessments', label: 'Assessments', icon: 'clipboard' },
    { href: '/solar/settings', label: 'Settings', icon: 'settings' },
    ...(ssAdmin ? [{ href: '/solar/admin', label: 'Admin', icon: 'shield' as IconName }] : []),
  ];
  const fleetChildren: ChildNavItem[] = [
    { href: '/fleet/dashboard', label: 'Overview', icon: 'grid', exact: true },
    { href: '/fleet/electrical-map', label: 'Electrical Map · Beta', icon: 'zap' },
    { href: '/fleet/devices', label: 'Devices', icon: 'wifi' },
    ...(wwAdmin
      ? [{ href: '/fleet/meter-register', label: 'Meter Register', icon: 'clipboard' as IconName }]
      : []),
    { href: '/fleet/clients', label: 'Fleet accounts', icon: 'users' },
    { href: '/fleet/reports', label: 'Daily reports', icon: 'file-text' },
    { href: '/fleet/collection', label: 'Collection health', icon: 'activity' },
  ];
  const fieldChildren: ChildNavItem[] = [
    { href: '/installhub/dashboard', label: 'Field App Complete', icon: 'tool', exact: true },
    { href: '/installhub/installations', label: 'Installations', icon: 'building' },
    { href: '/installhub/inventory', label: 'Inventory', icon: 'clipboard' },
    { href: '/installhub/route', label: 'Route planner', icon: 'map-pin' },
    { href: '/installhub/settings', label: 'Settings', icon: 'settings' },
    ...(ihAdmin
      ? [{ href: '/installhub/admin/users', label: 'User management', icon: 'shield' as IconName }]
      : []),
  ];
  const applicationSessions = {
    ecoaudit: Boolean(eaUser),
    solarsense: Boolean(ssUser),
    installhub: Boolean(ihUser || eaUser || ssUser),
    wattwatchers: Boolean(wwUser),
  };
  const showEcoNavigation = portalApplicationIsVisible(
    'ecoaudit',
    applicationSessions,
    PORTAL_FEATURES.solarSenseVisible,
  );
  const showSolarNavigation = portalApplicationIsVisible(
    'solarsense',
    applicationSessions,
    PORTAL_FEATURES.solarSenseVisible,
  );
  const showFieldNavigation = portalApplicationIsVisible(
    'installhub',
    applicationSessions,
    PORTAL_FEATURES.solarSenseVisible,
  );
  const showFleetNavigation = portalApplicationIsVisible(
    'wattwatchers',
    applicationSessions,
    PORTAL_FEATURES.solarSenseVisible,
  );
  const navigationProps = {
    pathname,
    schedulerAdmin,
    appsOpen,
    setAppsOpen,
    ecoOpen,
    setEcoOpen,
    solarOpen,
    setSolarOpen,
    fieldOpen,
    setFieldOpen,
    fleetOpen,
    setFleetOpen,
    ecoChildren,
    solarChildren,
    fieldChildren,
    fleetChildren,
    showEcoNavigation,
    showSolarNavigation,
    showFieldNavigation,
    showFleetNavigation,
    healthState,
  };
  const activeUser = pathname.startsWith('/ecoaudit')
    ? eaUser
    : pathname.startsWith('/solar')
      ? ssUser
      : pathname.startsWith('/installhub')
        ? ihUser
        : pathname.startsWith('/fleet')
          ? wwUser
          : eaUser ?? ssUser ?? ihUser ?? wwUser;
  const displayName = activeUser?.fullName || activeUser?.email || 'User';
  const appRoles: AppRole[] = [
    ...(eaUser ? [{ app: 'ecoaudit' as const, appName: 'Eco Audit Pro', role: eaUser.role }] : []),
    ...(ssUser ? [{ app: 'solarsense' as const, appName: 'SolarSense', role: ssUser.role }] : []),
    ...(ihUser ? [{ app: 'installhub' as const, appName: 'Field App Complete', role: ihUser.role }] : []),
    ...(wwUser ? [{ app: 'wattwatchers' as const, appName: 'Wattwatchers Fleet', role: wwUser.role }] : []),
  ];
  const profileHref = pathname.startsWith('/solar')
    ? ssUser
      ? '/solar/settings'
      : eaUser
        ? '/ecoaudit/settings'
        : null
    : pathname.startsWith('/installhub')
      ? ihUser
        ? '/installhub/settings'
        : eaUser
          ? '/ecoaudit/settings'
          : null
    : pathname.startsWith('/fleet')
      ? eaUser
        ? '/ecoaudit/settings'
        : null
    : eaUser
      ? '/ecoaudit/settings'
      : ihUser
        ? '/installhub/settings'
        : PORTAL_FEATURES.solarSenseVisible && ssUser
          ? '/solar/settings'
          : null;
  const workspace = workspaceFor(pathname);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[280px] border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] p-5 lg:block">
        <Suspense fallback={<SidebarNavigation {...navigationProps} schedulerTab="calendar" idPrefix="desktop" />}>
          <QueryAwareSidebarNavigation {...navigationProps} idPrefix="desktop" />
        </Suspense>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-[var(--overlay)]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <aside
            ref={mobileDrawerRef}
            className="relative h-full w-[min(88vw,320px)] border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] p-5 shadow-[var(--shadow-md)]"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <button
              ref={mobileCloseRef}
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--sidebar-muted)] hover:bg-white/[0.08] hover:text-white"
              aria-label="Close navigation menu"
            >
              <Icon name="close" size={21} />
            </button>
            <Suspense fallback={<SidebarNavigation {...navigationProps} schedulerTab="calendar" idPrefix="mobile" onNavigate={() => setMobileOpen(false)} />}>
              <QueryAwareSidebarNavigation
                {...navigationProps}
                idPrefix="mobile"
                onNavigate={() => setMobileOpen(false)}
              />
            </Suspense>
          </aside>
        </div>
      ) : null}

      <div className="min-h-screen lg:pl-[280px]">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 shadow-[var(--shadow-xs)] backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface2)] lg:hidden"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
            >
              <Icon name="menu" size={22} />
            </button>
            <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] sm:flex">
              <Icon name={workspace.icon} size={19} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-[var(--text)]">{workspace.name}</p>
              <p className="hidden truncate text-xs text-[var(--text-sub)] sm:block">Sustainability operations workspace</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMode(isDark ? 'light' : 'dark')}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-sub)] hover:bg-[var(--surface2)] hover:text-[var(--primary)]"
              aria-label={isDark ? 'Use light theme' : 'Use dark theme'}
            >
              <Icon name={isDark ? 'sun' : 'moon'} size={19} />
            </button>
            <ProfileMenu
              displayName={displayName}
              appRoles={appRoles}
              profileHref={profileHref}
              onLogout={() => void handleLogout()}
            />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
