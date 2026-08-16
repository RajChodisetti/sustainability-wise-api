'use client';

import { FieldLabel } from '@/components/ui/FormFields';
import { usePortalAssignees } from '@/modules/scheduler/hooks/useScheduler';
import { initials } from '@/modules/scheduler/lib/weekGrid';
import type { PortalDirectoryUser } from '@/modules/scheduler/types/domain';

export function StaffFilterPanel({
  enabled,
  selectedIds,
  onChange,
}: {
  enabled: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
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
    <aside className="flex h-full min-h-[28rem] w-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] lg:w-52 xl:w-56">
      <div className="border-b border-[var(--border)] px-3 py-3">
        <FieldLabel className="!mt-0">Staff filter</FieldLabel>
        <p className="mt-1 text-[11px] font-semibold text-[var(--text-sub)]">
          Empty = all staff. Pick one to auto-assign drops.
        </p>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            className="mt-2 text-xs font-bold text-[var(--primary)] hover:underline"
            onClick={() => onChange([])}
          >
            Clear selection
          </button>
        ) : null}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {query.isLoading ? (
          <p className="px-2 py-3 text-xs text-[var(--text-sub)]">Loading staff…</p>
        ) : null}
        {users.map((u) => (
          <StaffRow
            key={u.fieldUserId}
            user={u}
            checked={selectedIds.includes(u.fieldUserId)}
            onToggle={() => toggle(u.fieldUserId)}
          />
        ))}
        {!query.isLoading && users.length === 0 ? (
          <p className="px-2 py-3 text-xs text-[var(--text-sub)]">No portal users found.</p>
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
    <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 hover:bg-[var(--surface2)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-[var(--border-strong)]"
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
