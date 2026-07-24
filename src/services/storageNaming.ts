import path from 'node:path';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  eaAdditionalSwitchboards,
  eaAudits,
  eaForkliftChargers,
  eaGeneralElectricity,
  eaGeneralWater,
  eaHotWaterSystems,
  eaHvacUnits,
  eaLightingSystems,
  eaMainSwitchboards,
  eaSolarPv,
  eaZones,
} from '../db/schema/ecoaudit.js';
import { photoRegistry } from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import {
  makeNamedLocalStorageKey,
  makeNamedPdfStorageKey,
  makeNamedStorageKeyForFilename,
  makeNamedStoragePrefix,
} from '../storage/localFiles.js';
import { badRequest, notFound } from '../utils/errors.js';

export type AppName = 'solarsense' | 'ecoaudit' | 'installhub';
export type PhotoRow = typeof photoRegistry.$inferSelect;

type SolarSite = typeof ssSites.$inferSelect;
type SolarAssessment = typeof ssRooftopAssessments.$inferSelect;
type EcoAudit = typeof eaAudits.$inferSelect;

type EcoEntityNameMaps = {
  audit: Map<string, EcoAudit>;
  zone: Map<string, typeof eaZones.$inferSelect>;
  mainSwitchboard: Map<string, typeof eaMainSwitchboards.$inferSelect>;
  additionalSwitchboard: Map<string, typeof eaAdditionalSwitchboards.$inferSelect>;
  hvacUnit: Map<string, typeof eaHvacUnits.$inferSelect>;
  lightingSystem: Map<string, typeof eaLightingSystems.$inferSelect>;
  solarPv: Map<string, typeof eaSolarPv.$inferSelect>;
  forkliftCharger: Map<string, typeof eaForkliftChargers.$inferSelect>;
  hotWaterSystem: Map<string, typeof eaHotWaterSystems.$inferSelect>;
  generalWater: Map<string, typeof eaGeneralWater.$inferSelect>;
  generalElectricity: Map<string, typeof eaGeneralElectricity.$inferSelect>;
};

export type StorageNameMaps = {
  solarSites: Map<string, SolarSite>;
  solarAssessments: Map<string, SolarAssessment>;
  ecoAudits: Map<string, EcoAudit>;
  ecoEntities: EcoEntityNameMaps;
};

function mapById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function isUuidish(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requireSingleMatch<T>(matches: T[], label: string, ref: string): T {
  if (matches.length === 0) throw notFound(label);
  if (matches.length > 1) {
    throw badRequest(`${label} name is ambiguous; use the id instead: ${ref}`);
  }
  return matches[0];
}

export async function loadStorageNameMaps(): Promise<StorageNameMaps> {
  const [
    solarSites,
    solarAssessments,
    ecoAudits,
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
    db.select().from(ssSites),
    db.select().from(ssRooftopAssessments),
    db.select().from(eaAudits),
    db.select().from(eaZones),
    db.select().from(eaMainSwitchboards),
    db.select().from(eaAdditionalSwitchboards),
    db.select().from(eaHvacUnits),
    db.select().from(eaLightingSystems),
    db.select().from(eaSolarPv),
    db.select().from(eaForkliftChargers),
    db.select().from(eaHotWaterSystems),
    db.select().from(eaGeneralWater),
    db.select().from(eaGeneralElectricity),
  ]);

  return {
    solarSites: mapById(solarSites),
    solarAssessments: mapById(solarAssessments),
    ecoAudits: mapById(ecoAudits),
    ecoEntities: {
      audit: mapById(ecoAudits),
      zone: mapById(zones),
      mainSwitchboard: mapById(mainSwitchboards),
      additionalSwitchboard: mapById(additionalSwitchboards),
      hvacUnit: mapById(hvacUnits),
      lightingSystem: mapById(lightingSystems),
      solarPv: mapById(solarPv),
      forkliftCharger: mapById(forkliftChargers),
      hotWaterSystem: mapById(hotWaterSystems),
      generalWater: mapById(generalWater),
      generalElectricity: mapById(generalElectricity),
    },
  };
}

