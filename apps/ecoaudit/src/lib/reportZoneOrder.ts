export function reconcileReportZoneOrder(current: string[], available: string[]): string[] {
  const availableSet = new Set(available);
  const next = current.filter((id) => availableSet.has(id));
  const seen = new Set(next);
  for (const id of available) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function moveReportZone(
  order: string[],
  zoneId: string,
  direction: -1 | 1,
): string[] {
  const currentIndex = order.indexOf(zoneId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = [...order];
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return next;
}

export function orderReportZoneRecords<T extends { id: string }>(
  zones: T[],
  order: string[],
): T[] {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  return reconcileReportZoneOrder(order, zones.map((zone) => zone.id))
    .map((id) => zoneById.get(id))
    .filter((zone): zone is T => zone !== undefined);
}
