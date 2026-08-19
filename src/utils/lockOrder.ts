/** Stable code-point ordering for application-managed row-lock sets. */
export function compareLockKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
