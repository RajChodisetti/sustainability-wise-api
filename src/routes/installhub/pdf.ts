import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import {
  ihFormSubmissions,
  ihInstallations,
} from '../../db/schema/installhub.js';
import { pdfJobs, photoRegistry } from '../../db/schema/shared.js';
import { mergePdfBuffers } from '../../pdf/merge.js';
import { prepareCompressedPdfPhotos } from '../../pdf/photoCompression.js';
import { renderPdf } from '../../pdf/renderer.js';
import {
  completeJob,
  failJob,
  findActiveExportJob,
  markJobRunning,
  updateJobPhase,
  updateJobProgress,
  type ExportJobParams,
} from '../../services/pdfJobService.js';
import { enqueueExportTask } from '../../services/exportJobQueue.js';
import {
  makePdfStorageKeyFromName,
} from '../../services/storageNaming.js';
import {
  publicFileUrl,
  sanitizeStorageSegment,
  writeLocalFile,
} from '../../storage/localFiles.js';
import {
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import { mirrorPdfToOneDrive } from '../../onedrive/photoBackup.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { assertInstallationAccess } from './helpers.js';
import {
  buildInstallHubReportHtml,
  installHubReportNeedsChunks,
  installHubReportPhotoTotals,
  planInstallHubFormReportSlices,
  planInstallHubPackChunks,
  photosForInstallHubFormSlice,
  resolveInstallHubFormPhotos,
  safeInstallHubReportFailure,
  visibleInstallHubReportSectionIndexes,
  type InstallHubFormReportSlice,
  type InstallHubReportAttachment,
  type InstallHubReportForm,
  type InstallHubReportInstallation,
  type InstallHubReportPhoto,
  type InstallHubReportDetailMode,
  type InstallHubCanonicalReport,
  type ResolvedInstallHubFormPhoto,
} from './reportHtml.js';
import { renderElectricalMapImages } from './electricalMapImage.js';
import {
  INSTALLHUB_REPORT_DEFINITION_BY_TYPE,
  INSTALLHUB_REPORT_MANIFEST_VERSION,
  type InstallHubReportFormType,
} from './reportManifest.js';
import {
  canonicalEvidenceReferences,
  canonicalCompletionReadiness,
  loadCanonicalInstallationTree,
  loadCanonicalRecordVersion,
  type CanonicalRecordVersionSnapshot,
} from './treeService.js';
import {
  installationReadiness,
  type CanonicalFormSubmission,
  type CanonicalInstallationTree,
} from './canonical.js';
import {
  buildAllAssetsView,
  buildElectricalTreeView,
  buildMeteringView,
} from './canonicalViews.js';

const MAX_PDF_BYTES = 300 * 1024 * 1024;
const brandLogoUrl = new URL('../../pdf/brand-logo.png', import.meta.url);
let brandLogoDataUriPromise: Promise<string> | null = null;

type InstallationRow = typeof ihInstallations.$inferSelect;
type FormRow = typeof ihFormSubmissions.$inferSelect;
type PhotoRow = typeof photoRegistry.$inferSelect;
type ReportMode = 'form' | 'installation-pack';

export const INSTALLHUB_REPORT_RENDERER_VERSION = 3;
export const DEFAULT_INSTALLHUB_REPORT_DETAIL_MODE: InstallHubReportDetailMode =
  'by-electrical-hierarchy';

export function requestedReportDetailMode(value: unknown): InstallHubReportDetailMode {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_INSTALLHUB_REPORT_DETAIL_MODE;
  }
  if (value === 'by-zone' || value === 'by-electrical-hierarchy') return value;
  throw badRequest('detailMode must be by-zone or by-electrical-hierarchy');
}

export function installHubReportVariantKey(input: {
  detailMode: InstallHubReportDetailMode;
  formIds: string[];
  sourceKey: string;
}): string {
  const formIds = [...new Set(input.formIds.filter(Boolean))].sort();
  const formSelectionDigest = createHash('sha256')
    .update(JSON.stringify(formIds))
    .digest('hex')
    .slice(0, 24);
  return `installation-pack:v${INSTALLHUB_REPORT_RENDERER_VERSION}:${input.detailMode}:map:${input.sourceKey}:forms-${formSelectionDigest}`;
}

export function pinnedPhotoMatchesManifest(
  photo: Pick<PhotoRow, 'id' | 'checksum'>,
  manifest: Pick<CanonicalRecordVersionSnapshot['mediaManifest'][number], 'id' | 'checksum'>,
): boolean {
  return photo.id.toLowerCase() === manifest.id.toLowerCase()
    && photo.checksum === manifest.checksum;
}

export function requestedRecordVersion(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw badRequest('recordVersionNumber must be a positive integer');
  }
  return result;
}

export function requestedLiveMode(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === 'true') return true;
  throw badRequest('liveMode must be true when requesting a non-authoritative live report');
}

export function assertPinnedOrExplicitLive(input: {
  recordVersionNumber?: number;
  liveMode: boolean;
}): void {
  if (input.recordVersionNumber !== undefined && input.liveMode) {
    throw badRequest('Choose recordVersionNumber or liveMode, not both');
  }
  if (input.recordVersionNumber === undefined && !input.liveMode) {
    throw badRequest('recordVersionNumber is required unless liveMode=true is explicitly requested');
  }
}

