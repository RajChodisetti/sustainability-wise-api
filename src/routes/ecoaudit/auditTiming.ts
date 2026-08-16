export type AuditTiming = {
  startedAt: Date | null;
  completedAt: Date | null;
};

export function resolveCompletionTiming(
  audit: Partial<AuditTiming> & { createdAt?: Date | null },
  now: Date,
): AuditTiming {
  return {
    startedAt: audit.startedAt ?? audit.createdAt ?? now,
    completedAt: audit.completedAt ?? now,
  };
}

export function resolveReopenTiming(audit: Partial<AuditTiming>): AuditTiming {
  return {
    startedAt: audit.startedAt ?? null,
    completedAt: null,
  };
}

export function resolveSyncedAuditTiming(input: {
  status: string;
  incomingStartedAt: Date | null;
  incomingCompletedAt: Date | null;
  existingStartedAt?: Date | null;
  existingCompletedAt?: Date | null;
  createdAt: Date;
  observedAt: Date;
}): AuditTiming {
  const startedAt = input.existingStartedAt
    ?? input.incomingStartedAt
    ?? (input.status === 'Completed' ? input.createdAt : null);

  return {
    startedAt,
    completedAt: input.status === 'Completed'
      // Completion is a server-owned fence. Client timestamps may describe
      // offline history, but cannot move the boundary used by active-time.
      ? (input.existingCompletedAt ?? input.observedAt)
      : null,
  };
}
