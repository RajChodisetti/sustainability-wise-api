import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
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
import { photoCopyReferences, photoRegistry } from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import { deleteLocalFile } from './localFiles.js';
import type { PhotoApp } from './photoReference.js';

type DbExecutor = typeof db;
export type PhotoRow = typeof photoRegistry.$inferSelect;

export type CopiedPhotoEntity = {
  sourceEntityId: string;
  targetEntityId: string;
  targetEntityType: string;
  /** Only fields that can actually contain photo references should be passed. */
  photoValues: unknown;
  photoReferences?: PhotoFieldReference[];
};

export type PhotoFieldReference = { photoId: string; targetFieldName: string };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const ECO_PHOTO_FIELDS = [
  'photos',
  'photo',
  'extraPhotos',
  'nameplatePhotos',
  'indoorUnitNameplatePhoto',
  'controllerPhoto',
  'fixturesPhoto',
  'mountingConstraintsPhoto',
  'sensorsPhoto',
  'roofPhoto',
  'inverterLabelPhoto',
  'electricityMeterPhoto',
  'additionalSolarSpacePhoto',
  'switchboardPhoto',
  'chargerPhoto',
  'chargerLabelPhoto',
  'electricConnectionPhoto',
  'chargerSpacePhoto',
  'socketConnectionPhoto',
  'additionalPhoto',
] as const;

function valuesForKeys(record: Record<string, unknown>, keys: readonly string[]): unknown[] {
  return keys.filter((key) => key in record).map((key) => record[key]);
}

/** Exact EcoAudit photo-bearing columns across zones and every equipment table. */
export function ecoPhotoValues(record: Record<string, unknown>): unknown[] {
  return valuesForKeys(record, ECO_PHOTO_FIELDS);
}

/** Site-level SolarSense images/documents are stored in appendixItems. */
export function solarSitePhotoValues(record: Record<string, unknown>): unknown[] {
  return valuesForKeys(record, ['appendixItems']);
}

/** Exact SolarSense assessment fields that can contain photo URIs. */
export function solarAssessmentPhotoValues(record: Record<string, unknown>): unknown[] {
  return valuesForKeys(record, [
    'aerialPhotoUri',
    'msbPhotoUri',
    'switchboards',
    'otherConsiderations',
    'additionalPhotos',
  ]);
}

export function collectImmutablePhotoIds(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(UUID_RE)) into.add(match[0].toLowerCase());
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImmutablePhotoIds(item, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectImmutablePhotoIds(item, into);
    }
  }
  return into;
}

function referencesAt(value: unknown, targetFieldName: string): PhotoFieldReference[] {
  if (typeof value !== 'string') return [];
  return [...collectImmutablePhotoIds(value)].map((photoId) => ({ photoId, targetFieldName }));
}

function indexedReferences(value: unknown, fieldName: string): PhotoFieldReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => referencesAt(item, `${fieldName}[${index}]`));
}

export function ecoPhotoFieldReferences(record: Record<string, unknown>): PhotoFieldReference[] {
  return ECO_PHOTO_FIELDS.flatMap((fieldName) => {
    const value = record[fieldName];
    return Array.isArray(value)
      ? indexedReferences(value, fieldName)
      : referencesAt(value, fieldName);
  });
}

export function solarSitePhotoFieldReferences(record: Record<string, unknown>): PhotoFieldReference[] {
  const items = Array.isArray(record.appendixItems) ? record.appendixItems : [];
  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const appendixItem = item as Record<string, unknown>;
    // The shared contract requires an explicit type. Missing/legacy types are
    // intentionally not guessed because document URIs must never receive image
    // thumbnail authorization.
    if (appendixItem.type !== 'image') return [];
    return referencesAt(appendixItem.uri, `appendix_items[${index}].uri`);
  });
}

