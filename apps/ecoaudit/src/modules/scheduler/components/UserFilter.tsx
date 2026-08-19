'use client';

import { FieldLabel, Select } from '@/components/ui/FormFields';
import { usePortalAssignees } from '@/modules/scheduler/hooks/useScheduler';

export function UserFilter({
  value,
  onChange,
  enabled,
}: {
  value: string;
  onChange: (fieldUserId: string) => void;
  enabled: boolean;
}) {
  const users = usePortalAssignees(enabled);

  if (!enabled) return null;

  return (
    <div className="min-w-[14rem]">
      <FieldLabel className="!mt-0">Assignee</FieldLabel>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All assignees</option>
        {(users.data ?? []).map((u) => (
          <option key={u.fieldUserId} value={u.fieldUserId}>
            {u.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
