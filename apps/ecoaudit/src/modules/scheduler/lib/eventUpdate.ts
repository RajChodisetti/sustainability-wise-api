export function scheduledStartUpdate(
  initialLocal: string,
  nextLocal: string,
  nextIso: string,
): { scheduledStartAt?: string } {
  return initialLocal === nextLocal ? {} : { scheduledStartAt: nextIso };
}

export function shouldCompleteLinkedProductJob(input: {
  currentStatus: string;
  nextStatus: string;
  sourceApp: string;
  sourceType: string;
  sourceId: string | null;
}): boolean {
  return input.nextStatus === 'done'
    && input.currentStatus !== 'done'
    && input.sourceApp !== 'custom'
    && input.sourceType !== 'custom'
    && Boolean(input.sourceId?.trim());
}