export function assertAuthoritativeCanonicalSnapshot(
  snapshot: Pick<CanonicalRecordVersionSnapshot, 'readiness'>,
): void {
  if (snapshot.readiness.eligibility.authoritativeReport !== true) {
    throw badRequest(
      'The selected record version is not eligible for an authoritative report. Resolve its pinned readiness issues or request liveMode=true for a diagnostic report.',
    );
  }
}

export function assertPinnedSnapshotProvenance(input: {
  snapshot: Pick<CanonicalRecordVersionSnapshot, 'payloadHash' | 'readiness'>;
  expectedPayloadHash: string;
}): void {
  if (!input.expectedPayloadHash || input.snapshot.payloadHash !== input.expectedPayloadHash) {
    throw new Error('canonical_report_snapshot_provenance_mismatch');
  }
  assertAuthoritativeCanonicalSnapshot(input.snapshot);
}

function canonicalReportProjection(input: {
  tree: CanonicalInstallationTree;
  readiness: CanonicalRecordVersionSnapshot['readiness'];
  electricalTree: CanonicalRecordVersionSnapshot['viewArtifacts']['electricalTree'];
  allAssets: CanonicalRecordVersionSnapshot['viewArtifacts']['allAssets'];
  metering: CanonicalRecordVersionSnapshot['viewArtifacts']['metering'];
  reportSource: 'canonical-version' | 'diagnostic-live';
  recordVersionNumber: number | null;
  snapshotPayloadHash: string | null;
  mappingContentHash: string | null;
}): InstallHubCanonicalReport {
  return {
    reportSource: input.reportSource,
    treeRevision: input.tree.installation.treeRevision,
    recordVersionNumber: input.recordVersionNumber,
    snapshotPayloadHash: input.snapshotPayloadHash,
    mappingContentHash: input.mappingContentHash,
    authoritative: input.reportSource === 'canonical-version'
      && input.readiness.eligibility.authoritativeReport,
    readyToComplete: input.readiness.readyToComplete,
    physicalLocations: input.tree.zones.map((zone) => ({
      id: zone.id,
      name: zone.zoneName,
      ...(zone.zoneDescription ? { description: zone.zoneDescription } : {}),
    })),
    electricalNodes: input.electricalTree.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      name: node.name,
      ...('displayCode' in node ? { displayCode: node.displayCode } : {}),
      ...('typeLabel' in node ? { typeLabel: node.typeLabel } : {}),
      ...('physicalLocationId' in node
        ? { physicalLocationId: node.physicalLocationId }
        : {}),
      ...('coverageState' in node && node.coverageState
        ? { coverageState: node.coverageState }
        : {}),
      ...('parentNodeId' in node ? { parentNodeId: node.parentNodeId } : {}),
    })),
    supplyEdges: input.electricalTree.edges
      .filter((edge) => edge.relationship === 'FED_FROM')
      .map((edge) => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relationship: edge.relationship,
      })),
    measurementEdges: input.electricalTree.edges
      .filter((edge) => edge.relationship === 'MEASURES')
      .map((edge) => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relationship: edge.relationship,
      })),
    meters: input.tree.meterDevices.map((meter) => ({
      id: meter.id,
      installedOnBoardId: meter.installedOnBoardId,
      name: meter.displayName.value || meter.customName || meter.deviceModel,
      model: meter.deviceModel === 'OTHER'
        ? meter.customModelName || 'Other'
        : meter.deviceModel,
      ...(meter.deviceNumber ? { deviceNumber: meter.deviceNumber } : {}),
      ...(meter.serialNumber ? { serialNumber: meter.serialNumber } : {}),
      channels: meter.channels.map((channel) => ({
        ordinal: channel.ordinal,
        purpose: channel.purpose,
        load: channel.customLoadTypeName || channel.loadTypeCode || '',
        ...(channel.description ? { description: channel.description } : {}),
      })),
    })),
    unresolvedRelationships: input.electricalTree.unresolved.map((item) => ({
      id: item.id,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      relation: item.relation,
      missingEnd: item.missingEnd,
      ...(item.knownNodeId ? { knownNodeId: item.knownNodeId } : {}),
      reason: item.reason,
    })),
    assets: input.allAssets.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      displayCode: asset.displayCode,
      typeLabel: asset.typeLabel,
      zoneId: asset.zoneId,
      zoneName: asset.zoneName,
      coverage: asset.coverage,
    })),
    meteringRows: input.metering.rows.map((row) => ({
      assignmentId: row.assignmentId,
      meterDisplayName: row.meterDisplayName,
      channelOrdinal: row.channelOrdinal,
      target: row.target,
      direction: row.direction,
    })),
    virtualMeterDefinitions: input.tree.serverDerived.virtualMeterDefinitions.map((definition) => ({
      id: definition.id,
      parentNodeId: definition.parentNodeId,
      totalMeasurementAssignmentId: definition.totalMeasurementAssignmentId,
      subtractAssignmentIds: [...definition.subtractAssignmentIds],
      formula: definition.subtractAssignmentIds.length
        ? `TOTAL(${definition.totalMeasurementAssignmentId}) - SUM(${definition.subtractAssignmentIds.join(', ')})`
        : `TOTAL(${definition.totalMeasurementAssignmentId})`,
      formulaVersion: definition.formulaVersion,
      allocation: definition.allocation,
      coverage: input.allAssets.assets.flatMap((asset) => (
        asset.coverage.kind === 'VIRTUAL'
        && asset.coverage.virtualMeterId === definition.id
          ? [{
              assetId: asset.id,
              displayCode: asset.displayCode,
              assetName: asset.name,
              zoneName: asset.zoneName,
            }]
          : []
      )),
    })),
    readinessIssues: input.readiness.issues.map((issue) => ({
      code: issue.code,
      entityType: issue.entityType,
      entityId: issue.entityId,
      message: issue.message,
    })),
  };
}

