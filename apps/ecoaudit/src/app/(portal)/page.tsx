'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { PORTAL_FEATURES } from '@/lib/portalFeatures';

const apps: Array<{
  href: string;
  title: string;
  eyebrow: string;
  description: string;
  icon: IconName;
  tone: string;
  access?: 'ecoaudit' | 'solarsense' | 'wattwatchers';
  soon?: boolean;
}> = [
  {
    href: '/ecoaudit/dashboard',
    title: 'Eco Audit',
    eyebrow: 'Energy operations',
    description: 'Site energy audits, zones, equipment, photos, and PDF reports.',
    icon: 'leaf',
    tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    access: 'ecoaudit',
  },
  {
    href: '/solar/dashboard',
    title: 'Solar Sense',
    eyebrow: 'Solar assessment',
    description: 'Solar sites, assessments, photo packs, and cloud backup.',
    icon: 'sun',
    tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    access: 'solarsense',
  },
  {
    href: '/fleet/dashboard',
    title: 'Wattwatchers Fleet',
    eyebrow: 'Device operations',
    description: 'Fleet connectivity, offline devices, client performance, reports, and collection health.',
    icon: 'activity',
    tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    access: 'wattwatchers',
  },
  {
    href: '/field',
    title: 'Field App',
    eyebrow: 'Mobile operations',
    description: 'Mobile field workflows — coming soon.',
    icon: 'clipboard',
    tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    soon: true,
  },
];

export default function PortalHomePage() {
  const { eaUser, ssUser, wwUser } = usePortalAuth();
  const visibleApps = apps.filter((app) => {
    if (app.access === 'ecoaudit') return Boolean(eaUser);
    if (app.access === 'solarsense') {
      return PORTAL_FEATURES.solarSenseVisible && Boolean(ssUser);
    }
    if (app.access === 'wattwatchers') return Boolean(wwUser);
    return true;
  });

  return (
    <div>
      <section className="relative mb-8 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-5 py-8 shadow-[var(--shadow-xs)] sm:px-8 sm:py-10 lg:px-10">
        <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.13em] text-[var(--primary)]">Operations gateway</p>
          <h1 className="text-3xl font-extrabold leading-tight tracking-[-0.045em] text-[var(--text)] sm:text-4xl">
            Welcome to EcoSense Portal
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--text-sub)] sm:text-base">
            Choose a workspace to continue your audits, fleet monitoring, scheduling, and field operations.
          </p>
        </div>
      </section>

      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Applications</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Your connected sustainability tools.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleApps.map((app) => (
          <Link key={app.href} href={app.href} className="group block rounded-[var(--radius-md)]">
            <Card className="interactive-card h-full !p-5 sm:!p-6">
              <div className="flex h-full min-h-44 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${app.tone}`}>
                    <Icon name={app.icon} size={24} />
                  </span>
                  {app.soon ? (
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-sub)]">
                      Coming soon
                    </span>
                  ) : null}
                </div>
                <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">{app.eyebrow}</p>
                <h3 className="mt-1 text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">{app.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-[var(--text-sub)]">{app.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
                  Open workspace <Icon name="arrow-right" size={17} />
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <Link href="/scheduler" className="interactive-card mt-5 flex min-h-16 items-center gap-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-5 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
          <Icon name="calendar" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-[var(--text)]">Scheduler</span>
          <span className="block truncate text-xs text-[var(--text-sub)]">Plan and coordinate upcoming work.</span>
        </span>
        <Icon name="chevron-right" size={19} className="text-[var(--muted)]" />
      </Link>
    </div>
  );
}
