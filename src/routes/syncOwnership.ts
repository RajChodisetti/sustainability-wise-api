export type SyncActor = {
  userId: string;
  role: string;
};

/**
 * Existing ownership is immutable. New non-elevated sync records always belong
 * to the authenticated actor; only trusted elevated imports may preserve an
 * incoming creator.
 */
export function resolveSyncCreatedByUserId(input: {
  existingRecord: boolean;
  existingCreatedByUserId: string | null | undefined;
  incomingCreatedByUserId: unknown;
  actor: SyncActor;
}): string | null {
  if (input.existingRecord) return input.existingCreatedByUserId ?? null;
  const elevated = input.actor.role === 'admin' || input.actor.role === 'service_account';
  if (elevated && typeof input.incomingCreatedByUserId === 'string' && input.incomingCreatedByUserId.trim()) {
    return input.incomingCreatedByUserId.trim();
  }
  return input.actor.userId;
}
