import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';

export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-xs font-semibold text-[var(--text-sub)]">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? <Icon name="chevron-right" size={13} className="text-[var(--muted)]" /> : null}
          {item.href ? (
            <Link href={item.href} className="rounded px-1 py-1 text-[var(--primary)] hover:underline">{item.label}</Link>
          ) : (
            <span className="px-1 py-1" aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function WorkspaceLink({
  href,
  icon,
  title,
  description,
  count,
}: {
  href: string;
  icon: IconName;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="interactive-card h-full !p-4">
        <div className="flex min-h-20 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <Icon name={icon} size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-[var(--text)]">{title}</span>
              {typeof count === 'number' ? (
                <span className="rounded-full bg-[var(--surface2)] px-2 py-1 text-xs font-bold text-[var(--text-sub)]">{count}</span>
              ) : null}
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--text-sub)]">{description}</span>
          </span>
        </div>
      </Card>
    </Link>
  );
}

export type RecordNavigationItem = {
  href: string;
  icon: IconName;
  label: string;
  description: string;
  meta?: string | number;
};

export function RecordNavigation({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: RecordNavigationItem[];
}) {
  if (!items.length) return null;
  return (
    <Card className="mb-5 !p-4">
      <div>
        <h2 className="font-extrabold text-[var(--text)]">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{description}</p>
      </div>
      <nav aria-label={title} className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Link
            key={`${item.href}-${item.label}`}
            href={item.href}
            className="group flex min-h-14 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 transition hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--primary)]">
              <Icon name={item.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-extrabold text-[var(--text)]">{item.label}</span>
                {item.meta !== undefined ? <span className="shrink-0 rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-bold text-[var(--text-sub)]">{item.meta}</span> : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--text-sub)]">{item.description}</span>
            </span>
            <Icon name="chevron-right" size={16} className="shrink-0 text-[var(--muted)] group-hover:text-[var(--primary)]" />
          </Link>
        ))}
      </nav>
    </Card>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--muted)]">{item.label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold text-[var(--text)]">{item.value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'success';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-[var(--primary)]/25 bg-[var(--primary-soft)] text-[var(--primary)]',
    warning: 'border-[var(--amber)]/30 bg-[var(--amber-soft)] text-[var(--text)]',
    success: 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`} role="status">
      {children}
    </div>
  );
}
