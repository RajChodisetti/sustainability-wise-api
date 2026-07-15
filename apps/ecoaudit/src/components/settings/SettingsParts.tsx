import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2.5 text-sm font-extrabold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)]">
        {children}
      </div>
    </section>
  );
}

export function SettingsMenuItem({
  to,
  href,
  onClick,
  icon,
  label,
  trailing,
}: {
  to?: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
}) {
  const className =
    'group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface2)] sm:px-5';
  const inner = (
    <>
      {icon ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{label}</span>
      {trailing ?? <Icon name="chevron-right" size={18} className="shrink-0 text-[var(--muted)] group-hover:text-[var(--primary)]" />}
    </>
  );
  const link = to ?? href;
  if (link) return <Link href={link} className={className}>{inner}</Link>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}

export function SettingsDivider() {
  return <div className="mx-4 h-px bg-[var(--border)] sm:mx-5" aria-hidden="true" />;
}

export function SettingsInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 flex-col justify-center gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <span className="font-medium text-[var(--text-sub)]">{label}</span>
      <span className="min-w-0 break-words font-semibold text-[var(--text)] sm:max-w-[65%] sm:text-right">{value}</span>
    </div>
  );
}