export function solarAssessmentPhotoFieldReferences(record: Record<string, unknown>): PhotoFieldReference[] {
  const references = [
    ...referencesAt(record.aerialPhotoUri, 'aerial_photo_uri'),
    ...referencesAt(record.msbPhotoUri, 'msb_photo_uri'),
    ...indexedReferences(record.additionalPhotos, 'additional_photos'),
  ];
  const switchboards = Array.isArray(record.switchboards) ? record.switchboards : [];
  switchboards.forEach((switchboard, index) => {
    if (!switchboard || typeof switchboard !== 'object') return;
    references.push(...referencesAt(
      (switchboard as Record<string, unknown>).photoUri
        ?? (switchboard as Record<string, unknown>).photo_uri,
      `switchboards[${index}].photoUri`,
    ));
  });
  const considerations = Array.isArray(record.otherConsiderations) ? record.otherConsiderations : [];
  considerations.forEach((consideration, index) => {
    if (!consideration || typeof consideration !== 'object') return;
    const item = consideration as Record<string, unknown>;
    const photos = item.photoUris ?? item.photo_uris;
    if (!Array.isArray(photos)) return;
    photos.forEach((photo, photoIndex) => {
      references.push(...referencesAt(
        photo,
        `other_considerations[${index}].photoUris[${photoIndex}]`,
      ));
    });
  });
  return references;
}

export function buildPhotoCopyReferenceRows(input: {
  app: PhotoApp;
  targetParentId: string;
  entities: CopiedPhotoEntity[];
  photos: PhotoRow[];
  allowUnconfirmed?: boolean;
}): Array<typeof photoCopyReferences.$inferInsert> {
  const photosById = new Map(input.photos.map((photo) => [photo.id.toLowerCase(), photo]));
  const rows: Array<typeof photoCopyReferences.$inferInsert> = [];
  const seen = new Set<string>();

  for (const entity of input.entities) {
    const references = entity.photoReferences
      ?? [...collectImmutablePhotoIds(entity.photoValues)].map((photoId) => ({
        photoId,
        targetFieldName: photosById.get(photoId)?.fieldName ?? '',
      }));
    for (const reference of references) {
      const photo = photosById.get(reference.photoId);
      if (
        !photo
        || photo.app !== input.app
        || (!input.allowUnconfirmed && photo.status !== 'confirmed')
        || (input.allowUnconfirmed && photo.status === 'failed')
        || !photo.storageKey
      ) continue;

      const targetFieldName = reference.targetFieldName || photo.fieldName;
      const key = [photo.id, input.targetParentId, entity.targetEntityId, targetFieldName].join('\0');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id: randomUUID(),
        app: input.app,
        photoId: photo.id,
        targetParentId: input.targetParentId,
        targetEntityType: entity.targetEntityType,
        targetEntityId: entity.targetEntityId,
        targetFieldName,
      });
    }
  }

  return rows;
}

/**
 * Returns direct photos plus inherited references, remapped to this parent's
 * cloned entity ids. This makes copies-of-copies behave exactly like first
 * generation copies without duplicating registry rows or stored bytes.
 */
