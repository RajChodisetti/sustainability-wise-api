export function wholeBillingHours(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function isWholeBillingHoursInput(value: string): boolean {
  return /^\d*$/.test(value);
}
