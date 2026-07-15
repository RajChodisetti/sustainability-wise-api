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

export function resolveSyncedAuditTiming(input: {
  status: string;
  incomingStartedAt: Date | null;
  incomingCompletedAt: Date | null;
  existingStartedAt?: Date | null;
  existingCompletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AuditTiming {
  const startedAt = input.incomingStartedAt
    ?? input.existingStartedAt
    ?? (input.status === 'Completed' ? input.createdAt : null);

  return {
    startedAt,
    completedAt: input.status === 'Completed'
      ? (input.incomingCompletedAt ?? input.existingCompletedAt ?? input.updatedAt)
      : null,
  };
}