export async function loadPhotosForParent(input: {
  app: PhotoApp;
  parentId: string;
  executor?: DbExecutor;
  includeUnconfirmed?: boolean;
}): Promise<PhotoRow[]> {
  const executor = input.executor ?? db;
  const direct = await executor
    .select()
    .from(photoRegistry)
    .where(and(
      eq(photoRegistry.app, input.app),
      eq(photoRegistry.parentId, input.parentId),
      input.includeUnconfirmed ? undefined : eq(photoRegistry.status, 'confirmed'),
    ));

  const inherited = await executor
    .select({
      photo: photoRegistry,
      targetEntityType: photoCopyReferences.targetEntityType,
      targetEntityId: photoCopyReferences.targetEntityId,
      targetFieldName: photoCopyReferences.targetFieldName,
    })
    .from(photoCopyReferences)
    .innerJoin(photoRegistry, eq(photoRegistry.id, photoCopyReferences.photoId))
    .where(and(
      eq(photoCopyReferences.app, input.app),
      eq(photoCopyReferences.targetParentId, input.parentId),
      eq(photoRegistry.app, input.app),
      input.includeUnconfirmed ? undefined : eq(photoRegistry.status, 'confirmed'),
    ));

  const rows = [
    ...direct,
    ...inherited.map(({ photo, targetEntityType, targetEntityId, targetFieldName }) => ({
      ...photo,
      parentId: input.parentId,
      entityType: targetEntityType,
      entityId: targetEntityId,
      fieldName: targetFieldName,
    })),
  ];
  const unique = new Map<string, PhotoRow>();
  for (const row of rows) {
    unique.set([row.id, row.entityId, row.fieldName].join('\0'), row);
  }
  return [...unique.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function linkCopiedPhotoReferences(input: {
  app: PhotoApp;
  sourceParentId: string;
  targetParentId: string;
  entities: CopiedPhotoEntity[];
  executor?: DbExecutor;
}): Promise<number> {
  const executor = input.executor ?? db;
  if (input.entities.length === 0) return 0;
  const photos = await loadPhotosForParent({
    app: input.app,
    parentId: input.sourceParentId,
    executor,
    includeUnconfirmed: true,
  });
  const rows = buildPhotoCopyReferenceRows({
    app: input.app,
    targetParentId: input.targetParentId,
    entities: input.entities,
    photos,
    allowUnconfirmed: true,
  });
  if (rows.length === 0) return 0;
  await executor.insert(photoCopyReferences).values(rows).onConflictDoNothing();
  return rows.length;
}

function referenceIdentity(reference: {
  photoId: string;
  targetParentId: string;
  targetEntityId: string;
  targetFieldName: string;
}): string {
  return [
    reference.photoId,
    reference.targetParentId,
    reference.targetEntityId,
    reference.targetFieldName,
  ].join('\0');
}

export function planPhotoCopyReferenceReconciliation(
  existing: Array<typeof photoCopyReferences.$inferSelect>,
  desired: Array<typeof photoCopyReferences.$inferInsert>,
): {
  add: Array<typeof photoCopyReferences.$inferInsert>;
  remove: Array<typeof photoCopyReferences.$inferSelect>;
} {
  const existingKeys = new Set(existing.map(referenceIdentity));
  const desiredKeys = new Set(desired.map(referenceIdentity));
  return {
    add: desired.filter((reference) => !existingKeys.has(referenceIdentity(reference))),
    remove: existing.filter((reference) => !desiredKeys.has(referenceIdentity(reference))),
  };
}

type ParentAccessRecord = {
  id: string;
  createdByUserId: string | null;
  assignedInspectorUserId?: string | null;
};

/**
 * Generic reconciliation is only allowed to create a new grant while an
 * authenticated actor can currently open both parents. Existing explicit
 * grants are handled separately so background jobs may safely remap them.
 */
export function actorCanAccessPhotoParent(
  app: PhotoApp,
  actor: AuthUser,
  parent: ParentAccessRecord,
): boolean {
  if (actor.app !== app) return false;
  if (elevated(actor)) return true;
  if (parent.createdByUserId === actor.userId) return true;
  return app === 'ecoaudit' && parent.assignedInspectorUserId === actor.userId;
}

export function genericPhotoCandidateIsAuthorized(input: {
  app: PhotoApp;
  photoId: string;
  sourceParent?: ParentAccessRecord;
  targetParent: ParentAccessRecord;
  alreadyLinked: boolean;
  actor?: AuthUser;
}): boolean {
  if (input.alreadyLinked) return true;
  return Boolean(
    input.actor
    && input.sourceParent
    && actorCanAccessPhotoParent(input.app, input.actor, input.sourceParent)
    && actorCanAccessPhotoParent(input.app, input.actor, input.targetParent)
  );
}

async function lockTargetParent(
  executor: DbExecutor,
  app: PhotoApp,
  parentId: string,
): Promise<ParentAccessRecord | null> {
  if (app === 'ecoaudit') {
    const [parent] = await executor
      .select({
        id: eaAudits.id,
        createdByUserId: eaAudits.createdByUserId,
        assignedInspectorUserId: eaAudits.assignedInspectorUserId,
      })
      .from(eaAudits)
      .where(and(eq(eaAudits.id, parentId), isNull(eaAudits.deletedAt)))
      .for('update')
      .limit(1);
    return parent ?? null;
  }
  const [parent] = await executor
    .select({ id: ssSites.id, createdByUserId: ssSites.createdByUserId })
    .from(ssSites)
    .where(and(eq(ssSites.id, parentId), isNull(ssSites.deletedAt)))
    .for('update')
    .limit(1);
  return parent ?? null;
}

async function loadSourceParents(
  executor: DbExecutor,
  app: PhotoApp,
  parentIds: string[],
): Promise<Map<string, ParentAccessRecord>> {
  if (parentIds.length === 0) return new Map();
  if (app === 'ecoaudit') {
    const parents = await executor
      .select({
        id: eaAudits.id,
        createdByUserId: eaAudits.createdByUserId,
        assignedInspectorUserId: eaAudits.assignedInspectorUserId,
      })
      .from(eaAudits)
      .where(and(inArray(eaAudits.id, parentIds), isNull(eaAudits.deletedAt)));
    return new Map(parents.map((parent) => [parent.id, parent]));
  }
  const parents = await executor
    .select({ id: ssSites.id, createdByUserId: ssSites.createdByUserId })
    .from(ssSites)
    .where(and(inArray(ssSites.id, parentIds), isNull(ssSites.deletedAt)));
  return new Map(parents.map((parent) => [parent.id, parent]));
}

async function currentPhotoEntities(
  executor: DbExecutor,
  app: PhotoApp,
  parentId: string,
): Promise<CopiedPhotoEntity[]> {
  if (app === 'ecoaudit') {
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
      executor.select().from(eaZones).where(and(eq(eaZones.auditId, parentId), isNull(eaZones.deletedAt))),
      executor.select().from(eaMainSwitchboards).where(and(eq(eaMainSwitchboards.auditId, parentId), isNull(eaMainSwitchboards.deletedAt))),
      executor.select().from(eaAdditionalSwitchboards).where(and(eq(eaAdditionalSwitchboards.auditId, parentId), isNull(eaAdditionalSwitchboards.deletedAt))),
      executor.select().from(eaHvacUnits).where(and(eq(eaHvacUnits.auditId, parentId), isNull(eaHvacUnits.deletedAt))),
      executor.select().from(eaLightingSystems).where(and(eq(eaLightingSystems.auditId, parentId), isNull(eaLightingSystems.deletedAt))),
      executor.select().from(eaSolarPv).where(and(eq(eaSolarPv.auditId, parentId), isNull(eaSolarPv.deletedAt))),
      executor.select().from(eaForkliftChargers).where(and(eq(eaForkliftChargers.auditId, parentId), isNull(eaForkliftChargers.deletedAt))),
      executor.select().from(eaHotWaterSystems).where(and(eq(eaHotWaterSystems.auditId, parentId), isNull(eaHotWaterSystems.deletedAt))),
      executor.select().from(eaGeneralWater).where(and(eq(eaGeneralWater.auditId, parentId), isNull(eaGeneralWater.deletedAt))),
      executor.select().from(eaGeneralElectricity).where(and(eq(eaGeneralElectricity.auditId, parentId), isNull(eaGeneralElectricity.deletedAt))),
    ]);
    const groups: Array<{ entityType: string; records: Array<Record<string, unknown>> }> = [
      { entityType: 'zone', records: zones },
      { entityType: 'main_switchboard', records: mainSwitchboards },
      { entityType: 'additional_switchboard', records: additionalSwitchboards },
      { entityType: 'hvac_unit', records: hvacUnits },
      { entityType: 'lighting_system', records: lightingSystems },
      { entityType: 'solar_pv', records: solarPv },
      { entityType: 'forklift_charger', records: forkliftChargers },
      { entityType: 'hot_water_system', records: hotWaterSystems },
      { entityType: 'general_water', records: generalWater },
      { entityType: 'general_electricity', records: generalElectricity },
    ];
    return groups.flatMap(({ entityType, records }) => records.map((record) => ({
      sourceEntityId: String(record.id),
      targetEntityId: String(record.id),
      targetEntityType: entityType,
      photoValues: ecoPhotoValues(record),
      photoReferences: ecoPhotoFieldReferences(record),
    })));
  }

  const [[site], assessments] = await Promise.all([
    executor.select().from(ssSites).where(and(eq(ssSites.id, parentId), isNull(ssSites.deletedAt))).limit(1),
    executor.select().from(ssRooftopAssessments).where(and(
      eq(ssRooftopAssessments.siteId, parentId),
      isNull(ssRooftopAssessments.deletedAt),
    )),
  ]);
  return [
    ...(site ? [{
      sourceEntityId: site.id,
      targetEntityId: site.id,
      targetEntityType: 'site',
      photoValues: solarSitePhotoValues(site),
      photoReferences: solarSitePhotoFieldReferences(site),
    }] : []),
    ...assessments.map((assessment) => ({
      sourceEntityId: assessment.id,
      targetEntityId: assessment.id,
      targetEntityType: 'rooftop_assessment',
      photoValues: solarAssessmentPhotoValues(assessment),
      photoReferences: solarAssessmentPhotoFieldReferences(assessment),
    })),
  ];
}

