export function wholeBillingHours(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function isWholeBillingHoursInput(value: string): boolean {
  return /^\d*$/.test(value);
}

export function stepWholeBillingHours(value: string, direction: -1 | 1): string {
  const parsed = Number(value);
  const current = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  return Math.max(0, current + direction).toString();
}
