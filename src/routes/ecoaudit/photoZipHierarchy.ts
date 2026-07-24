import { extname } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  eaAdditionalSwitchboards,
  eaForkliftChargers,
  eaGeneralElectricity,
  eaGeneralWater,
  eaHotWaterSystems,
  eaHvacUnits,
  eaLightingSystems,
  eaMainSwitchboards,
  eaSolarPv,
  eaZones,
} from '../../db/schema/ecoaudit.js';
import type { PhotoRow } from '../../storage/photoCopyReferences.js';
import {
  canonicalEcoAuditPhotoFieldName,
  ecoAuditPhotoFieldAliases,
} from './lightingPhotoField.js';

export type EcoAuditPhotoZipMode = 'by-zone' | 'by-equipment';

export type EcoAuditPhotoZipEntity = {
  zoneName: string;
  sectionTitle: string;
  itemLabel: string;
  photoDescs: unknown;
};

export type EcoAuditPhotoZipContext = {
  entities: Map<string, EcoAuditPhotoZipEntity>;
};

type EcoAuditZipPhoto = Pick<
  PhotoRow,
  'entityType' | 'entityId' | 'fieldName' | 'originalFilename' | 'contentType'
>;

type PhotoField = { base: string; index?: number; raw: string };

const SECTION_TITLES: Record<string, string> = {
  zone: 'Zone Photos',
  main_switchboard: 'Electrical Infrastructure',
  additional_switchboard: 'Electrical Infrastructure',
  hvac_unit: 'HVAC Systems',
  lighting_system: 'Lighting Systems',
  solar_pv: 'Solar PV Infrastructure',
  forklift_charger: 'Forklift Charging Operations',
  hot_water_system: 'Hot Water Systems',
  general_water: 'General Water Systems',
  general_electricity: 'General Electricity Systems',
};

const FALLBACK_ITEM_LABELS: Record<string, string> = {
  zone: 'Zone',
  main_switchboard: 'Main Switchboard',
  additional_switchboard: 'Additional Switchboard',
  hvac_unit: 'HVAC Unit',
  lighting_system: 'Lighting System',
  solar_pv: 'Solar PV',
  forklift_charger: 'Forklift Charger',
  hot_water_system: 'Hot Water System',
  general_water: 'Water Item',
  general_electricity: 'Electricity Item',
};

const GENERAL_PHOTO_LABELS: Record<string, string> = {
  photo: 'Photo',
  roofPhoto: 'Roof / Array',
  inverterLabelPhoto: 'Inverter Label',
  electricityMeterPhoto: 'Electricity Meter',
  additionalSolarSpacePhoto: 'Additional Roof Space',
  switchboardPhoto: 'Switchboard',
  chargerPhoto: 'Charger',
  chargerLabelPhoto: 'Charger Label',
  electricConnectionPhoto: 'Electrical Connection',
  chargerSpacePhoto: 'Charger Space',
  socketConnectionPhoto: 'Socket Connection',
  fixturesPhoto: 'Fixtures Installed',
  mountingConstraintsPhoto: 'Mounting / Access',
  sensorsPhoto: 'Switches / Sensors',
  switchboardControlsPhoto: 'Switchboard / Controls',
  nameplatePhotos: 'Nameplate',
  controllerPhoto: 'Controller',
  indoorUnitNameplatePhoto: 'Indoor Unit Nameplate',
  additionalPhoto: 'Additional',
  extraPhotos: 'Extra Photo',
  photos: 'Photo',
};

const ENTITY_PHOTO_LABELS: Record<string, Record<string, string>> = {
  zone: { photos: 'Zone Photo' },
  main_switchboard: { photo: 'Main Switchboard' },
  additional_switchboard: { photo: 'Switchboard Photo' },
  hvac_unit: { photo: 'HVAC Unit' },
  lighting_system: { photo: 'Fixture' },
  hot_water_system: { photo: 'Hot Water System' },
};

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function parsePhotoField(fieldName: string): PhotoField {
  const raw = fieldName.trim();
  const indexed = /^(.+?)(?:\[(\d+)\]|\.(\d+)|_(\d+))$/.exec(raw);
  const rawBase = indexed?.[1] ?? raw;
  return {
    raw,
    base: canonicalEcoAuditPhotoFieldName(snakeToCamel(rawBase)),
    ...(indexed ? { index: Number(indexed[2] ?? indexed[3] ?? indexed[4]) } : {}),
  };
}

