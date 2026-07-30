type OrderedRecord = {
  id: string;
  createdAt?: Date | string | null;
};

type ZonedOrderedRecord = OrderedRecord & {
  zoneId: string;
};

function createdAtMillis(value: Date | string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : Number.MAX_SAFE_INTEGER;
}

function compareCreatedAtThenId(a: OrderedRecord, b: OrderedRecord): number {
  const createdAtDifference = createdAtMillis(a.createdAt) - createdAtMillis(b.createdAt);
  return createdAtDifference || a.id.localeCompare(b.id);
}

export function normalizeReportIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function orderReportZones<T extends OrderedRecord>(
  zones: T[],
  requestedOrder: string[],
): T[] {
  const requestedIndexes = new Map(requestedOrder.map((id, index) => [id, index]));
  return [...zones].sort((a, b) => {
    const aIndex = requestedIndexes.get(a.id);
    const bIndex = requestedIndexes.get(b.id);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return compareCreatedAtThenId(a, b);
  });
}

export function orderReportItemsByZone<T extends ZonedOrderedRecord>(
  items: T[],
  orderedZoneIds: string[],
): T[] {
  const zoneIndexes = new Map(orderedZoneIds.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const aZoneIndex = zoneIndexes.get(a.zoneId) ?? Number.MAX_SAFE_INTEGER;
    const bZoneIndex = zoneIndexes.get(b.zoneId) ?? Number.MAX_SAFE_INTEGER;
    return aZoneIndex - bZoneIndex || compareCreatedAtThenId(a, b);
  });
}
