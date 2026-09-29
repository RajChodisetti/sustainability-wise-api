import { request } from '@/api/client';
import type { AuditMutationGuard, AuditWriteGuard, EquipmentBase } from '@/types/domain';
import { getEquipmentConfig, getWaterAssetConfig, type EquipmentTypeConfig, type FieldCalculation } from '@/lib/equipmentConfig';
import { normalizePhotoDescsRecord } from '@/lib/photoMetadata';
import { auditMutationHeaders, auditWriteHeaders } from '@/lib/auditProtocol';

type EquipmentWireRecord = EquipmentBase & { photo_descs?: unknown };

function basePath(config: EquipmentTypeConfig, auditId: string): string {
  return `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/${config.apiSlug ?? config.slug}`;
}

function itemPath(config: EquipmentTypeConfig, id: string): string {
  return `/v1/ecoaudit/${config.apiSlug ?? config.slug}/${encodeURIComponent(id)}`;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function calculate(values: Record<string, unknown>, calculation: FieldCalculation): number | null {
  const first = Number(values[calculation.operands[0]]);
  if (!Number.isFinite(first)) return null;
  let result: number;
  if (calculation.operation === 'divide') {
    const second = Number(values[calculation.operands[1] ?? '']);
    if (!Number.isFinite(second) || second === 0) return null;
    result = first / second;
  } else {
    const secondKey = calculation.operands[1];
    const second = secondKey ? Number(values[secondKey]) : calculation.factor ?? 1;
    if (!Number.isFinite(second)) return null;
    result = first * second * (secondKey ? calculation.factor ?? 1 : 1);
  }
  const places = calculation.decimalPlaces ?? 2;
  return Number(result.toFixed(places));
}

function normalizeEquipmentRecord(record: EquipmentWireRecord, config: EquipmentTypeConfig): EquipmentBase {
  const rest = { ...record };
  delete rest.photo_descs;
  if (!config.assetType) return { ...rest, photoDescs: normalizePhotoDescsRecord(record) };
  const data = jsonObject(record.data);
  return {
    ...rest,
    ...data,
    data,
    photos: jsonArray(record.photos).filter((value): value is string => typeof value === 'string'),
    customFields: jsonArray(record.customFields ?? record.custom_fields),
    photoDescs: normalizePhotoDescsRecord(record),
  };
}

function normalizeEquipmentBody<T extends object>(
  body: T,
  config: EquipmentTypeConfig,
  options?: { includeAssetType?: boolean },
): T {
  const record = body as Record<string, unknown>;
  const rest = { ...record };
  delete rest.photo_descs;
  if ('photoDescs' in record || 'photo_descs' in record) {
    rest.photoDescs = normalizePhotoDescsRecord(record);
  }
  if (!config.assetType) return rest as T;

  const data = { ...jsonObject(record.data) };
  let dataTouched = 'data' in record;
  for (const field of config.fields) {
    if (field.storage !== 'data') continue;
    if (field.condition && !field.condition.values.includes(String(record[field.condition.key] ?? ''))) {
      delete data[field.key];
      delete rest[field.key];
      continue;
    }
    if (field.key in record) dataTouched = true;
    const next = field.calculation ? calculate(record, field.calculation) : record[field.key];
    if (next === undefined) continue;
    data[field.key] = next;
    delete rest[field.key];
  }
  const normalized: Record<string, unknown> = {
    ...rest,
  };
  if (options?.includeAssetType || 'assetType' in record) normalized.assetType = config.assetType;
  if (dataTouched) normalized.data = data;
  else delete normalized.data;
  if ('photos' in record) {
    normalized.photos = jsonArray(record.photos).filter((value): value is string => typeof value === 'string');
  }
  if ('customFields' in record) normalized.customFields = jsonArray(record.customFields);
  return normalized as T;
}

export async function listEquipment(slug: string, auditId: string): Promise<{ data: EquipmentBase[] }> {
  const config = getEquipmentConfig(slug);
  if (!config) throw new Error('Unknown equipment type');
  const response = await request<{ data: EquipmentWireRecord[] }>('GET', basePath(config, auditId));
  const records = config.assetType
    ? response.data.filter((record) => record.assetType === config.assetType || record.asset_type === config.assetType)
    : response.data;
  return {
    ...response,
    data: records.map((record) => normalizeEquipmentRecord(record, getWaterAssetConfig(record.assetType ?? record.asset_type) ?? config)),
  };
}

export async function getEquipment(slug: string, id: string): Promise<EquipmentBase> {
  const config = getEquipmentConfig(slug);
  if (!config) throw new Error('Unknown equipment type');
  const record = await request<EquipmentWireRecord>('GET', itemPath(config, id));
  return normalizeEquipmentRecord(record, getWaterAssetConfig(record.assetType ?? record.asset_type) ?? config);
}

export async function createEquipment(
  slug: string,
  auditId: string,
  body: Record<string, unknown>,
  guard: AuditWriteGuard,
): Promise<EquipmentBase> {
  const config = getEquipmentConfig(slug);
  if (!config) throw new Error('Unknown equipment type');
  return normalizeEquipmentRecord(
    await request<EquipmentWireRecord>(
      'POST',
      basePath(config, auditId),
      normalizeEquipmentBody(body, config, { includeAssetType: true }),
      { headers: auditWriteHeaders(guard) },
    ),
    config,
  );
}

export async function updateEquipment(
  slug: string,
  id: string,
  body: Record<string, unknown>,
  guard: AuditMutationGuard,
): Promise<EquipmentBase> {
  const routeConfig = getEquipmentConfig(slug);
  if (!routeConfig) throw new Error('Unknown equipment type');
  const config = getWaterAssetConfig(body.assetType) ?? routeConfig;
  return normalizeEquipmentRecord(
    await request<EquipmentWireRecord>(
      'PATCH',
      itemPath(config, id),
      normalizeEquipmentBody(body, config),
      { headers: auditMutationHeaders(guard) },
    ),
    config,
  );
}

export function deleteEquipment(slug: string, id: string, guard: AuditWriteGuard): Promise<void> {
  const config = getEquipmentConfig(slug);
  if (!config) return Promise.reject(new Error('Unknown equipment type'));
  return request<void>('DELETE', itemPath(config, id), undefined, {
    headers: auditWriteHeaders(guard),
  });
}