function photoMetadataKeys(field: PhotoField): string[] {
  const keys = [field.raw];
  for (const alias of ecoAuditPhotoFieldAliases(field.base)) {
    if (field.index === undefined) keys.push(alias);
    else keys.push(`${alias}.${field.index}`, `${alias}[${field.index}]`, `${alias}_${field.index}`);
  }
  return [...new Set(keys)];
}

function metadataName(value: unknown, field: PhotoField): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  for (const key of photoMetadataKeys(field)) {
    const raw = metadata[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const name = (raw as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return null;
}

function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text
    ? text.replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Other Equipment';
}

export function sanitizeEcoAuditZipName(value: string, max = 40): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, max)
    .replace(/[_. ]+$/, '') || 'unnamed';
}

function photoExtension(photo: EcoAuditZipPhoto): string {
  const original = extname(photo.originalFilename ?? '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif', '.jfif'].includes(original)) {
    return original;
  }
  const contentType = photo.contentType?.toLowerCase();
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/heic' || contentType === 'image/heif') return '.heic';
  return '.jpg';
}

function defaultPhotoLabel(entityType: string, field: PhotoField): string {
  const label = ENTITY_PHOTO_LABELS[entityType]?.[field.base]
    ?? GENERAL_PHOTO_LABELS[field.base]
    ?? humanize(field.base || 'Photo');
  return field.index === undefined ? label : `${label} ${field.index + 1}`;
}

function fallbackEntity(
  photo: Pick<EcoAuditZipPhoto, 'entityType' | 'entityId' | 'fieldName'>,
): EcoAuditPhotoZipEntity {
  return {
    zoneName: 'General',
    sectionTitle: SECTION_TITLES[photo.entityType] ?? humanize(photo.entityType),
    itemLabel: FALLBACK_ITEM_LABELS[photo.entityType] ?? humanize(photo.entityType),
    photoDescs: {},
  };
}

export function resolveEcoAuditPhotoCaption(
  context: EcoAuditPhotoZipContext,
  photo: Pick<EcoAuditZipPhoto, 'entityType' | 'entityId' | 'fieldName'>,
): string | null {
  const entity = context.entities.get(entityKey(photo.entityType, photo.entityId)) ?? fallbackEntity(photo);
  return metadataName(entity.photoDescs, parsePhotoField(photo.fieldName));
}

export function createEcoAuditPhotoZipEntryNamer(
  context: EcoAuditPhotoZipContext,
  mode: EcoAuditPhotoZipMode,
): (photo: EcoAuditZipPhoto) => string {
  const counts = new Map<string, number>();

  return (photo) => {
    const entity = context.entities.get(entityKey(photo.entityType, photo.entityId)) ?? fallbackEntity(photo);
    const field = parsePhotoField(photo.fieldName);
    const zone = sanitizeEcoAuditZipName(entity.zoneName || 'General');
    const section = sanitizeEcoAuditZipName(entity.sectionTitle);
    const item = sanitizeEcoAuditZipName(entity.itemLabel);
    const label = sanitizeEcoAuditZipName(
      resolveEcoAuditPhotoCaption(context, photo) ?? defaultPhotoLabel(photo.entityType, field),
    );
    const directory = mode === 'by-zone'
      ? `${zone}/${section}/${item}`
      : `${section}/${zone}/${item}`;
    const extension = photoExtension(photo);
    const basePath = `${directory}/${label}${extension}`;
    const duplicateIndex = counts.get(basePath) ?? 0;
    counts.set(basePath, duplicateIndex + 1);
    return duplicateIndex === 0
      ? basePath
      : `${directory}/${label}_${duplicateIndex}${extension}`;
  };
}

export function parseEcoAuditPhotoZipMode(value: unknown): EcoAuditPhotoZipMode {
  return value === 'by-equipment' ? 'by-equipment' : 'by-zone';
}

