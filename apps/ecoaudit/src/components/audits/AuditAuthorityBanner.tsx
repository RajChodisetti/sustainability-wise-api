'use client';

import { Button } from '@/components/ui/Button';
import { auditLeaseLabel, type AuditAuthorityState } from '@/lib/auditProtocol';
import type { AuditEditLease } from '@/types/domain';

export function AuditAuthorityBanner({
  state,
  lease,
  changedSinceOpen = false,
  completedPhotoMetadataEditable = false,
  onRefresh,
  refreshing = false,
}: {
  state: AuditAuthorityState;
  lease?: AuditEditLease | null;
  changedSinceOpen?: boolean;
  completedPhotoMetadataEditable?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  if (changedSinceOpen) {
    return (
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] px-4 py-3 text-sm text-[var(--text)] sm:flex-row sm:items-center sm:justify-between" role="alert">
        <div>
          <p className="font-bold">A newer cloud version is available</p>
          <p className="mt-1 text-[var(--text-sub)]">This page has been made read-only so older values cannot overwrite it. Reload the latest version before editing.</p>
        </div>
        {onRefresh ? <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Reload latest'}</Button> : null}
      </div>
    );
  }

  if (state === 'owned') {
    return (
      <div className="mb-5 rounded-xl border border-[var(--green)]/30 bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--green)]" role="status">
        <p className="font-bold">Editing on this browser</p>
        <p className="mt-1">Cloud revision protection is active. Other devices can review this audit but cannot change or complete it.</p>
      </div>
    );
  }

  if (state === 'completed') {
    return (
      <div className="mb-5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] px-4 py-3 text-sm text-[var(--text)]" role="status">
        <p className="font-bold">Completed audit — read-only</p>
        <p className="mt-1 text-[var(--text-sub)]">
          {completedPhotoMetadataEditable
            ? 'The business record is preserved. Administrators may correct photo captions and PDF layout only; create an editable copy for any other change.'
            : 'The completed cloud record is preserved. Create an editable copy to make further changes.'}
        </p>
      </div>
    );
  }

  if (state === 'owned-token-missing') {
    return (
      <div className="mb-5 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] px-4 py-3 text-sm text-[var(--text)]" role="alert">
        <p className="font-bold">Editing proof is unavailable</p>
        <p className="mt-1 text-[var(--text-sub)]">This browser no longer has the secret required to prove ownership. It must remain read-only unless an administrator performs an audited takeover.</p>
      </div>
    );
  }

  if (state === 'owned-expired') {
    return (
      <div className="mb-5 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] px-4 py-3 text-sm text-[var(--text)]" role="alert">
        <p className="font-bold">Editing access has expired</p>
        <p className="mt-1 text-[var(--text-sub)]">This browser still has the ownership proof. Return to the audit overview to renew it safely before editing.</p>
      </div>
    );
  }

  const owner = state === 'other-owner' ? auditLeaseLabel(lease) : null;
  return (
    <div className="mb-5 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] px-4 py-3 text-sm text-[var(--text)]" role="status">
      <p className="font-bold">Read-only on this browser</p>
      <p className="mt-1 text-[var(--text-sub)]">
        {owner
          ? `This audit is currently being edited on ${owner}. Only that editor can save or complete it.`
          : 'This in-progress audit has not been claimed by this browser. Open the audit overview to request editing access.'}
      </p>
    </div>
  );
}