async function reconcileWithExecutor(input: {
  app: PhotoApp;
  parentId: string;
  executor: DbExecutor;
  actor?: AuthUser;
}): Promise<{ linked: number; removed: number; releasedPhotoIds: string[] }> {
  // Serialize all plans for one target. Child writes may commit independently,
  // but the last waiter always re-reads the latest rows after acquiring this lock.
  const targetParent = await lockTargetParent(input.executor, input.app, input.parentId);
  if (!targetParent) return { linked: 0, removed: 0, releasedPhotoIds: [] };
  const entities = await currentPhotoEntities(input.executor, input.app, input.parentId);
  const photoIds = [...new Set(entities.flatMap((entity) =>
    (entity.photoReferences ?? []).map((reference) => reference.photoId),
  ))];
  const existing = await input.executor
    .select()
    .from(photoCopyReferences)
    .where(and(
      eq(photoCopyReferences.app, input.app),
      eq(photoCopyReferences.targetParentId, input.parentId),
    ));
  const existingPhotoIds = new Set(existing.map((reference) => reference.photoId));
  const photos = photoIds.length > 0
    ? await input.executor.select().from(photoRegistry).where(and(
        eq(photoRegistry.app, input.app),
        ne(photoRegistry.status, 'failed'),
        inArray(photoRegistry.id, photoIds),
      ))
    : [];
  const sourceParents = await loadSourceParents(
    input.executor,
    input.app,
    [...new Set(photos.map((photo) => photo.parentId).filter((id) => id !== input.parentId))],
  );
  const authorizedPhotos = photos.filter((photo) => {
    if (photo.parentId === input.parentId) return false;
    // Existing grants are trusted proof from an explicit copy or prior secure
    // reconciliation and may be remapped after array reorder/source purge.
    const sourceParent = sourceParents.get(photo.parentId);
    return genericPhotoCandidateIsAuthorized({
      app: input.app,
      photoId: photo.id,
      sourceParent,
      targetParent,
      alreadyLinked: existingPhotoIds.has(photo.id),
      actor: input.actor,
    });
  });
  const desired = buildPhotoCopyReferenceRows({
    app: input.app,
    targetParentId: input.parentId,
    entities,
    photos: authorizedPhotos,
    allowUnconfirmed: true,
  });
  const plan = planPhotoCopyReferenceReconciliation(existing, desired);
  if (plan.remove.length > 0) {
    await input.executor.delete(photoCopyReferences).where(inArray(
      photoCopyReferences.id,
      plan.remove.map((reference) => reference.id),
    ));
  }
  if (plan.add.length > 0) {
    await input.executor.insert(photoCopyReferences).values(plan.add).onConflictDoNothing();
  }
  return {
    linked: plan.add.length,
    removed: plan.remove.length,
    releasedPhotoIds: plan.remove.map((reference) => reference.photoId),
  };
}

