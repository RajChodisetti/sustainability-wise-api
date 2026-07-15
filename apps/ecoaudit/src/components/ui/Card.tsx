import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={`rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-xs)] sm:p-6 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-[-0.035em] text-[var(--text)] sm:text-[1.85rem]">
          {title}
        </h1>
        {subtitle ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--text-sub)]">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end" aria-label="Page actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function Spinner({ label = 'Loading…', fullPage = false }: { label?: string; fullPage?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center ${fullPage ? 'min-h-screen' : 'min-h-56 py-12'}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--primary)]"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold text-[var(--text-sub)]">{label}</span>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = 'clipboard',
  actions,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-10 text-center shadow-[var(--shadow-xs)] sm:px-8 sm:py-12">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
        <Icon name={icon} size={24} />
      </span>
      <p className="font-bold text-[var(--text)]">{title}</p>
      {description ? <p className="mx-auto mt-1.5 max-w-lg text-sm leading-6 text-[var(--text-sub)]">{description}</p> : null}
      {actions ? <div className="mt-5 flex justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--red)]/30 bg-[var(--red-soft)] px-4 py-3.5 text-sm font-medium leading-6 text-[var(--red)]"
      role="alert"
      aria-live="assertive"
    >
      <Icon name="activity" size={19} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    primary: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    success: 'bg-[var(--green-soft)] text-[var(--green)]',
    warning: 'bg-[var(--amber-soft)] text-[var(--amber)]',
    danger: 'bg-[var(--red-soft)] text-[var(--red)]',
  };

  return (
    <Card className="relative overflow-hidden !p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--text-sub)]">{label}</p>
          <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-[var(--text)] sm:text-[1.75rem]">{value}</p>
        </div>
        {icon ? (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
            <Icon name={icon} size={20} />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
