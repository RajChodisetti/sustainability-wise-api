function badgeClass(extra: string): string {
  return `inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold leading-none ${extra}`;
}

export function StatusBadge({ status }: { status: string }) {
  const isCompleted = status === 'Completed';
  return (
    <span
      className={badgeClass(
        isCompleted
          ? 'border border-[var(--green)]/30 bg-[var(--green)]/15 text-[var(--green)]'
          : 'border border-[var(--border)] bg-[var(--surface2)] text-[var(--text-sub)]',
      )}
    >
      {status}
    </span>
  );
}

export function ViabilityBadge({ value }: { value?: string | null }) {
  const color =
    value === 'Yes' ? 'border border-[var(--green)]/30 text-[var(--green)] bg-[var(--green)]/15' :
    value === 'No' ? 'border border-[var(--red)]/30 text-[var(--red)] bg-[var(--red)]/15' :
    'border border-[var(--border)] text-[var(--text-sub)] bg-[var(--surface2)]';
  return <span className={badgeClass(color)}>{value || 'TBD'}</span>;
}

export function RAGBadge({ value }: { value?: string | null }) {
  const color =
    value === 'Green' ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-600' :
    value === 'Amber' ? 'border border-amber-500/30 bg-amber-500/15 text-amber-600' :
    value === 'Red' ? 'border border-red-500/30 bg-red-500/15 text-red-600' :
    'border border-[var(--border)] bg-[var(--surface2)] text-[var(--text-sub)]';
  return <span className={badgeClass(color)}>{value || '—'}</span>;
}

export function DealBreakerFlag({ active, label = 'Deal breaker' }: { active: boolean; label?: string }) {
  if (!active) return null;
  return (
    <span className={badgeClass('border border-[var(--red)]/30 bg-[var(--red)]/15 text-[var(--red)]')}>
      {label}
    </span>
  );
}
