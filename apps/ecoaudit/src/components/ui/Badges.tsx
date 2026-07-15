function badgeClass(extra: string): string {
  return `inline-flex min-h-7 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold leading-none ${extra}`;
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />;
}

export function StatusBadge({ status }: { status: string }) {
  const isCompleted = status === 'Completed';
  return (
    <span
      className={badgeClass(
        isCompleted
          ? 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]'
          : 'border-[var(--border-strong)] bg-[var(--surface2)] text-[var(--text-sub)]',
      )}
    >
      <Dot />
      {status}
    </span>
  );
}

export function ViabilityBadge({ value }: { value?: string | null }) {
  const color =
    value === 'Yes' ? 'border-[var(--green)]/25 text-[var(--green)] bg-[var(--green-soft)]' :
    value === 'No' ? 'border-[var(--red)]/25 text-[var(--red)] bg-[var(--red-soft)]' :
    'border-[var(--amber)]/25 text-[var(--amber)] bg-[var(--amber-soft)]';
  return <span className={badgeClass(color)}><Dot />{value || 'TBD'}</span>;
}

export function RAGBadge({ value }: { value?: string | null }) {
  const color =
    value === 'Green' ? 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]' :
    value === 'Amber' ? 'border-[var(--amber)]/25 bg-[var(--amber-soft)] text-[var(--amber)]' :
    value === 'Red' ? 'border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]' :
    'border-[var(--border-strong)] bg-[var(--surface2)] text-[var(--text-sub)]';
  return <span className={badgeClass(color)}><Dot />{value || '—'}</span>;
}

export function DealBreakerFlag({ active, label = 'Deal breaker' }: { active: boolean; label?: string }) {
  if (!active) return null;
  return (
    <span className={badgeClass('border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]')}>
      <Dot />
      {label}
    </span>
  );
}