/**
 * Rebuilds a parent's grants from its current exact photo-bearing fields. The
 * standalone form is atomic and idempotent; callers already inside a copy
 * transaction may pass that transaction as executor.
 */
export async function reconcilePhotoCopyReferencesForParent(input: {
  app: PhotoApp;
  parentId: string;
  executor?: DbExecutor;
  actor?: AuthUser;
}): Promise<{ linked: number; removed: number }> {
  if (input.executor) {
    const result = await reconcileWithExecutor({ ...input, executor: input.executor });
    return { linked: result.linked, removed: result.removed };
  }
  const result = await db.transaction((tx) => reconcileWithExecutor({
    app: input.app,
    parentId: input.parentId,
    executor: tx as unknown as DbExecutor,
    actor: input.actor,
  }));
  await cleanupOrphanedPhotos(result.releasedPhotoIds);
  return { linked: result.linked, removed: result.removed };
}

function elevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

/** Indexed parent-link check used by thumbnail/photo authorization. */
export async function hasAccessibleCopyReference(photoId: string, user: AuthUser): Promise<boolean> {
  if (user.app === 'ecoaudit') {
    const access = elevated(user)
      ? undefined
      : or(
          eq(eaAudits.createdByUserId, user.userId),
          eq(eaAudits.assignedInspectorUserId, user.userId),
        );
    const [row] = await db
      .select({ id: photoCopyReferences.id })
      .from(photoCopyReferences)
      .innerJoin(eaAudits, eq(eaAudits.id, photoCopyReferences.targetParentId))
      .where(and(
        eq(photoCopyReferences.app, 'ecoaudit'),
        eq(photoCopyReferences.photoId, photoId),
        isNull(eaAudits.deletedAt),
        access,
      ))
      .limit(1);
    return Boolean(row);
  }

  const [row] = await db
    .select({ id: photoCopyReferences.id })
    .from(photoCopyReferences)
    .innerJoin(ssSites, eq(ssSites.id, photoCopyReferences.targetParentId))
    .where(and(
      eq(photoCopyReferences.app, 'solarsense'),
      eq(photoCopyReferences.photoId, photoId),
      isNull(ssSites.deletedAt),
      elevated(user) ? undefined : eq(ssSites.createdByUserId, user.userId),
    ))
    .limit(1);
  return Boolean(row);
}

