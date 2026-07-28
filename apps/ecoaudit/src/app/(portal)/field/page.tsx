'use client';

import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { usePortalAuth } from '@/contexts/PortalAuthContext';

export default function FieldAppPage() {
  const { eaUser, ssUser, ihUser } = usePortalAuth();
  const canOpenInstallHub = Boolean(ihUser || eaUser || ssUser);

  return (
    <div>
      <PageHeader
        title="Field App"
        subtitle="Open your available mobile field workflow from the shared EcoSense Portal."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/installhub/dashboard"
          aria-label={`${canOpenInstallHub ? 'Open' : 'Sign in to'} InstallHub`}
          className="group block cursor-pointer rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
        >
          <Card className="interactive-card h-full !p-5 sm:!p-6">
            <div className="flex h-full min-h-52 flex-col">
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  <Icon name="tool" size={24} />
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
                    canOpenInstallHub
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-[var(--border)] bg-[var(--surface2)] text-[var(--text-sub)]'
                  }`}
                >
                  {canOpenInstallHub ? 'Available' : 'Sign in required'}
                </span>
              </div>
              <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">
                Installation operations
              </p>
              <h2 className="mt-1 text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">
                InstallHub
              </h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-[var(--text-sub)]">
                Manage installations, switchboards, meters, assets, commissioning forms,
                evidence, and PDF report packs.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
                {canOpenInstallHub ? 'Open InstallHub' : 'Sign in to InstallHub'} <Icon name="arrow-right" size={17} />
              </span>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
