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