export async function loadSolarsenseSiteByIdOrName(ref: string): Promise<SolarSite> {
  const rows = await db
    .select()
    .from(ssSites)
    .where(and(
      or(eq(ssSites.id, ref), eq(ssSites.siteName, ref)),
      isNull(ssSites.deletedAt),
    ));
  return requireSingleMatch(rows, 'Site', ref);
}

export async function loadSolarsenseAssessmentByIdOrName(ref: string): Promise<SolarAssessment> {
  const rows = await db
    .select()
    .from(ssRooftopAssessments)
    .where(and(
      or(eq(ssRooftopAssessments.id, ref), eq(ssRooftopAssessments.buildingIdName, ref)),
      isNull(ssRooftopAssessments.deletedAt),
    ));
  return requireSingleMatch(rows, 'Assessment', ref);
}

export async function loadEcoAuditByIdOrName(ref: string): Promise<EcoAudit> {
  const rows = await db
    .select()
    .from(eaAudits)
    .where(and(
      or(eq(eaAudits.id, ref), eq(eaAudits.siteName, ref)),
      isNull(eaAudits.deletedAt),
    ));
  return requireSingleMatch(rows, 'Audit', ref);
}

export async function loadPhotoByIdOrName(app: AppName, ref: string): Promise<PhotoRow> {
  const rows = await db
    .select()
    .from(photoRegistry)
    .where(and(
      eq(photoRegistry.app, app),
      or(
        eq(photoRegistry.id, ref),
        eq(photoRegistry.originalFilename, ref),
        eq(photoRegistry.storageKey, ref),
      ),
    ));
  if (rows.length === 0) {
    const basenameRows = await db.select().from(photoRegistry).where(eq(photoRegistry.app, app));
    return requireSingleMatch(
      basenameRows.filter((row) => row.storageKey && path.posix.basename(row.storageKey) === ref),
      'Photo',
      ref,
    );
  }
  return requireSingleMatch(rows, 'Photo', ref);
}

export function solarParentName(site: Pick<SolarSite, 'siteName' | 'id'> | undefined, fallbackId: string): string {
  return site?.siteName || fallbackId;
}

export function solarEntityName(args: {
  entityType: string;
  entityId: string;
  site?: Pick<SolarSite, 'siteName' | 'id'>;
  assessment?: Pick<SolarAssessment, 'buildingIdName' | 'id'>;
}): string {
  if (args.entityType === 'site') return args.site?.siteName || args.entityId;
  if (args.entityType === 'rooftop_assessment') return args.assessment?.buildingIdName || args.entityId;
  if (args.entityType === 'site-pack') return args.site?.siteName || args.entityId;
  return args.assessment?.buildingIdName || args.site?.siteName || args.entityId;
}

function normalizeEcoEntityType(entityType: string): keyof EcoEntityNameMaps | 'unknown' {
  switch (entityType) {
    case 'audit':
      return 'audit';
    case 'zone':
      return 'zone';
    case 'main_switchboard':
      return 'mainSwitchboard';
    case 'additional_switchboard':
      return 'additionalSwitchboard';
    case 'hvac_unit':
      return 'hvacUnit';
    case 'lighting_system':
      return 'lightingSystem';
    case 'solar_pv':
      return 'solarPv';
    case 'forklift_charger':
      return 'forkliftCharger';
    case 'hot_water_system':
      return 'hotWaterSystem';
    case 'general_water':
      return 'generalWater';
    case 'general_electricity':
      return 'generalElectricity';
    default:
      return 'unknown';
  }
}