export function pinnedCanonicalReport(
  snapshot: CanonicalRecordVersionSnapshot,
): InstallHubCanonicalReport {
  return canonicalReportProjection({
    tree: snapshot.installationTree,
    readiness: snapshot.readiness,
    electricalTree: snapshot.viewArtifacts.electricalTree,
    allAssets: snapshot.viewArtifacts.allAssets,
    metering: snapshot.viewArtifacts.metering,
    reportSource: 'canonical-version',
    recordVersionNumber: snapshot.installationTree.installation.recordVersionNumber,
    snapshotPayloadHash: snapshot.payloadHash,
    mappingContentHash: snapshot.viewArtifacts.mapping.contentHash,
  });
}

export function liveDiagnosticCanonicalReport(
  tree: CanonicalInstallationTree,
  currentReadiness: CanonicalRecordVersionSnapshot['readiness'] = installationReadiness(tree),
): InstallHubCanonicalReport {
  const currentVersion = tree.installation.recordVersionNumber;
  return canonicalReportProjection({
    tree,
    readiness: currentReadiness,
    electricalTree: buildElectricalTreeView(tree, currentVersion),
    allAssets: buildAllAssetsView(tree, currentVersion),
    metering: buildMeteringView(tree, currentVersion),
    reportSource: 'diagnostic-live',
    recordVersionNumber: null,
    snapshotPayloadHash: null,
    mappingContentHash: null,
  });
}

function generatedLabel(createdAt?: string): string {
  const date = createdAt ? new Date(createdAt) : new Date();
  return `Generated ${date.toLocaleDateString('en-AU', { timeZone: 'UTC' })}`;
}

function loadBrandLogo(): Promise<string> {
  brandLogoDataUriPromise ??= readFile(brandLogoUrl)
    .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
    .catch((error) => {
      brandLogoDataUriPromise = null;
      throw error;
    });
  return brandLogoDataUriPromise;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function reportAttachments(value: unknown): InstallHubReportAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const attachment = item as Record<string, unknown>;
    const id = optionalText(attachment.id);
    const slot = optionalText(attachment.slot);
    const uri = optionalText(attachment.uri);
    const mimeType = optionalText(
      attachment.mimeType ?? attachment.mime_type,
    );
    const caption = optionalText(attachment.caption);
    const capturedAt = optionalText(
      attachment.capturedAt ?? attachment.captured_at,
    );
    if (!slot || !uri) return [];
    return [{
      ...(id ? { id } : {}),
      slot,
      uri,
      ...(mimeType ? { mimeType } : {}),
      ...(caption ? { caption } : {}),
      ...(capturedAt ? { capturedAt } : {}),
    }];
  });
}

