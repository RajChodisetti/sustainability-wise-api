export function scheduledStartUpdate(
  initialLocal: string,
  nextLocal: string,
  nextIso: string,
): { scheduledStartAt?: string } {
  return initialLocal === nextLocal ? {} : { scheduledStartAt: nextIso };
}