export function ecoEntityName(args: {
  entityType: string;
  entityId: string;
  audit?: Pick<EcoAudit, 'siteName' | 'id'>;
  maps: EcoEntityNameMaps;
}): string {
  const normalized = normalizeEcoEntityType(args.entityType);
  switch (normalized) {
    case 'audit':
      return args.audit?.siteName || args.entityId;
    case 'zone':
      return args.maps.zone.get(args.entityId)?.zoneName || args.entityId;
    case 'mainSwitchboard':
      return args.maps.mainSwitchboard.get(args.entityId)?.name || args.entityId;
    case 'additionalSwitchboard':
      return args.maps.additionalSwitchboard.get(args.entityId)?.name || args.entityId;
    case 'hvacUnit':
      return args.maps.hvacUnit.get(args.entityId)?.unitName || args.entityId;
    case 'lightingSystem': {
      const item = args.maps.lightingSystem.get(args.entityId);
      return item?.brandModel || item?.lightType || args.entityId;
    }
    case 'solarPv': {
      const item = args.maps.solarPv.get(args.entityId);
      return item?.inverterBrandModel || 'solar-pv';
    }
    case 'forkliftCharger': {
      const item = args.maps.forkliftCharger.get(args.entityId);
      return item?.brandModel || item?.chargerType || args.entityId;
    }
    case 'hotWaterSystem':
      return args.maps.hotWaterSystem.get(args.entityId)?.dhwDetailsType || args.entityId;
    case 'generalWater':
      return args.maps.generalWater.get(args.entityId)?.question || 'general-water';
    case 'generalElectricity':
      return args.maps.generalElectricity.get(args.entityId)?.question || 'general-electricity';
    default:
      return args.entityId;
  }
}

export async function loadEcoEntityName(audit: EcoAudit, entityType: string, entityId: string): Promise<string> {
  if (entityType === 'audit' || entityId === audit.id) return audit.siteName;
  const maps = (await loadStorageNameMaps()).ecoEntities;
  return ecoEntityName({ entityType, entityId, audit, maps });
}

export function makePhotoStorageKeyFromNames(args: {
  app: AppName;
  parentName: string;
  entityType: string;
  entityName: string;
  fieldName: string;
  sessionId: string;
  filename: string;
}): string {
  return makeNamedLocalStorageKey(args);
}

export function makeExistingPhotoStorageKeyFromNames(args: {
  app: AppName;
  parentName: string;
  entityType: string;
  entityName: string;
  fieldName: string;
  currentStorageKey: string;
}): string {
  return makeNamedStorageKeyForFilename({
    app: args.app,
    parentName: args.parentName,
    entityType: args.entityType,
    entityName: args.entityName,
    fieldName: args.fieldName,
    filename: path.posix.basename(args.currentStorageKey),
  });
}

export function makePdfStorageKeyFromName(args: {
  app: AppName;
  parentName: string;
  fieldName: string;
  sessionId: string;
  filename: string;
}): string {
  return makeNamedPdfStorageKey(args);
}

export function makeExistingPdfStorageKeyFromName(args: {
  app: AppName;
  parentName: string;
  currentStorageKey: string;
}): string {
  return makeNamedStorageKeyForFilename({
    app: args.app,
    parentName: args.parentName,
    entityType: 'pdfs',
    filename: path.posix.basename(args.currentStorageKey),
  });
}

export function currentNamedPrefixForSolarSite(site: Pick<SolarSite, 'siteName'>): string {
  return makeNamedStoragePrefix({ app: 'solarsense', parentName: site.siteName });
}

export function currentNamedPrefixForSolarAssessment(
  site: Pick<SolarSite, 'siteName'>,
  assessment: Pick<SolarAssessment, 'buildingIdName'>,
): string {
  return makeNamedStoragePrefix({
    app: 'solarsense',
    parentName: site.siteName,
    entityType: 'rooftop_assessment',
    entityName: assessment.buildingIdName,
  });
}

export function currentNamedPrefixForEcoAudit(audit: Pick<EcoAudit, 'siteName'>): string {
  return makeNamedStoragePrefix({ app: 'ecoaudit', parentName: audit.siteName });
}

export function isLikelyLegacyStorageKey(storageKey: string): boolean {
  const [, parentSegment] = storageKey.split('/');
  return Boolean(parentSegment && isUuidish(parentSegment));
}