function reportForm(row: FormRow): InstallHubReportForm {
  if (!(row.formType in INSTALLHUB_REPORT_DEFINITION_BY_TYPE)) {
    throw new Error(`Unsupported Field App Complete report type: ${row.formType}`);
  }
  return {
    id: row.id,
    installationId: row.installationId,
    formType: row.formType as InstallHubReportFormType,
    schemaVersion: row.schemaVersion,
    status: row.status,
    answers: row.answers,
    attachments: reportAttachments(row.attachments),
    completedAt: row.completedAt,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function canonicalReportForm(row: CanonicalFormSubmission): InstallHubReportForm {
  if (!(row.formType in INSTALLHUB_REPORT_DEFINITION_BY_TYPE)) {
    throw new Error(`Unsupported Field App Complete report type: ${row.formType}`);
  }
  return {
    id: row.id,
    installationId: row.installationId,
    formType: row.formType as InstallHubReportFormType,
    schemaVersion: row.schemaVersion,
    status: row.status,
    answers: row.answers,
    attachments: reportAttachments(row.attachments),
    completedAt: row.completedAt,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function reportInstallation(row: InstallHubReportInstallation): InstallHubReportInstallation {
  return {
    id: row.id,
    clientName: row.clientName,
    siteName: row.siteName,
    siteAddress: row.siteAddress,
    inspectorName: row.inspectorName,
    auditDate: row.auditDate,
    status: row.status,
  };
}

function reportPhoto(row: PhotoRow): InstallHubReportPhoto {
  return {
    id: row.id,
    entityId: row.entityId,
    fieldName: row.fieldName,
    storageKey: row.storageKey,
    remoteUrl: row.remoteUrl,
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt,
  };
}

async function loadInstallation(installationId: string): Promise<InstallationRow> {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(
      eq(ihInstallations.id, installationId),
      isNull(ihInstallations.deletedAt),
    ))
    .limit(1);
  if (!installation) throw notFound('Installation');
  return installation;
}

async function loadCompletedForms(
  installationId: string,
  formIds?: string[],
): Promise<FormRow[]> {
  const conditions = [
    eq(ihFormSubmissions.installationId, installationId),
    isNull(ihFormSubmissions.deletedAt),
  ];
  if (formIds) {
    if (formIds.length === 0) return [];
    conditions.push(inArray(ihFormSubmissions.id, formIds));
  } else {
    conditions.push(eq(ihFormSubmissions.status, 'Completed'));
  }
  const forms = await db
    .select()
    .from(ihFormSubmissions)
    .where(and(...conditions))
    .orderBy(asc(ihFormSubmissions.createdAt));

  if (formIds && forms.length !== formIds.length) {
    throw badRequest('One or more selected form submissions were not found');
  }
  const incomplete = forms.find((form) => form.status !== 'Completed');
  if (incomplete) {
    throw badRequest(`Form ${incomplete.id} must be Completed before PDF generation`);
  }
  return forms;
}

function uniquePhotoRows(rows: PhotoRow[]): PhotoRow[] {
  const byId = new Map<string, PhotoRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

function selectedResolvedPhotos(
  formsById: Map<string, InstallHubReportForm>,
  resolvedByForm: Map<string, ResolvedInstallHubFormPhoto[]>,
  slices: InstallHubFormReportSlice[],
): Map<string, ResolvedInstallHubFormPhoto[]> {
  const selected = new Map<string, ResolvedInstallHubFormPhoto[]>();
  for (const slice of slices) {
    const form = formsById.get(slice.formId);
    if (!form) continue;
    const photos = photosForInstallHubFormSlice(
      form,
      resolvedByForm.get(form.id) ?? [],
      slice.sectionIndexes,
    );
    const existing = selected.get(form.id) ?? [];
    const seen = new Set(existing.map((item) => item.attachmentIndex));
    for (const photo of photos) {
      if (!seen.has(photo.attachmentIndex)) existing.push(photo);
    }
    selected.set(form.id, existing);
  }
  return selected;
}

async function compressResolvedPhotos(
  selected: Map<string, ResolvedInstallHubFormPhoto[]>,
  scopedPhotoRows: PhotoRow[],
): Promise<Map<string, ResolvedInstallHubFormPhoto[]>> {
  const photoIds = new Set(
    [...selected.values()].flatMap((photos) =>
      photos.map((photo) => photo.photo.id),
    ),
  );
  const raw = uniquePhotoRows(
    scopedPhotoRows.filter((photo) => photoIds.has(photo.id)),
  );
  const compressed = await prepareCompressedPdfPhotos(raw);
  const compressedById = new Map(compressed.map((photo) => [photo.id, photo]));
  const result = new Map<string, ResolvedInstallHubFormPhoto[]>();

  for (const [formId, photos] of selected) {
    result.set(formId, photos.map((resolved) => {
      const replacement = compressedById.get(resolved.photo.id);
      if (!replacement?.remoteUrl?.startsWith('data:image/')) {
        throw new Error(
          `Original evidence ${resolved.photo.id} could not be prepared for PDF rendering`,
        );
      }
      return {
        ...resolved,
        photo: reportPhoto(replacement),
      };
    }));
  }
  return result;
}

function allFormSlices(
  forms: InstallHubReportForm[],
  resolvedByForm: Map<string, ResolvedInstallHubFormPhoto[]>,
): InstallHubFormReportSlice[] {
  return forms.map((form) => ({
    formId: form.id,
    sectionIndexes: visibleInstallHubReportSectionIndexes(form),
    continuation: false,
    photoCount: resolvedByForm.get(form.id)?.length ?? 0,
  }));
}

async function renderInstallHubReport(args: {
  installation: InstallationRow;
  formRows: FormRow[];
  pinnedSnapshot?: CanonicalRecordVersionSnapshot;
  liveDiagnosticTree?: CanonicalInstallationTree;
  liveDiagnosticReadiness?: CanonicalRecordVersionSnapshot['readiness'];
  pinnedFormIds?: string[];
  pinnedCreatedAt?: string;
  mode: ReportMode;
  detailMode: InstallHubReportDetailMode;
  onPhase?: (phase: string) => void | Promise<void>;
  onProgress?: (current: number, total: number) => void | Promise<void>;
}): Promise<Buffer> {
  const installation = args.pinnedSnapshot
    ? reportInstallation(args.pinnedSnapshot.installationTree.installation)
    : args.liveDiagnosticTree
      ? reportInstallation(args.liveDiagnosticTree.installation)
      : reportInstallation(args.installation);
  const forms = args.pinnedSnapshot
    ? args.pinnedSnapshot.installationTree.formSubmissions
        .filter((form) => !args.pinnedFormIds || args.pinnedFormIds.includes(form.id))
        .map(canonicalReportForm)
    : args.liveDiagnosticTree && args.mode === 'installation-pack'
      ? args.liveDiagnosticTree.formSubmissions
          .filter((form) => !args.pinnedFormIds || args.pinnedFormIds.includes(form.id))
          .map(canonicalReportForm)
      : args.formRows.map(reportForm);
  const formsById = new Map(forms.map((form) => [form.id, form]));
  const formIds = new Set(forms.map((form) => form.id));
  const pinnedMediaById = args.pinnedSnapshot
    ? new Map(args.pinnedSnapshot.mediaManifest.map((item) => [item.id.toLowerCase(), item]))
    : null;
  let scopedPhotoRows = (await loadPhotosForParent({
    app: 'installhub',
    parentId: installation.id,
  })).filter((photo) => (
    formIds.has(photo.entityId)
    && (!pinnedMediaById || (() => {
      const manifest = pinnedMediaById.get(photo.id.toLowerCase());
      return Boolean(manifest && pinnedPhotoMatchesManifest(photo, manifest));
    })())
  ));
  if (args.pinnedSnapshot) {
    const fieldByPhotoEntity = new Map<string, string>();
    for (const reference of canonicalEvidenceReferences(args.pinnedSnapshot.installationTree)) {
      const photoId = reference.uri.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      )?.[0]?.toLowerCase();
      if (photoId) fieldByPhotoEntity.set(`${photoId}\0${reference.entityId}`, reference.fieldName);
    }
    scopedPhotoRows = scopedPhotoRows.map((photo) => ({
      ...photo,
      fieldName: fieldByPhotoEntity.get(`${photo.id.toLowerCase()}\0${photo.entityId}`)
        ?? photo.fieldName,
    }));
  }
  const reportPhotoRows = scopedPhotoRows.map(reportPhoto);
  const resolvedByForm = new Map(
    forms.map((form) => [
      form.id,
      resolveInstallHubFormPhotos(form, reportPhotoRows, {
        allowMissingEvidence: Boolean(args.liveDiagnosticTree),
      }),
    ]),
  );
  const totals = installHubReportPhotoTotals(
    [...resolvedByForm.values()].flat(),
  );
  const chunked = installHubReportNeedsChunks(totals);
  const chunks: InstallHubFormReportSlice[][] =
    chunked
      ? args.mode === 'form' && forms[0]
        ? planInstallHubFormReportSlices(
            forms[0],
            resolvedByForm.get(forms[0].id) ?? [],
          ).map((slice) => [slice])
        : planInstallHubPackChunks(forms, resolvedByForm)
      : [allFormSlices(forms, resolvedByForm)];

  await args.onPhase?.(
    chunked
      ? `Rendering large PDF in ${chunks.length} part${chunks.length === 1 ? '' : 's'}`
      : `Rendering PDF (${totals.count} photo${totals.count === 1 ? '' : 's'})`,
  );

  const logoDataUri = await loadBrandLogo();
  const reportGeneratedLabel = generatedLabel(args.pinnedCreatedAt);
  const canonicalReport = args.pinnedSnapshot
    ? pinnedCanonicalReport(args.pinnedSnapshot)
    : args.liveDiagnosticTree
      ? liveDiagnosticCanonicalReport(
          args.liveDiagnosticTree,
          args.liveDiagnosticReadiness,
        )
      : undefined;
  const electricalMapImages = args.mode === 'installation-pack' && canonicalReport
    ? await renderElectricalMapImages(canonicalReport, installation.siteName)
    : undefined;
  const parts: Buffer[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const slices = chunks[index];
    const selected = selectedResolvedPhotos(
      formsById,
      resolvedByForm,
      slices,
    );
    const compressed = await compressResolvedPhotos(selected, scopedPhotoRows);
    const html = buildInstallHubReportHtml({
      mode: args.mode,
      detailMode: args.detailMode,
      installation,
      forms,
      slices,
      resolvedByForm: compressed,
      logoDataUri,
      includeIntro: index === 0,
      includeEnd: index === chunks.length - 1,
      generatedLabel: reportGeneratedLabel,
      summaryPhotoCount: totals.count,
      ...(canonicalReport ? { canonicalReport } : {}),
      ...(index === 0 && electricalMapImages ? { electricalMapImages } : {}),
    });
    parts.push(await renderPdf(html));
    await args.onProgress?.(index + 1, chunks.length);
  }
  return mergePdfBuffers(parts);
}

function reportFilename(
  installation: Pick<InstallationRow, 'siteName'>,
  form?: Pick<FormRow, 'formType'> | Pick<CanonicalFormSubmission, 'formType'>,
): string {
  const base = form
    ? INSTALLHUB_REPORT_DEFINITION_BY_TYPE[
        form.formType as InstallHubReportFormType
      ]?.shortTitle ?? 'form'
    : 'installation-pack';
  return `${sanitizeStorageSegment(installation.siteName)}-${sanitizeStorageSegment(base)}.pdf`;
}

async function saveInstallHubReport(args: {
  installation: InstallationRow;
  formRows: FormRow[];
  pinnedSnapshot?: CanonicalRecordVersionSnapshot;
  liveDiagnosticTree?: CanonicalInstallationTree;
  liveDiagnosticReadiness?: CanonicalRecordVersionSnapshot['readiness'];
  pinnedFormIds?: string[];
  pinnedCreatedAt?: string;
  mode: ReportMode;
  detailMode: InstallHubReportDetailMode;
  onPhase?: (phase: string) => void | Promise<void>;
  onProgress?: (current: number, total: number) => void | Promise<void>;
}): Promise<{ storageKey: string; remoteUrl: string }> {
  const pdf = await renderInstallHubReport(args);
  if (pdf.byteLength > MAX_PDF_BYTES) {
    console.warn('[pdf] Field App Complete PDF exceeded preferred size limit', {
      installationId: args.installation.id,
      actualSizeBytes: pdf.byteLength,
      preferredMaxSizeBytes: MAX_PDF_BYTES,
    });
  }
  await args.onPhase?.('Saving PDF');
  const pinnedForms = args.pinnedSnapshot?.installationTree.formSubmissions.filter((form) => (
    !args.pinnedFormIds || args.pinnedFormIds.includes(form.id)
  ));
  const reportForm = args.mode === 'form'
    ? args.formRows[0] ?? pinnedForms?.[0]
    : undefined;
  const reportInstallation = args.pinnedSnapshot?.installationTree.installation
    ?? args.installation;
  const filename = reportFilename(
    reportInstallation,
    reportForm,
  );
  const storageKey = makePdfStorageKeyFromName({
    app: 'installhub',
    parentName: reportInstallation.siteName,
    fieldName:
      args.mode === 'form'
        ? `form-${reportForm?.id ?? 'report'}-pdf`
        : 'installation-pack-pdf',
    sessionId: randomUUID(),
    filename,
  });
  await writeLocalFile(storageKey, pdf);
  await mirrorPdfToOneDrive({
    filename,
    storageKey,
    body: pdf,
  });
  return { storageKey, remoteUrl: publicFileUrl(storageKey) };
}

async function runInstallHubPdfJob(args: {
  jobId: string;
  installationId: string;
  formIds: string[];
  mode: ReportMode;
  detailMode: InstallHubReportDetailMode;
  recordVersionNumber?: number;
  recordVersionPayloadHash?: string;
  reportSource: 'canonical-version' | 'diagnostic-live';
  liveTreeRevision?: number;
}): Promise<void> {
  try {
    await markJobRunning(args.jobId, 'Starting');
    const installation = await loadInstallation(args.installationId);
    const pinned = args.reportSource === 'diagnostic-live'
      ? null
      : await loadCanonicalRecordVersion({
          installationId: installation.id,
          versionNumber: args.recordVersionNumber!,
        });
    if (args.reportSource === 'canonical-version' && !pinned) {
      throw new Error(`Canonical record version ${args.recordVersionNumber} was not found`);
    }
    if (pinned) {
      assertPinnedSnapshotProvenance({
        snapshot: pinned.snapshot,
        expectedPayloadHash: args.recordVersionPayloadHash ?? '',
      });
    }
    const liveDiagnosticTree = args.reportSource === 'diagnostic-live'
      ? await loadCanonicalInstallationTree(installation.id)
      : undefined;
    if (
      liveDiagnosticTree
      && args.liveTreeRevision !== undefined
      && liveDiagnosticTree.installation.treeRevision !== args.liveTreeRevision
    ) {
      throw new Error('diagnostic_report_source_changed');
    }
    const liveDiagnosticReadiness = liveDiagnosticTree
      ? await canonicalCompletionReadiness({ tree: liveDiagnosticTree, executor: db })
      : undefined;
    // Legacy jobs retain current reconciliation behavior. Pinned jobs consume
    // only the immutable version manifest and never remap live references.
    if (!pinned) {
      await reconcilePhotoCopyReferencesForParent({
        app: 'installhub',
        parentId: installation.id,
      });
    }
    const forms = pinned || (liveDiagnosticTree && args.mode === 'installation-pack')
      ? []
      : await loadCompletedForms(
          installation.id,
          args.mode === 'form' ? args.formIds : (args.formIds.length ? args.formIds : undefined),
        );
    const result = await saveInstallHubReport({
      installation,
      formRows: forms,
      ...(pinned ? {
        pinnedSnapshot: pinned.snapshot,
        pinnedCreatedAt: pinned.createdAt,
      } : {}),
      pinnedFormIds: args.formIds,
      ...(liveDiagnosticTree ? { liveDiagnosticTree } : {}),
      ...(liveDiagnosticReadiness ? { liveDiagnosticReadiness } : {}),
      mode: args.mode,
      detailMode: args.detailMode,
      onPhase: (phase) => updateJobPhase(args.jobId, phase),
      onProgress: (current, total) =>
        updateJobProgress(
          args.jobId,
          `Rendering PDF part ${current} of ${total}`,
          current,
          total,
        ),
    });
    await completeJob(args.jobId, result.remoteUrl, result.storageKey);
  } catch (error) {
    const failure = safeInstallHubReportFailure(error);
    await failJob(args.jobId, failure.publicMessage);
    console.error('[pdf-job] Field App Complete job failed', {
      jobId: args.jobId,
      installationId: args.installationId,
      errorCode: failure.code,
      recordVersionNumber: args.recordVersionNumber ?? null,
    });
  }
}

function sourceUpdatedAt(
  installation: InstallationRow,
  forms: FormRow[],
): string {
  const [latest] = [
    installation.updatedAt,
    ...forms.map((form) => form.updatedAt),
  ].sort((left, right) => right.getTime() - left.getTime());
  return (latest ?? installation.updatedAt).toISOString();
}

async function queueInstallHubPdfJob(args: {
  request: FastifyRequest;
  installation: InstallationRow;
  forms: Array<FormRow | CanonicalFormSubmission>;
  mode: ReportMode;
  detailMode: InstallHubReportDetailMode;
  recordVersionNumber?: number;
  recordVersionPayloadHash?: string;
  recordVersionSnapshot?: CanonicalRecordVersionSnapshot;
  liveMode: boolean;
}) {
  if (!args.liveMode && (
    args.recordVersionNumber === undefined
    || !args.recordVersionPayloadHash
    || !args.recordVersionSnapshot
  )) {
    throw badRequest('Canonical reports require an exact record version and payload hash');
  }
  const entityId =
    args.mode === 'form'
      ? args.forms[0]?.id
      : args.installation.id;
  if (!entityId) throw badRequest('A form is required for form PDF generation');
  const formIds = args.forms.map((form) => form.id);
  const liveTreeRevision = args.liveMode ? args.installation.treeRevision : undefined;
  const reportVariantKey = args.mode === 'installation-pack'
    ? installHubReportVariantKey({
        detailMode: args.detailMode,
        formIds,
        sourceKey: liveTreeRevision === undefined
          ? 'canonical'
          : `tree-revision-${liveTreeRevision}`,
      })
    : null;
  const params: ExportJobParams = {
    artifactType: 'pdf',
    filename: reportFilename(
      args.recordVersionSnapshot?.installationTree.installation ?? args.installation,
      args.mode === 'form' ? args.forms[0] : undefined,
    ),
    contentType: 'application/pdf',
    reportMode: args.mode,
    detailMode: args.detailMode,
    includeElectricalMap: args.mode === 'installation-pack',
    reportSource: args.liveMode
      ? 'diagnostic-live'
      : 'canonical-version',
    rendererVersion: INSTALLHUB_REPORT_RENDERER_VERSION,
    formIds,
    ...(reportVariantKey ? { reportVariantKey } : {}),
    sourceUpdatedAt: args.recordVersionPayloadHash
      ?? sourceUpdatedAt(args.installation, args.forms as FormRow[]),
    ...(liveTreeRevision === undefined ? {} : { liveTreeRevision }),
    ...(args.recordVersionNumber === undefined
      ? {}
      : {
          recordVersionNumber: args.recordVersionNumber,
          recordVersionPayloadHash: args.recordVersionPayloadHash,
        }),
  };
  const jobId = randomUUID();
  const queued = await db.transaction(async (tx) => {
    // The same installation row lock is used by completion and purge. A job
    // either commits before purge (and blocks it as active) or observes the
    // tombstoned/deleted installation and cannot become orphaned.
    const [locked] = await tx
      .select({ id: ihInstallations.id })
      .from(ihInstallations)
      .where(and(
        eq(ihInstallations.id, args.installation.id),
        isNull(ihInstallations.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!locked) throw notFound('Installation');
    const active = await findActiveExportJob({
      app: 'installhub',
      entityId,
      userId: args.request.user.userId,
      params,
      executor: tx,
    });
    if (active) return {
      jobId: active.id,
      reused: true as const,
      recordVersionNumber: args.recordVersionNumber ?? null,
      recordVersionPayloadHash: args.recordVersionPayloadHash ?? null,
      reportSource: args.liveMode ? 'diagnostic-live' as const : 'canonical-version' as const,
      detailMode: args.detailMode,
      reportVariantKey,
    };
    await tx.insert(pdfJobs).values({
      id: jobId,
      app: 'installhub',
      entityId,
      entityType:
        args.mode === 'form' ? 'form_submission' : 'installation',
      userId: args.request.user.userId,
      params,
      status: 'queued',
      phase: 'Queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return {
      jobId,
      reused: false as const,
      recordVersionNumber: args.recordVersionNumber ?? null,
      recordVersionPayloadHash: args.recordVersionPayloadHash ?? null,
      reportSource: args.liveMode ? 'diagnostic-live' as const : 'canonical-version' as const,
      detailMode: args.detailMode,
      reportVariantKey,
    };
  });
  if (queued.reused) return queued;

  void enqueueExportTask(() =>
    runInstallHubPdfJob({
      jobId,
      installationId: args.installation.id,
      formIds,
      mode: args.mode,
      detailMode: args.detailMode,
      recordVersionNumber: args.recordVersionNumber,
      recordVersionPayloadHash: args.recordVersionPayloadHash,
      reportSource: args.liveMode ? 'diagnostic-live' : 'canonical-version',
      liveTreeRevision,
    }),
  ).catch((error) => {
    const failure = safeInstallHubReportFailure(error);
    console.error('[pdf-job] Field App Complete queue failed', {
      jobId,
      installationId: args.installation.id,
      errorCode: failure.code,
      recordVersionNumber: args.recordVersionNumber ?? null,
    });
  });
  return queued;
}

const protectedPdfRoute = [
  authenticate,
  requireApp('installhub'),
  requireRole('inspector'),
];

export async function installhubPdfRoutes(app: FastifyInstance): Promise<void> {
  app.post('/installations/:installationId/forms/:formId/report/pdf/jobs', {
    schema: {
      tags: ['Field App Complete PDF'],
      summary: 'Start an async Field App Complete form PDF job',
      description:
        'Queues a Sustainability Wise form PDF from a completed, backed-up Field App Complete form.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['installationId', 'formId'],
        properties: {
          installationId: { type: 'string' },
          formId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          recordVersionNumber: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
          liveMode: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            reused: { type: 'boolean' },
            recordVersionNumber: { type: ['integer', 'null'] },
            recordVersionPayloadHash: { type: ['string', 'null'] },
            reportSource: { type: 'string', enum: ['canonical-version', 'diagnostic-live'] },
            detailMode: { type: 'string', enum: ['by-zone', 'by-electrical-hierarchy'] },
            reportVariantKey: { type: ['string', 'null'] },
          },
        },
      },
    },
    preHandler: protectedPdfRoute,
  }, async (request, reply) => {
    const { installationId, formId } = request.params as {
      installationId: string;
      formId: string;
    };
    const installation = await loadInstallation(installationId);
    assertInstallationAccess(installation, request.user);
    const query = request.query as {
      recordVersionNumber?: unknown;
      liveMode?: unknown;
    };
    const recordVersionNumber = requestedRecordVersion(query.recordVersionNumber);
    const liveMode = requestedLiveMode(query.liveMode);
    assertPinnedOrExplicitLive({ recordVersionNumber, liveMode });
    const pinned = recordVersionNumber === undefined
      ? null
      : await loadCanonicalRecordVersion({ installationId, versionNumber: recordVersionNumber });
    if (recordVersionNumber !== undefined && !pinned) throw notFound('Installation record version');
    if (pinned) assertAuthoritativeCanonicalSnapshot(pinned.snapshot);
    const forms = pinned
      ? pinned.snapshot.installationTree.formSubmissions.filter((form) => form.id === formId)
      : await loadCompletedForms(installation.id, [formId]);
    if (forms.length !== 1) throw badRequest('Selected form submission was not found in the record version');
    if (forms[0].status !== 'Completed') throw badRequest(`Form ${formId} must be Completed before PDF generation`);
    if (!pinned) {
      await reconcilePhotoCopyReferencesForParent({
        app: 'installhub',
        parentId: installation.id,
        actor: request.user,
      });
    }
    return reply.status(202).send(await queueInstallHubPdfJob({
      request,
      installation,
      forms,
      mode: 'form',
      detailMode: DEFAULT_INSTALLHUB_REPORT_DETAIL_MODE,
      recordVersionNumber,
      recordVersionPayloadHash: pinned?.snapshot.payloadHash,
      recordVersionSnapshot: pinned?.snapshot,
      liveMode,
    }));
  });

  app.post('/installations/:installationId/report/pdf/jobs', {
    schema: {
      tags: ['Field App Complete PDF'],
      summary: 'Start an async Field App Complete installation-pack PDF job',
      description:
        'Queues an installation summary and selected or all completed form submissions.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['installationId'],
        properties: {
          installationId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          formSubmissionIds: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          recordVersionNumber: { type: 'integer', minimum: 1 },
          liveMode: { type: 'boolean' },
          detailMode: {
            type: 'string',
            enum: ['by-zone', 'by-electrical-hierarchy'],
            default: 'by-electrical-hierarchy',
          },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            reused: { type: 'boolean' },
            recordVersionNumber: { type: ['integer', 'null'] },
            recordVersionPayloadHash: { type: ['string', 'null'] },
            reportSource: { type: 'string', enum: ['canonical-version', 'diagnostic-live'] },
            detailMode: { type: 'string', enum: ['by-zone', 'by-electrical-hierarchy'] },
            reportVariantKey: { type: ['string', 'null'] },
          },
        },
      },
    },
    preHandler: protectedPdfRoute,
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = (request.body ?? {}) as {
      formSubmissionIds?: unknown;
      recordVersionNumber?: unknown;
      liveMode?: unknown;
      detailMode?: unknown;
    };
    const selectedIds = Array.isArray(body.formSubmissionIds)
      ? [...new Set(
          body.formSubmissionIds.filter(
            (value): value is string =>
              typeof value === 'string' && value.trim().length > 0,
          ),
        )]
      : undefined;
    const installation = await loadInstallation(installationId);
    assertInstallationAccess(installation, request.user);
    const recordVersionNumber = requestedRecordVersion(body.recordVersionNumber);
    const liveMode = requestedLiveMode(body.liveMode);
    assertPinnedOrExplicitLive({ recordVersionNumber, liveMode });
    const detailMode = requestedReportDetailMode(body.detailMode);
    const pinned = recordVersionNumber === undefined
      ? null
      : await loadCanonicalRecordVersion({ installationId, versionNumber: recordVersionNumber });
    if (recordVersionNumber !== undefined && !pinned) throw notFound('Installation record version');
    if (pinned) assertAuthoritativeCanonicalSnapshot(pinned.snapshot);
    const pinnedForms = pinned?.snapshot.installationTree.formSubmissions.filter((form) => (
      form.status === 'Completed' && (!selectedIds || selectedIds.includes(form.id))
    ));
    if (pinned && selectedIds && pinnedForms?.length !== selectedIds.length) {
      throw badRequest('One or more selected form submissions were not found in the record version');
    }
    const forms = pinnedForms ?? await loadCompletedForms(installation.id, selectedIds);
    if (!pinned) {
      await reconcilePhotoCopyReferencesForParent({
        app: 'installhub',
        parentId: installation.id,
        actor: request.user,
      });
    }
    return reply.status(202).send(await queueInstallHubPdfJob({
      request,
      installation,
      forms,
      mode: 'installation-pack',
      detailMode,
      recordVersionNumber,
      recordVersionPayloadHash: pinned?.snapshot.payloadHash,
      recordVersionSnapshot: pinned?.snapshot,
      liveMode,
    }));
  });
}