export async function photoHasCopyReferences(photoId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: photoCopyReferences.id })
    .from(photoCopyReferences)
    .where(eq(photoCopyReferences.photoId, photoId))
    .limit(1);
  return Boolean(row);
}

async function originalParentExists(photo: PhotoRow, executor: DbExecutor = db): Promise<boolean> {
  if (photo.app === 'ecoaudit') {
    const [row] = await executor.select({ id: eaAudits.id }).from(eaAudits).where(eq(eaAudits.id, photo.parentId)).limit(1);
    return Boolean(row);
  }
  const [row] = await executor.select({ id: ssSites.id }).from(ssSites).where(eq(ssSites.id, photo.parentId)).limit(1);
  return Boolean(row);
}

/**
 * Locks the registry row before checking references. FK inserts take a
 * conflicting key-share lock, so either the link commits first and is seen or
 * it waits and fails after this row is deleted; committed links can never point
 * at bytes that were removed by the deletion path.
 */
async function claimPhotoRegistryRowForDeletion(
  photoId: string,
  requireMissingOriginalParent: boolean,
): Promise<PhotoRow | null> {
  return db.transaction(async (tx) => {
    const executor = tx as unknown as DbExecutor;
    const [photo] = await tx
      .select()
      .from(photoRegistry)
      .where(eq(photoRegistry.id, photoId))
      .for('update')
      .limit(1);
    if (!photo) return null;
    const [reference] = await tx
      .select({ id: photoCopyReferences.id })
      .from(photoCopyReferences)
      .where(eq(photoCopyReferences.photoId, photo.id))
      .limit(1);
    if (reference) return null;
    if (requireMissingOriginalParent && await originalParentExists(photo, executor)) return null;
    const [deleted] = await tx
      .delete(photoRegistry)
      .where(eq(photoRegistry.id, photo.id))
      .returning();
    return deleted ?? null;
  });
}