export async function loadEcoAuditPhotoZipContext(auditId: string): Promise<EcoAuditPhotoZipContext> {
  const [
    zones,
    mainSwitchboards,
    additionalSwitchboards,
    hvacUnits,
    lightingSystems,
    solarPv,
    forkliftChargers,
    hotWaterSystems,
    generalWater,
    generalElectricity,
  ] = await Promise.all([
    db.select().from(eaZones).where(eq(eaZones.auditId, auditId)).orderBy(asc(eaZones.createdAt)),
    db.select().from(eaMainSwitchboards).where(eq(eaMainSwitchboards.auditId, auditId)).orderBy(asc(eaMainSwitchboards.createdAt)),
    db.select().from(eaAdditionalSwitchboards).where(eq(eaAdditionalSwitchboards.auditId, auditId)).orderBy(asc(eaAdditionalSwitchboards.createdAt)),
    db.select().from(eaHvacUnits).where(eq(eaHvacUnits.auditId, auditId)).orderBy(asc(eaHvacUnits.createdAt)),
    db.select().from(eaLightingSystems).where(eq(eaLightingSystems.auditId, auditId)).orderBy(asc(eaLightingSystems.createdAt)),
    db.select().from(eaSolarPv).where(eq(eaSolarPv.auditId, auditId)).orderBy(asc(eaSolarPv.createdAt)),
    db.select().from(eaForkliftChargers).where(eq(eaForkliftChargers.auditId, auditId)).orderBy(asc(eaForkliftChargers.createdAt)),
    db.select().from(eaHotWaterSystems).where(eq(eaHotWaterSystems.auditId, auditId)).orderBy(asc(eaHotWaterSystems.createdAt)),
    db.select().from(eaGeneralWater).where(eq(eaGeneralWater.auditId, auditId)).orderBy(asc(eaGeneralWater.createdAt)),
    db.select().from(eaGeneralElectricity).where(eq(eaGeneralElectricity.auditId, auditId)).orderBy(asc(eaGeneralElectricity.createdAt)),
  ]);

  const entities = new Map<string, EcoAuditPhotoZipEntity>();
  const zoneNames = new Map(zones.map((zone) => [zone.id, zone.zoneName]));
  for (const zone of zones) {
    entities.set(entityKey('zone', zone.id), {
      zoneName: zone.zoneName,
      sectionTitle: SECTION_TITLES.zone,
      itemLabel: zone.zoneName,
      photoDescs: zone.photoDescs,
    });
  }

  const addEquipment = <T extends { id: string; zoneId: string; photoDescs: unknown }>(
    rows: readonly T[],
    entityType: string,
    itemLabel: (row: T, index: number) => string | null | undefined,
  ) => {
    rows.forEach((row, index) => {
      entities.set(entityKey(entityType, row.id), {
        zoneName: zoneNames.get(row.zoneId) ?? 'General',
        sectionTitle: SECTION_TITLES[entityType] ?? humanize(entityType),
        itemLabel: itemLabel(row, index)?.trim()
          || `${FALLBACK_ITEM_LABELS[entityType] ?? humanize(entityType)} ${index + 1}`,
        photoDescs: row.photoDescs,
      });
    });
  };

  addEquipment(mainSwitchboards, 'main_switchboard', (row) => row.name);
  addEquipment(additionalSwitchboards, 'additional_switchboard', (row) => row.name);
  addEquipment(hvacUnits, 'hvac_unit', (row) => row.unitName);
  addEquipment(lightingSystems, 'lighting_system', (row) => row.lightType);
  addEquipment(solarPv, 'solar_pv', () => 'Solar PV');
  addEquipment(forkliftChargers, 'forklift_charger', (row) => row.chargerType);
  addEquipment(hotWaterSystems, 'hot_water_system', (row) => row.dhwDetailsType);
  addEquipment(generalWater, 'general_water', (row, index) => row.question || `Water Item ${index + 1}`);
  addEquipment(generalElectricity, 'general_electricity', (row, index) => row.question || `Electricity Item ${index + 1}`);

  return { entities };
}
