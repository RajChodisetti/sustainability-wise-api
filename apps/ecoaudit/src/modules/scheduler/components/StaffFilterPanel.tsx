'use client';

import { ErrorBanner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { usePortalAssignees } from '@/modules/scheduler/hooks/useScheduler';
import { initials } from '@/modules/scheduler/lib/weekGrid';
import type { PortalDirectoryUser } from '@/modules/scheduler/types/domain';

export function StaffFilterPanel({
  enabled,
  selectedIds,
  onChange,
  className = '',
}: {
  enabled: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const query = usePortalAssignees(enabled);
  const users = query.data ?? [];

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <aside
      id="scheduler-staff-filter-panel"
      className={`rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] ${className}`}
      aria-labelledby="scheduler-staff-filter-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="users" size={18} className="text-[var(--primary)]" />
            <h3 id="scheduler-staff-filter-title" className="text-sm font-extrabold text-[var(--text)]">
              Filter by staff
            </h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
            Show everyone, or choose one or more people. Selecting one also auto-assigns dropped jobs.
          </p>
        </div>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] px-3 text-xs font-bold text-[var(--primary)] hover:bg-[var(--primary-soft)]"
            onClick={() => onChange([])}
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        {query.isLoading ? (
          <p className="rounded-[var(--radius-sm)] bg-[var(--surface2)] px-3 py-4 text-xs text-[var(--text-sub)]">Loading staff…</p>
        ) : null}
        {query.error ? (
          <ErrorBanner message={(query.error as Error).message || 'Could not load staff'} />
        ) : null}
        {users.length > 0 ? (
          <fieldset>
            <legend className="sr-only">Staff shown on the calendar</legend>
            <div className="grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {users.map((u) => (
                <StaffRow
                  key={u.fieldUserId}
                  user={u}
                  checked={selectedIds.includes(u.fieldUserId)}
                  onToggle={() => toggle(u.fieldUserId)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}
        {!query.isLoading && !query.error && users.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] px-3 py-5 text-center text-xs text-[var(--text-sub)]">
            No portal users found.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function StaffRow({
  user,
  checked,
  onToggle,
}: {
  user: PortalDirectoryUser;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 transition-colors ${
      checked
        ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
        : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--surface2)]'
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 rounded border-[var(--border-strong)] accent-[var(--primary)]"
      />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[10px] font-extrabold text-[var(--primary)]">
        {initials(user.label)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-extrabold text-[var(--text)]">{user.label}</span>
        <span className="block truncate text-[10px] text-[var(--text-sub)]">{user.role}</span>
      </span>
    </label>
  );
}