async function deleteClaimedPhotoBytes(
  photoId: string,
  requireMissingOriginalParent: boolean,
): Promise<boolean> {
  const deleted = await claimPhotoRegistryRowForDeletion(photoId, requireMissingOriginalParent);
  if (!deleted) return false;
  // Bytes are removed only after the registry deletion transaction commits.
  await deleteLocalFile(deleted.storageKey);
  return true;
}

async function cleanupOrphanedPhotos(photoIds: string[]): Promise<void> {
  for (const photoId of new Set(photoIds)) {
    await deleteClaimedPhotoBytes(photoId, true);
  }
}

export async function releaseCopyReferencesForParent(app: PhotoApp, targetParentId: string): Promise<void> {
  const where = and(
    eq(photoCopyReferences.app, app),
    eq(photoCopyReferences.targetParentId, targetParentId),
  );
  const links = await db.select({ photoId: photoCopyReferences.photoId }).from(photoCopyReferences).where(where);
  if (links.length === 0) return;
  await db.delete(photoCopyReferences).where(where);
  await cleanupOrphanedPhotos(links.map((link) => link.photoId));
}

export async function releaseCopyReferencesForEntity(app: PhotoApp, targetEntityId: string): Promise<void> {
  const where = and(
    eq(photoCopyReferences.app, app),
    eq(photoCopyReferences.targetEntityId, targetEntityId),
  );
  const links = await db.select({ photoId: photoCopyReferences.photoId }).from(photoCopyReferences).where(where);
  if (links.length === 0) return;
  await db.delete(photoCopyReferences).where(where);
  await cleanupOrphanedPhotos(links.map((link) => link.photoId));
}

/** Deletes only owned registry/files that no active copy still references. */
export async function deleteOwnedPhotosUnlessReferenced(input: {
  app: PhotoApp;
  parentId?: string;
  entityId?: string;
}): Promise<{ deleted: number; retained: number }> {
  if (!input.parentId && !input.entityId) throw new Error('A parentId or entityId is required');
  const conditions = [eq(photoRegistry.app, input.app)];
  if (input.parentId) conditions.push(eq(photoRegistry.parentId, input.parentId));
  if (input.entityId) conditions.push(eq(photoRegistry.entityId, input.entityId));
  const photos = await db.select().from(photoRegistry).where(and(...conditions));
  let deleted = 0;
  let retained = 0;
  for (const photo of photos) {
    if (await deleteClaimedPhotoBytes(photo.id, false)) deleted += 1;
    else retained += 1;
  }
  return { deleted, retained };
}

export async function deletePhotoUnlessReferenced(photo: PhotoRow): Promise<boolean> {
  return deleteClaimedPhotoBytes(photo.id, false);
}
