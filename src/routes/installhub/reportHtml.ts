import {
  INSTALLHUB_REPORT_DEFINITION_BY_TYPE,
  INSTALLHUB_REPORT_MANIFEST_VERSION,
  isReportItemVisible,
  type InstallHubReportDefinition,
  type InstallHubReportFormType,
} from './reportManifest.js';
import {
  renderPdfEquipmentIcon,
  type PdfEquipmentIconName,
} from '../../pdf/equipmentIcons.js';
import type { ElectricalMapLayoutDocument } from './electricalMapLayout.js';

export const INSTALLHUB_LARGE_REPORT_PHOTO_COUNT = 120;
export const INSTALLHUB_LARGE_REPORT_RAW_BYTES = 120 * 1024 * 1024;
export const INSTALLHUB_REPORT_CHUNK_PHOTO_TARGET = 50;

export type InstallHubReportDetailMode =
  | 'by-zone'
  | 'by-electrical-hierarchy';

export type InstallHubElectricalMapImages = {
  overviewDataUri: string;
  sourceWidth: number;
  sourceHeight: number;
  overviewWidth: number;
  overviewHeight: number;
  totalDetailWindows: number;
  omittedDetailWindows: number;
  detailTiles: Array<{
    dataUri: string;
    left: number;
    top: number;
    width: number;
    height: number;
    row: number;
    column: number;
    rowCount: number;
    columnCount: number;
    windowIndex: number;
    windowCount: number;
  }>;
};

export type InstallHubReportAttachment = {
  id?: string;
  slot: string;
  uri: string;
  mimeType?: string;
  caption?: string;
  capturedAt?: string;
};

export type InstallHubReportForm = {
  id: string;
  installationId: string;
  formType: InstallHubReportFormType;
  schemaVersion: number;
  status: string;
  answers: Record<string, string>;
  attachments: InstallHubReportAttachment[];
  completedAt?: Date | string | null;
  supersedesId?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type InstallHubReportInstallation = {
  id: string;
  clientName: string;
  siteName: string;
  siteAddress: string;
  inspectorName: string;
  auditDate: string;
  status: string;
};

export type InstallHubReportPhoto = {
  id: string;
  entityId: string;
  fieldName: string;
  storageKey: string | null;
  remoteUrl: string | null;
  fileSizeBytes: number | null;
  createdAt?: Date | string | null;
};

export type InstallHubCanonicalReport = {
  reportSource: 'canonical-version' | 'diagnostic-live';
  treeRevision: number;
  recordVersionNumber: number | null;
  snapshotPayloadHash: string | null;
  mappingContentHash: string | null;
  authoritative: boolean;
  readyToComplete: boolean;
  electricalMapLayout?: ElectricalMapLayoutDocument;
  physicalLocations: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  electricalNodes: Array<{
    id: string;
    kind: string;
    name: string;
    displayCode?: string;
    typeCode?: string;
    typeLabel?: string;
    physicalLocationId?: string;
    coverageState?: string;
    parentNodeId?: string;
  }>;
  supplyEdges: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    relationship: string;
  }>;
  measurementEdges: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    relationship: string;
  }>;
  meters: Array<{
    id: string;
    installedOnBoardId: string;
    name: string;
    model: string;
    deviceNumber?: string;
    serialNumber?: string;
    channels: Array<{
      id?: string;
      ordinal: number;
      purpose: string;
      load: string;
      phaseLabel?: string;
      sensorRating?: string;
      description?: string;
    }>;
  }>;
  unresolvedRelationships: Array<{
    id: string;
    subjectType: string;
    subjectId: string;
    relation: string;
    missingEnd: string;
    knownNodeId?: string;
    reason: string;
  }>;
  assets: Array<{
    id: string;
    name: string;
    displayCode: string;
    typeLabel: string;
    zoneId: string;
    zoneName: string;
    coverage: unknown;
  }>;
  meteringRows: Array<{
    assignmentId: string;
    meterId?: string;
    channelId?: string;
    meterDisplayName: string;
    channelOrdinal: number | null;
    channelPurpose?: string | null;
    channelDescription?: string | null;
    phaseMode?: string;
    target: unknown;
    direction: string;
    status?: string;
  }>;
  virtualMeterDefinitions: Array<{
    id: string;
    parentNodeId: string;
    totalMeasurementAssignmentId: string;
    subtractAssignmentIds: string[];
    formula: string;
    formulaVersion: number;
    allocation: 'UNALLOCATED_RESIDUAL';
    coverage: Array<{
      assetId: string;
      displayCode: string;
      assetName: string;
      zoneName: string;
    }>;
  }>;
  readinessIssues: Array<{
    code: string;
    entityType: string;
    entityId: string;
    message: string;
  }>;
};

export type ResolvedInstallHubFormPhoto = {
  attachmentIndex: number;
  slot: string;
  caption?: string;
  photo: InstallHubReportPhoto;
};

export type InstallHubFormReportSlice = {
  formId: string;
  sectionIndexes: number[];
  continuation: boolean;
  photoCount: number;
};

export class MissingInstallHubReportEvidenceError extends Error {
  constructor(
    readonly formId: string,
    readonly attachmentIndexes: number[],
  ) {
    super(
      `Form ${formId} has ${attachmentIndexes.length} backed attachment reference${
        attachmentIndexes.length === 1 ? '' : 's'
      } without confirmed original evidence (${attachmentIndexes
        .map((index) => `attachments[${index}].uri`)
        .join(', ')})`,
    );
    this.name = 'MissingInstallHubReportEvidenceError';
  }
}

export function safeInstallHubReportFailure(error: unknown): {
  code: 'missing_confirmed_evidence' | 'report_generation_failed';
  publicMessage: string;
} {
  return error instanceof MissingInstallHubReportEvidenceError
    ? {
        code: 'missing_confirmed_evidence',
        publicMessage: 'The report could not be generated because confirmed evidence is missing.',
      }
    : {
        code: 'report_generation_failed',
        publicMessage: 'The report could not be generated.',
      };
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function referencedPhotoId(uri: string): string | null {
  // Storage paths may contain a parent UUID before the immutable photo UUID.
  // The final UUID is the photo registry identity embedded in the filename.
  return uri.match(UUID_RE)?.at(-1)?.toLowerCase() ?? null;
}

function createdAtValue(photo: InstallHubReportPhoto): number {
  if (!photo.createdAt) return 0;
  const value =
    photo.createdAt instanceof Date
      ? photo.createdAt.getTime()
      : new Date(photo.createdAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Resolves a form attachment only through its canonical registry identity.
 * Filenames and slots are deliberately not used as photo identities.
 */
export function resolveInstallHubFormPhotos(
  form: InstallHubReportForm,
  photos: InstallHubReportPhoto[],
  options: { allowMissingEvidence?: boolean } = {},
): ResolvedInstallHubFormPhoto[] {
  const rowsByField = new Map<string, InstallHubReportPhoto[]>();
  for (const photo of photos) {
    if (photo.entityId !== form.id) continue;
    const rows = rowsByField.get(photo.fieldName) ?? [];
    rows.push(photo);
    rowsByField.set(photo.fieldName, rows);
  }

  const missing: number[] = [];
  const resolved = form.attachments.flatMap((attachment, attachmentIndex) => {
    const fieldName = `attachments[${attachmentIndex}].uri`;
    const candidates = (rowsByField.get(fieldName) ?? [])
      .filter((photo) => Boolean(photo.storageKey && photo.remoteUrl))
      .sort((left, right) => createdAtValue(left) - createdAtValue(right));
    const photoId = referencedPhotoId(attachment.uri);
    const selected =
      (photoId
        ? candidates.find((candidate) => candidate.id.toLowerCase() === photoId)
        : undefined)
      ?? candidates.find((candidate) => candidate.remoteUrl === attachment.uri);
    if (!selected) {
      missing.push(attachmentIndex);
      return [];
    }
    return [{
      attachmentIndex,
      slot: attachment.slot,
      ...(attachment.caption ? { caption: attachment.caption } : {}),
      photo: selected,
    }];
  });

  if (missing.length > 0 && !options.allowMissingEvidence) {
    throw new MissingInstallHubReportEvidenceError(form.id, missing);
  }
  return resolved;
}

export function installHubReportPhotoTotals(
  resolvedPhotos: ResolvedInstallHubFormPhoto[],
): { count: number; rawBytes: number } {
  const unique = new Map<string, InstallHubReportPhoto>();
  for (const resolved of resolvedPhotos) {
    unique.set(resolved.photo.id, resolved.photo);
  }
  return {
    count: unique.size,
    rawBytes: [...unique.values()].reduce(
      (sum, photo) => sum + (photo.fileSizeBytes ?? 0),
      0,
    ),
  };
}

export function installHubReportNeedsChunks(
  totals: { count: number; rawBytes: number },
): boolean {
  return (
    totals.count > INSTALLHUB_LARGE_REPORT_PHOTO_COUNT
    || totals.rawBytes > INSTALLHUB_LARGE_REPORT_RAW_BYTES
  );
}

function definitionFor(form: InstallHubReportForm): InstallHubReportDefinition {
  const definition = INSTALLHUB_REPORT_DEFINITION_BY_TYPE[form.formType];
  if (!definition) throw new Error(`Unsupported Field App Complete report type: ${form.formType}`);
  return definition;
}

export function visibleInstallHubReportSectionIndexes(
  form: InstallHubReportForm,
): number[] {
  return definitionFor(form).sections.flatMap((section, index) =>
    isReportItemVisible(section.showWhen, form.answers) ? [index] : [],
  );
}

function sectionPhotoSlots(
  form: InstallHubReportForm,
  sectionIndex: number,
): Set<string> {
  const section = definitionFor(form).sections[sectionIndex];
  if (!section || !isReportItemVisible(section.showWhen, form.answers)) {
    return new Set();
  }
  return new Set(
    section.fields
      .filter(
        (field) =>
          field.kind === 'photo'
          && isReportItemVisible(field.showWhen, form.answers),
      )
      .map((field) => field.key),
  );
}

export function photosForInstallHubFormSlice(
  form: InstallHubReportForm,
  resolvedPhotos: ResolvedInstallHubFormPhoto[],
  sectionIndexes: number[],
): ResolvedInstallHubFormPhoto[] {
  const slots = new Set(
    sectionIndexes.flatMap((sectionIndex) => [
      ...sectionPhotoSlots(form, sectionIndex),
    ]),
  );
  return resolvedPhotos.filter((photo) => slots.has(photo.slot));
}

/**
 * Chunks only at semantic section boundaries. A single oversized section stays
 * atomic because splitting its heading/field/photo relationship is less useful
 * than exceeding the target for that one chunk.
 */
export function planInstallHubFormReportSlices(
  form: InstallHubReportForm,
  resolvedPhotos: ResolvedInstallHubFormPhoto[],
  target = INSTALLHUB_REPORT_CHUNK_PHOTO_TARGET,
): InstallHubFormReportSlice[] {
  const slices: InstallHubFormReportSlice[] = [];
  let sectionIndexes: number[] = [];
  let photoCount = 0;

  for (const sectionIndex of visibleInstallHubReportSectionIndexes(form)) {
    const sectionCount = photosForInstallHubFormSlice(
      form,
      resolvedPhotos,
      [sectionIndex],
    ).length;
    if (
      sectionIndexes.length > 0
      && photoCount + sectionCount > target
    ) {
      slices.push({
        formId: form.id,
        sectionIndexes,
        continuation: slices.length > 0,
        photoCount,
      });
      sectionIndexes = [];
      photoCount = 0;
    }
    sectionIndexes.push(sectionIndex);
    photoCount += sectionCount;
  }

  if (sectionIndexes.length > 0 || slices.length === 0) {
    slices.push({
      formId: form.id,
      sectionIndexes,
      continuation: slices.length > 0,
      photoCount,
    });
  }
  return slices;
}

export function planInstallHubPackChunks(
  forms: InstallHubReportForm[],
  resolvedByForm: Map<string, ResolvedInstallHubFormPhoto[]>,
  target = INSTALLHUB_REPORT_CHUNK_PHOTO_TARGET,
): InstallHubFormReportSlice[][] {
  const units = forms.flatMap((form) =>
    planInstallHubFormReportSlices(
      form,
      resolvedByForm.get(form.id) ?? [],
      target,
    ),
  );
  const chunks: InstallHubFormReportSlice[][] = [];
  let current: InstallHubFormReportSlice[] = [];
  let photoCount = 0;
  for (const unit of units) {
    if (
      current.length > 0
      && photoCount + unit.photoCount > target
    ) {
      chunks.push(current);
      current = [];
      photoCount = 0;
    }
    current.push(unit);
    photoCount += unit.photoCount;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayValue(value: string | undefined): string {
  if (!value) return 'Not provided';
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'not_applicable') return 'Not applicable';
  return value;
}

function displayDate(value: string | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return displayValue(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const hasTime = /T\d{2}:\d{2}/.test(raw);
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(hasTime
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : {}),
    timeZone: 'Australia/Sydney',
  }).format(parsed);
}

function answerHtml(value: string | undefined, key?: string): string {
  const display = escapeHtml(
    key && /(^|\.)(date|date_time)$/.test(key)
      ? displayDate(value)
      : displayValue(value),
  );
  if (value === 'yes') return `<span class="badge badge-yes">${display}</span>`;
  if (value === 'no') return `<span class="badge badge-no">${display}</span>`;
  if (value === 'not_applicable') {
    return `<span class="badge badge-neutral">${display}</span>`;
  }
  if (!value) return `<span class="not-provided">${display}</span>`;
  return display;
}

function photoGrid(
  photos: ResolvedInstallHubFormPhoto[],
  label: string,
): string {
  const rows: string[] = [];
  for (let index = 0; index < photos.length; index += 2) {
    const cells = photos.slice(index, index + 2).map((resolved) => {
      const caption = resolved.caption?.trim() || label;
      return `<div class="photo-cell">
        <img src="${escapeHtml(resolved.photo.remoteUrl)}" alt="${escapeHtml(caption)}" />
        <div class="photo-caption">${escapeHtml(caption)}</div>
      </div>`;
    });
    if (cells.length === 1) {
      cells.push('<div class="photo-cell photo-empty"></div>');
    }
    rows.push(`<div class="photo-row">${cells.join('')}</div>`);
  }
  return `<div class="photo-grid">${rows.join('')}</div>`;
}

function formSectionsHtml(
  form: InstallHubReportForm,
  sectionIndexes: number[],
  resolvedPhotos: ResolvedInstallHubFormPhoto[],
): string {
  const definition = definitionFor(form);
  const visibleSectionIndexes = visibleInstallHubReportSectionIndexes(form);
  return sectionIndexes.map((sectionIndex) => {
    const section = definition.sections[sectionIndex];
    if (!section || !isReportItemVisible(section.showWhen, form.answers)) return '';
    const sectionNumber = visibleSectionIndexes.indexOf(sectionIndex) + 1;
    const visibleFields = section.fields.filter((field) =>
      isReportItemVisible(field.showWhen, form.answers),
    );
    const rows = visibleFields
      .filter((field) => field.kind !== 'photo')
      .map((field) => `<div class="field-row">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="field-value">${answerHtml(form.answers[field.key], field.key)}</div>
      </div>`)
      .join('');
    const photos = visibleFields
      .filter((field) => field.kind === 'photo')
      .map((field) => {
        const images = resolvedPhotos.filter((item) => item.slot === field.key);
        return `<div class="photo-block">
          <h3>${escapeHtml(field.label)}</h3>
          ${
            images.length > 0
              ? photoGrid(images, field.label)
              : '<div class="missing">No photo provided</div>'
          }
        </div>`;
      })
      .join('');
    return `<section>
      <div class="section-bar"><span class="section-number">${
        sectionNumber
      }</span>${escapeHtml(section.title)}</div>
      ${rows ? `<div class="fields">${rows}</div>` : ''}
      ${photos}
    </section>`;
  }).join('');
}

function coverDetails(
  form: InstallHubReportForm,
): { label: string; value: string } {
  if (form.formType === 'ace-switchboard') {
    return {
      label: 'Job',
      value: displayValue(form.answers['job.name']),
    };
  }
  return {
    label: 'Customer / site',
    value: displayValue(form.answers['site.customer_name']),
  };
}

function formCoverHtml(
  form: InstallHubReportForm,
  logoDataUri: string,
): string {
  const definition = definitionFor(form);
  const primary = coverDetails(form);
  return `<div class="cover">
    <div class="cover-eyebrow">Field App Complete installation record</div>
    <h1 class="cover-title">${escapeHtml(definition.title)}</h1>
    <div class="cover-brand">
      <div class="cover-brand-label">Prepared by</div>
      <img class="cover-brand-logo" src="${escapeHtml(logoDataUri)}" alt="Sustainability Wise" />
    </div>
    <div class="cover-meta">
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">${escapeHtml(primary.label)}</div><div class="cover-meta-value">${escapeHtml(primary.value)}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Date and time</div><div class="cover-meta-value">${escapeHtml(displayDate(form.answers['site.date_time']))}</div></div>
      </div>
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">Installer</div><div class="cover-meta-value">${escapeHtml(displayValue(form.answers['installer.name']))}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Submission ID</div><div class="cover-meta-value">${escapeHtml(form.id)}</div></div>
      </div>
    </div>
    <div class="cover-status ${form.status === 'Completed' ? 'cover-status-completed' : 'cover-status-draft'}">${escapeHtml(form.status)}</div>
  </div>`;
}

function installationCoverHtml(
  installation: InstallHubReportInstallation,
  formCount: number,
  photoCount: number,
  logoDataUri: string,
): string {
  return `<div class="cover">
    <div class="cover-eyebrow">Field App Complete installation record</div>
    <h1 class="cover-title">Field App Complete Installation Pack</h1>
    <div class="cover-brand">
      <div class="cover-brand-label">Prepared by</div>
      <img class="cover-brand-logo" src="${escapeHtml(logoDataUri)}" alt="Sustainability Wise" />
    </div>
    <div class="cover-meta">
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">Site</div><div class="cover-meta-value">${escapeHtml(installation.siteName)}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Client</div><div class="cover-meta-value">${escapeHtml(installation.clientName)}</div></div>
      </div>
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">Address</div><div class="cover-meta-value">${escapeHtml(installation.siteAddress)}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Audit date</div><div class="cover-meta-value">${escapeHtml(displayDate(installation.auditDate))}</div></div>
      </div>
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">Inspector</div><div class="cover-meta-value">${escapeHtml(installation.inspectorName)}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Installation ID</div><div class="cover-meta-value">${escapeHtml(installation.id)}</div></div>
      </div>
    </div>
    <div class="cover-status ${installation.status === 'Completed' ? 'cover-status-completed' : 'cover-status-draft'}">${escapeHtml(installation.status)}</div>
    <div class="stats">
      <div class="stat"><span>${formCount}</span>Completed forms</div>
      <div class="stat"><span>${photoCount}</span>Evidence photos</div>
    </div>
  </div>`;
}

function reportCss(): string {
  return `
@page{size:A4;background:#FFFFFF;}
/* The pictorial electrical overview is inherently landscape. Its own named page
   keeps the constellation and labels comfortably readable; a renderer without named-page
   support simply keeps the portrait page it produces today. */
@page electricalmap{size:A4 landscape;background:#FFFFFF;}
*{box-sizing:border-box;}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;color:#1E293B;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;font-size:10pt;line-height:1.45;}
.content{padding:18px 28px 40px;}
.cover{background:#142F70;border:1px solid #1D4ED8;border-top:5px solid #0B3F59;border-radius:0 0 8px 8px;padding:20px 22px 18px;margin-bottom:18px;}
.cover-eyebrow{color:#DBEAFE;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin-bottom:7px;}
.cover-title{color:#FFFFFF;font-size:18pt;font-weight:900;line-height:1.2;margin:0 0 13px;}
.cover-brand{margin:8px 0 13px;}
.cover-brand-label{color:#BFDBFE;font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px;}
.cover-brand-logo{display:block;width:162px;height:auto;background:#FFFFFF;border-radius:6px;padding:5px 9px;}
.cover-meta{display:table;width:100%;border-collapse:collapse;overflow:hidden;border-radius:6px;}
.cover-meta-row{display:table-row;}
.cover-meta-cell{display:table-cell;width:50%;padding:9px 12px;background:#FFFFFF;border:1px solid #BFDBFE;vertical-align:top;}
.cover-meta-label{color:#64748B;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;}
.cover-meta-value{color:#0F172A;font-size:9.5pt;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;}
.cover-status{display:inline-block;margin-top:11px;padding:3px 10px;border:1px solid;border-radius:4px;font-size:7.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.08em;}
.cover-status-completed{color:#166534;background:#DCFCE7;border-color:#86EFAC;}
.cover-status-draft{color:#92400E;background:#FEF3C7;border-color:#FCD34D;}
.stats{display:table;width:100%;border-spacing:8px;margin-top:10px;}
.stat{display:table-cell;width:50%;padding:8px 10px;color:#64748B;background:#F8FAFC;border:1px solid #DBEAFE;border-top:3px solid #1E3A8A;text-transform:uppercase;font-size:7pt;font-weight:700;}
.stat span{display:block;color:#1E3A8A;font-size:15pt;font-weight:900;}
.form-record{margin-top:18px;}
.form-record + .form-record{page-break-before:always;break-before:page;}
.form-heading{background:#EFF6FF;border-left:4px solid #1E3A8A;color:#1E3A8A;padding:10px 13px;margin-bottom:8px;page-break-after:avoid;break-after:avoid;}
.form-heading-title{font-size:11pt;font-weight:900;}
.form-heading-meta{font-size:7.5pt;color:#64748B;margin-top:3px;}
section{break-inside:auto;margin:0 0 14px;}
.section-bar{background:#1E3A8A;color:#FFFFFF;font-size:8.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.08em;padding:7px 12px;margin-top:14px;page-break-after:avoid;break-after:avoid;}
.section-number{display:inline-block;width:19px;height:19px;margin-right:8px;border-radius:50%;background:rgba(255,255,255,.18);text-align:center;line-height:19px;letter-spacing:0;}
h3{color:#1E3A8A;background:#EFF6FF;border-left:4px solid #1E3A8A;font-size:9.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin:10px 0 5px;padding:7px 10px;page-break-after:avoid;break-after:avoid;}
.fields{display:table;width:100%;border:1px solid #DBEAFE;border-top:0;border-collapse:collapse;}
.field-row{display:table-row;page-break-inside:avoid;break-inside:avoid;}
.field-label,.field-value{display:table-cell;border-top:1px solid #DBEAFE;vertical-align:top;}
.field-row:first-child .field-label,.field-row:first-child .field-value{border-top:0;}
.field-label{width:40%;padding:6px 10px 6px 12px;color:#64748B;background:#F8FAFC;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
.field-value{width:60%;padding:6px 12px;color:#0F172A;font-size:9pt;white-space:pre-wrap;overflow-wrap:anywhere;}
.not-provided{color:#94A3B8;font-style:italic;}
.badge{display:inline-block;padding:2px 8px;border:1px solid;border-radius:999px;font-size:7.5pt;font-weight:800;}
.badge-yes{color:#166534;background:#DCFCE7;border-color:#86EFAC;}
.badge-no{color:#92400E;background:#FEF3C7;border-color:#FCD34D;}
.badge-neutral{color:#475569;background:#F1F5F9;border-color:#CBD5E1;}
.photo-block{break-inside:auto;margin-top:10px;}
.photo-grid{display:table;width:100%;border-collapse:separate;border-spacing:7px;table-layout:fixed;}
.photo-row{display:table-row;page-break-inside:avoid;break-inside:avoid;}
.photo-cell{display:table-cell;width:50%;padding:5px;border:1px solid #CBD5E1;border-radius:6px;text-align:center;vertical-align:top;page-break-inside:avoid;break-inside:avoid;background:#FFFFFF;}
.photo-empty{border-color:transparent;}
.photo-cell img{max-width:100%;max-height:212px;width:auto;height:auto;object-fit:contain;border-radius:4px;background:#FFFFFF;}
.photo-caption{color:#64748B;font-size:7pt;line-height:1.3;margin-top:4px;overflow-wrap:anywhere;}
.missing{color:#94A3B8;font-size:8.5pt;font-style:italic;border:1px dashed #CBD5E1;background:#F8FAFC;padding:10px 12px;}
.end-block{margin-top:24px;padding:13px 16px;background:#1E3A8A;color:#FFFFFF;border-radius:7px;font-size:9pt;font-weight:700;}
.canonical-section{page-break-before:always;break-before:page;margin-top:18px;}
.canonical-table{width:100%;border-collapse:collapse;font-size:7.5pt;margin:7px 0 14px;}
.canonical-table th,.canonical-table td{border:1px solid #CBD5E1;padding:5px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere;}
.canonical-table th{color:#1E3A8A;background:#EFF6FF;font-weight:800;text-transform:uppercase;letter-spacing:.04em;}
.meter-channel-schedule tbody tr{page-break-inside:avoid;break-inside:avoid;}
.meter-channel-schedule small{display:block;margin-top:2px;color:#64748B;font-size:6.7pt;line-height:1.3;}
.canonical-meta{padding:8px 10px;background:#F8FAFC;border:1px solid #CBD5E1;font-size:7.5pt;overflow-wrap:anywhere;}
.electrical-map{page:electricalmap;page-break-before:always;break-before:page;page-break-after:always;break-after:page;margin-top:0;}
.electrical-map-frame{margin:8px 0 14px;padding:8px;border:1px solid #CBD5E1;border-radius:7px;background:#FFFFFF;page-break-inside:avoid;break-inside:avoid;}
.electrical-map-frame img{display:block;width:100%;height:auto;max-height:555px;object-fit:contain;}
.electrical-map-caption{margin-top:5px;color:#64748B;font-size:7pt;line-height:1.35;}
.electrical-map-detail{page:electricalmap;page-break-before:always;break-before:page;page-break-after:always;break-after:page;margin-top:0;}
.electrical-map-detail .electrical-map-frame img{max-height:585px;}
.electrical-map-segment-label{font-weight:800;color:#1E3A8A;}
.detail-group{margin:0 0 13px;border:1px solid #DBEAFE;border-left:3px solid #1E3A8A;border-radius:0 7px 7px 0;page-break-inside:auto;break-inside:auto;}
.detail-group-title{padding:7px 10px;background:#EFF6FF;color:#1E3A8A;font-size:9pt;font-weight:900;page-break-after:avoid;break-after:avoid;}
.detail-row{display:table;width:100%;border-top:1px solid #E2E8F0;page-break-inside:avoid;break-inside:avoid;}
.detail-icon,.detail-main,.detail-meta{display:table-cell;padding:6px 8px;vertical-align:top;}
.detail-icon{width:36px;color:#1E3A8A;text-align:center;}
.detail-icon .iico{display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;}
.detail-icon .iico-svg{display:block;width:22px;height:22px;}
.detail-main{width:44%;font-size:8.5pt;font-weight:800;color:#0F172A;}
.detail-main small,.detail-meta small{display:block;margin-top:2px;color:#64748B;font-size:7pt;font-weight:500;line-height:1.35;}
.detail-meta{font-size:7.5pt;color:#334155;}
.hierarchy-indent{display:inline-block;min-width:0;}
.compact-appendix{margin-top:12px;page-break-inside:auto;break-inside:auto;}
.compact-list{margin:6px 0 12px;padding-left:18px;color:#334155;font-size:7.5pt;line-height:1.45;}
`;
}

function compactJson(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${key}: ${String(source[key])}`).join(', ')}}`;
}

function reportTargetNodeId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as Record<string, unknown>;
  if (target.kind === 'BOARD') return typeof target.boardId === 'string' ? target.boardId : null;
  if (target.kind === 'SITE_ASSET') return typeof target.siteAssetId === 'string' ? target.siteAssetId : null;
  if (target.kind === 'GRID_BOUNDARY') return typeof target.gridSupplyId === 'string' ? target.gridSupplyId : null;
  return null;
}

function readableReportCode(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => (
    character.toUpperCase()
  ));
}

function reportChannelSummary(
  channel: InstallHubCanonicalReport['meters'][number]['channels'][number],
): string {
  const context = [
    channel.load || (channel.purpose === 'SPARE' ? 'Spare / not used' : 'Unclassified load'),
    channel.description,
  ].filter(Boolean).join(' - ');
  const phase = channel.phaseLabel ? ` - phase ${channel.phaseLabel}` : '';
  return `Ch ${channel.ordinal}${phase}${context ? ` - ${context}` : ''}`;
}

function reportNodeDisplayName(report: InstallHubCanonicalReport, nodeId: string): string {
  const node = report.electricalNodes.find((candidate) => candidate.id === nodeId);
  return node ? `${node.displayCode ? `${node.displayCode} - ` : ''}${node.name}` : nodeId;
}

function meterChannelScheduleHtml(report: InstallHubCanonicalReport): string {
  if (!report.meters.length) {
    return '<p class="canonical-meta">No meter devices or channels are recorded for this report source.</p>';
  }
  const meters = report.meters.slice().sort((left, right) => (
    left.installedOnBoardId.localeCompare(right.installedOnBoardId)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id)
  ));
  const rows = meters.flatMap((meter) => {
    const meterMeta = [
      meter.model,
      meter.deviceNumber ? `Device ${meter.deviceNumber}` : '',
      meter.serialNumber ? `Serial ${meter.serialNumber}` : '',
    ].filter(Boolean).join(' - ');
    const meterCell = `<strong>${escapeHtml(meter.name)}</strong><small>${escapeHtml(meterMeta)}</small>`;
    const boardCell = escapeHtml(reportNodeDisplayName(report, meter.installedOnBoardId));
    if (!meter.channels.length) {
      return [`<tr data-meter-id="${escapeHtml(meter.id)}"><td>${meterCell}</td><td>${boardCell}</td><td colspan="3">No channels configured.</td></tr>`];
    }
    return meter.channels
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((channel) => {
        const allocations = report.meteringRows.filter((row) => {
          const meterMatches = row.meterId
            ? row.meterId === meter.id
            : row.meterDisplayName === meter.name;
          if (!meterMatches) return false;
          return row.channelId && channel.id
            ? row.channelId === channel.id
            : row.channelOrdinal === channel.ordinal;
        }).map((row) => {
          const targetId = reportTargetNodeId(row.target);
          const target = targetId ? reportNodeDisplayName(report, targetId) : 'Unresolved target';
          const state = [
            readableReportCode(row.direction),
            row.phaseMode ? readableReportCode(row.phaseMode) : '',
            row.status ? readableReportCode(row.status) : '',
          ].filter(Boolean).join(' - ');
          return `${target}${state ? ` (${state})` : ''}`;
        });
        const uniqueAllocations = [...new Set(allocations)];
        const allocationText = uniqueAllocations.length
          ? uniqueAllocations.join('; ')
          : channel.purpose === 'SPARE'
            ? 'Not used (spare)'
            : 'Unassigned active channel';
        const channelMeta = [
          readableReportCode(channel.purpose),
          channel.phaseLabel ? `Phase ${channel.phaseLabel}` : '',
          channel.sensorRating ? `Sensor ${channel.sensorRating}` : '',
        ].filter(Boolean).join(' - ');
        const load = channel.load || (channel.purpose === 'SPARE'
          ? 'Spare / not used'
          : 'Unclassified load');
        return `<tr data-meter-id="${escapeHtml(meter.id)}" data-meter-channel-id="${escapeHtml(channel.id ?? `${meter.id}:channel:${channel.ordinal}`)}"><td>${meterCell}</td><td>${boardCell}</td><td><strong>Ch ${channel.ordinal}</strong><small>${escapeHtml(channelMeta)}</small></td><td><strong>${escapeHtml(load)}</strong>${channel.description ? `<small>${escapeHtml(channel.description)}</small>` : ''}</td><td>${escapeHtml(allocationText)}</td></tr>`;
      });
  }).join('');
  return `<table class="canonical-table meter-channel-schedule"><colgroup><col style="width:18%"/><col style="width:24%"/><col style="width:13%"/><col style="width:17%"/><col style="width:28%"/></colgroup><thead><tr><th>Meter</th><th>Installed at</th><th>Channel</th><th>Electrical load</th><th>Recorded allocation</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function reportNodeIcon(node: InstallHubCanonicalReport['electricalNodes'][number]): PdfEquipmentIconName {
  if (node.kind === 'BOARD') return 'switchboard';
  if (node.kind === 'GRID' || node.kind === 'VIRTUAL_RESIDUAL') return 'electricity';
  const value = `${node.typeLabel ?? ''} ${node.name}`.toUpperCase();
  if (/HVAC|AIR\s*CON|REFRIG|CHILL|FREEZ|COOL/.test(value)) return 'hvac';
  if (/LIGHT/.test(value)) return 'lighting';
  if (/SOLAR|\bPV\b/.test(value)) return 'solar';
  if (/EV|CHARG|FORKLIFT|BATTER|OUTLET|PLUG/.test(value)) return 'charger';
  if (/HOT\s*WATER|HEAT|GEYSER/.test(value)) return 'hot-water';
  if (/WATER/.test(value)) return 'water';
  return 'electricity';
}

function reportNodeSummary(
  report: InstallHubCanonicalReport,
  node: InstallHubCanonicalReport['electricalNodes'][number],
  depth = 0,
): string {
  const zoneName = node.physicalLocationId
    ? report.physicalLocations.find((zone) => zone.id === node.physicalLocationId)?.name
    : undefined;
  const meters = report.meters.filter((meter) => meter.installedOnBoardId === node.id);
  const measuredBy = report.meteringRows.filter((row) => (
    (!row.status || row.status === 'CONFIRMED')
      && reportTargetNodeId(row.target) === node.id
  ));
  const icon = renderPdfEquipmentIcon(reportNodeIcon(node));
  const meterText = meters.map((meter) => {
    const channels = meter.channels
      .filter((channel) => channel.purpose !== 'SPARE')
      .map(reportChannelSummary)
      .join(', ');
    return `${meter.name} - ${meter.model}${channels ? ` - channels ${channels}` : ''}`;
  }).join('; ');
  const measuredText = measuredBy.map((row) => {
    const meter = report.meters.find((candidate) => (
      row.meterId ? candidate.id === row.meterId : candidate.name === row.meterDisplayName
    ));
    const channel = row.channelOrdinal === null
      ? undefined
      : meter?.channels.find((candidate) => (
          row.channelId && candidate.id
            ? candidate.id === row.channelId
            : candidate.ordinal === row.channelOrdinal
        ));
    const measuredChannel = row.channelOrdinal === null
      ? ''
      : ` ${channel ? reportChannelSummary(channel) : `Ch ${row.channelOrdinal}`}`;
    return `${row.meterDisplayName}${measuredChannel}`;
  }).join('; ');
  const typeAndCoverage = [
    node.kind === 'SITE_ASSET' ? 'Connected load' : '',
    node.typeLabel,
    node.coverageState,
  ].filter(Boolean).join(' - ');
  return `<div class="detail-row" data-electrical-node-id="${escapeHtml(node.id)}">
    <div class="detail-icon">${icon}</div>
    <div class="detail-main"><span class="hierarchy-indent" style="width:${Math.min(depth, 8) * 12}px"></span>${escapeHtml(node.displayCode || node.name)}${node.displayCode ? `<small>${escapeHtml(node.name)}</small>` : ''}</div>
    <div class="detail-meta">${escapeHtml(typeAndCoverage || node.kind.replaceAll('_', ' '))}${zoneName ? `<small>Physical zone: ${escapeHtml(zoneName)}</small>` : ''}${meterText ? `<small>Installed device: ${escapeHtml(meterText)}</small>` : ''}${measuredText ? `<small>Measured by: ${escapeHtml(measuredText)}</small>` : ''}</div>
  </div>`;
}

function hierarchyNodeOrder(report: InstallHubCanonicalReport): Array<{
  node: InstallHubCanonicalReport['electricalNodes'][number];
  depth: number;
}> {
  const byId = new Map(report.electricalNodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of report.supplyEdges) {
    const entries = children.get(edge.sourceNodeId) ?? [];
    entries.push(edge.targetNodeId);
    children.set(edge.sourceNodeId, entries);
    incoming.add(edge.targetNodeId);
  }
  for (const node of report.electricalNodes) {
    if (node.kind !== 'VIRTUAL_RESIDUAL' || !node.parentNodeId) continue;
    const entries = children.get(node.parentNodeId) ?? [];
    entries.push(node.id);
    children.set(node.parentNodeId, entries);
    incoming.add(node.id);
  }
  for (const entries of children.values()) {
    entries.sort((left, right) => left.localeCompare(right));
  }
  const visited = new Set<string>();
  const ordered: Array<{
    node: InstallHubCanonicalReport['electricalNodes'][number];
    depth: number;
  }> = [];
  const walk = (nodeId: string, depth: number): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) return;
    ordered.push({ node, depth });
    for (const childId of children.get(nodeId) ?? []) walk(childId, depth + 1);
  };
  const roots = report.electricalNodes
    .filter((node) => !incoming.has(node.id))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  for (const node of roots) walk(node.id, 0);
  for (const node of report.electricalNodes
    .filter((node) => !visited.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id))) walk(node.id, 0);
  return ordered;
}

function hierarchyRows(report: InstallHubCanonicalReport): string {
  return hierarchyNodeOrder(report)
    .map(({ node, depth }) => reportNodeSummary(report, node, depth))
    .join('');
}

function indexedHierarchyFallbackTable(report: InstallHubCanonicalReport): string {
  const nodeNames = new Map(report.electricalNodes.map((node) => [
    node.id,
    node.displayCode || node.name,
  ]));
  const supplyParent = new Map<string, string>();
  for (const edge of report.supplyEdges
    .slice()
    .sort((left, right) => left.targetNodeId.localeCompare(right.targetNodeId)
      || left.sourceNodeId.localeCompare(right.sourceNodeId))) {
    if (!supplyParent.has(edge.targetNodeId)) supplyParent.set(edge.targetNodeId, edge.sourceNodeId);
  }
  const zoneNames = new Map(report.physicalLocations.map((zone) => [zone.id, zone.name]));
  const rows = hierarchyNodeOrder(report).map(({ node, depth }, index) => {
    const parentId = supplyParent.get(node.id) ?? node.parentNodeId;
    return `<tr data-electrical-node-id="${escapeHtml(node.id)}"><td>${index + 1}</td><td><span class="hierarchy-indent" style="width:${Math.min(depth, 8) * 12}px"></span><strong>${escapeHtml(node.displayCode || node.name)}</strong>${node.displayCode ? `<small>${escapeHtml(node.name)}</small>` : ''}</td><td>${escapeHtml(node.typeLabel || node.kind.replaceAll('_', ' '))}</td><td>${escapeHtml(parentId ? nodeNames.get(parentId) ?? parentId : 'Electrical root')}</td><td>${escapeHtml(node.physicalLocationId ? zoneNames.get(node.physicalLocationId) ?? node.physicalLocationId : 'Shared / unassigned')}</td></tr>`;
  }).join('');
  return `<table class="canonical-table hierarchy-fallback-table"><thead><tr><th>#</th><th>Electrical node</th><th>Type</th><th>Supplied from / parent</th><th>Zone</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No electrical nodes recorded.</td></tr>'}</tbody></table>`;
}

function compactCanonicalAppendices(report: InstallHubCanonicalReport): string {
  const unresolved = report.unresolvedRelationships.length
    ? `<ul class="compact-list">${report.unresolvedRelationships.map((item) => `<li>${escapeHtml(`${item.subjectType} ${item.subjectId}: ${item.relation} ${item.reason}`)}</li>`).join('')}</ul>`
    : '<p class="canonical-meta">No unresolved electrical relationships.</p>';
  const readiness = report.readinessIssues.length
    ? `<ul class="compact-list">${report.readinessIssues.map((issue) => `<li><strong>${escapeHtml(issue.code)}</strong> - ${escapeHtml(issue.message)}</li>`).join('')}</ul>`
    : '<p class="canonical-meta">No blocking readiness issues in this report source.</p>';
  const residual = report.virtualMeterDefinitions.length
    ? `<ul class="compact-list">${report.virtualMeterDefinitions.map((definition) => `<li><strong>${escapeHtml(definition.id)}</strong> - ${escapeHtml(definition.formula)} - calculated residual, not a direct meter reading.</li>`).join('')}</ul>`
    : '<p class="canonical-meta">No calculated residual loads.</p>';
  return `<div class="compact-appendix">
    <h3>Unresolved relationships</h3>${unresolved}
    <h3>Calculated residuals</h3>${residual}
    <h3>Readiness</h3>${readiness}
  </div>`;
}

function zoneDetailsHtml(report: InstallHubCanonicalReport): string {
  const renderedZoneIds = new Set<string>();
  const zones = report.physicalLocations.filter((zone) => {
    if (renderedZoneIds.has(zone.id)) return false;
    renderedZoneIds.add(zone.id);
    return true;
  });
  const knownZoneIds = new Set(zones.map((zone) => zone.id));
  const renderNodes = (nodes: InstallHubCanonicalReport['electricalNodes']) => (
    nodes.length
      ? nodes
        .slice()
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))
        .map((node) => reportNodeSummary(report, node))
        .join('')
      : '<div class="canonical-meta">No switchboards or loads recorded in this zone.</div>'
  );
  const zoneGroups = zones.map((zone) => {
    const nodes = report.electricalNodes.filter((node) => node.physicalLocationId === zone.id);
    return `<div class="detail-group" data-zone-id="${escapeHtml(zone.id)}"><div class="detail-group-title">${escapeHtml(zone.name)}${zone.description ? ` - ${escapeHtml(zone.description)}` : ''}</div>${renderNodes(nodes)}</div>`;
  }).join('');
  const sharedNodes = report.electricalNodes.filter((node) => (
    !node.physicalLocationId || !knownZoneIds.has(node.physicalLocationId)
  ));
  const sharedGroup = sharedNodes.length
    ? `<div class="detail-group" data-zone-id="shared-unassigned"><div class="detail-group-title">Shared / unassigned electrical infrastructure</div>${renderNodes(sharedNodes)}</div>`
    : '';
  return zoneGroups + sharedGroup;
}

function installationDetailsHtml(
  report: InstallHubCanonicalReport,
  detailMode: InstallHubReportDetailMode,
  electricalMapImages?: InstallHubElectricalMapImages,
): string {
  const canonicalVersionMeta = report.reportSource === 'canonical-version'
    ? `Record version ${report.recordVersionNumber} &middot; Snapshot ${escapeHtml(report.snapshotPayloadHash)} &middot; Mapping ${escapeHtml(report.mappingContentHash)}`
    : 'Live diagnostic projection &middot; Not pinned to a canonical record version or payload hash';
  const authorityLabel = report.authoritative ? 'AUTHORITATIVE' : 'NON-AUTHORITATIVE';
  const detailPagesCapped = Boolean(electricalMapImages?.omittedDetailWindows);
  const detailMapPages = electricalMapImages?.detailTiles.map((tile, index, tiles) => (
    `<div class="electrical-map-detail" data-map-detail-segment="${index + 1}">
      <div class="section-bar">Electrical map detail - row ${tile.row} of ${tile.rowCount}, column ${tile.column} of ${tile.columnCount}</div>
      <div class="electrical-map-frame"><img src="${escapeHtml(tile.dataUri)}" alt="Electrical map detail row ${tile.row} of ${tile.rowCount}, column ${tile.column} of ${tile.columnCount}" /></div>
      <p class="electrical-map-caption"><span class="electrical-map-segment-label">Detail page ${index + 1} of ${tiles.length} - source window ${tile.windowIndex} of ${tile.windowCount}, row ${tile.row}, column ${tile.column}.</span> Source window left ${tile.left + 1}-${tile.left + tile.width}, top ${tile.top + 1}-${tile.top + tile.height} of ${electricalMapImages.sourceWidth} x ${electricalMapImages.sourceHeight}. ${detailPagesCapped ? 'Window edges retain source overlap; capped sets may omit intermediate windows.' : 'Adjacent rows and columns overlap to preserve connector continuity.'} Refer to the complete overview for the full topology and legend.</p>
    </div>`
  )).join('') ?? '';
  const map = electricalMapImages
    ? `<div class="electrical-map">
        <div class="section-bar">Installation electrical map</div>
        <div class="electrical-map-frame"><img src="${escapeHtml(electricalMapImages.overviewDataUri)}" alt="Complete electrical supply, metering and connected load overview" /></div>
        <p class="electrical-map-caption">This client-facing overview uses the saved electrical map arrangement when one has been prepared; otherwise it uses the automatic top-down hierarchy. Straight copper lines follow confirmed supply paths from the incoming grid through each level, grey dotted lines show calculated residual relationships, and each board keeps its installed meters close by with active channel and load labels. Every connected load carries its own pictogram, name, location, coverage and confirmed meter/channel allocation.${detailPagesCapped ? ` This complete overview is retained; visual detail pages are capped at ${electricalMapImages.detailTiles.length} representative windows from ${electricalMapImages.totalDetailWindows}.` : ''}</p>
      </div>${detailMapPages}`
    : '';
  const cappedFallbackNotice = detailPagesCapped
    ? `<div class="canonical-meta" data-map-detail-fallback="indexed-hierarchy"><strong>Visual detail page limit reached.</strong> ${electricalMapImages!.omittedDetailWindows} additional map windows are represented by the complete overview and ${detailMode === 'by-zone' ? 'the indexed electrical hierarchy table below' : 'the complete electrical hierarchy details below'}. Every electrical node and resolved parent remains listed.</div>`
    : '';
  const zoneModeHierarchyFallback = detailPagesCapped && detailMode === 'by-zone'
    ? `<h3>Indexed electrical hierarchy fallback</h3>${indexedHierarchyFallbackTable(report)}`
    : '';
  const detailTitle = detailMode === 'by-zone'
    ? 'Details by physical zone'
    : 'Details by electrical hierarchy';
  const details = detailMode === 'by-zone'
    ? zoneDetailsHtml(report)
    : `<div class="detail-group"><div class="detail-group-title">Incoming supply to connected loads</div>${hierarchyRows(report) || '<div class="canonical-meta">No resolved electrical hierarchy recorded.</div>'}</div>`;
  return `<div class="canonical-section">
    <div class="section-bar">${report.reportSource === 'canonical-version' ? 'Pinned canonical installation' : 'Current installation diagnostic'}</div>
    <div class="canonical-meta">Report source ${report.reportSource} &middot; ${authorityLabel} &middot; Tree revision ${report.treeRevision} &middot; Ready ${report.readyToComplete ? 'YES' : 'NO'} &middot; ${canonicalVersionMeta}</div>
    ${map}
    ${cappedFallbackNotice}
    ${zoneModeHierarchyFallback}
    <h3>${detailTitle}</h3>
    ${details}
    <h3>Meter and channel schedule</h3>
    <p class="canonical-meta">This index lists every installed meter and channel, its electrical load classification, and each recorded target allocation with its phase mode and status.</p>
    ${meterChannelScheduleHtml(report)}
    ${compactCanonicalAppendices(report)}
  </div>`;
}

function canonicalReportHtml(report: InstallHubCanonicalReport): string {
  const row = (values: unknown[]) => `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`;
  const physicalLocationNames = new Map(
    report.physicalLocations.map((location) => [location.id, location.name]),
  );
  const physicalLocations = report.physicalLocations.length
    ? report.physicalLocations.map((location) => row([
        location.name, location.description ?? '', location.id,
      ])).join('')
    : row(['No physical zones recorded', '', '']);
  const nodes = report.electricalNodes.map((node) => row([
    node.kind,
    node.displayCode ?? '',
    node.name,
    node.physicalLocationId
      ? physicalLocationNames.get(node.physicalLocationId) ?? node.physicalLocationId
      : '',
    node.id,
  ])).join('');
  const edges = report.supplyEdges.map((edge) => row([
    edge.relationship, edge.sourceNodeId, edge.targetNodeId,
  ])).join('');
  const unresolved = report.unresolvedRelationships.length
    ? report.unresolvedRelationships.map((item) => row([
        item.subjectType,
        item.subjectId,
        item.relation,
        item.missingEnd,
        item.knownNodeId ?? '',
        item.reason,
      ])).join('')
    : row(['None', '', '', '', '', 'No unresolved electrical relationships.']);
  const assets = report.assets.map((asset) => row([
    asset.displayCode,
    asset.name,
    asset.typeLabel,
    asset.zoneName,
    compactJson(asset.coverage),
    asset.id,
  ])).join('');
  const metering = report.meteringRows.map((item) => row([
    item.meterDisplayName,
    item.channelOrdinal ?? '',
    item.direction,
    compactJson(item.target),
    item.assignmentId,
  ])).join('');
  const issues = report.readinessIssues.length
    ? report.readinessIssues.map((issue) => row([
        issue.code, issue.entityType, issue.entityId, issue.message,
      ])).join('')
    : row([
        'READY',
        'installation',
        '',
        report.reportSource === 'canonical-version'
          ? 'No blocking readiness issues in the pinned version.'
          : 'No current blocking readiness issues in this live diagnostic projection.',
      ]);
  const virtualMeters = report.virtualMeterDefinitions.length
    ? report.virtualMeterDefinitions.map((definition) => row([
        definition.id,
        definition.parentNodeId,
        definition.totalMeasurementAssignmentId,
        definition.subtractAssignmentIds.join(', '),
        definition.formula,
        definition.formulaVersion,
        definition.allocation,
        definition.coverage.map((asset) => (
          `${asset.displayCode} — ${asset.assetName} (${asset.zoneName})`
        )).join('; '),
      ])).join('')
    : row([
        'None', '', '', '', '', '', '',
        report.reportSource === 'canonical-version'
          ? 'No virtual residual coverage in this pinned version.'
          : 'No virtual residual coverage in the current live projection.',
      ]);
  const canonicalVersionMeta = report.reportSource === 'canonical-version'
    ? `Record version ${report.recordVersionNumber} &middot; Snapshot ${escapeHtml(report.snapshotPayloadHash)} &middot; Mapping ${escapeHtml(report.mappingContentHash)}`
    : 'Live diagnostic projection &middot; Not pinned to a canonical record version or payload hash';
  const authorityLabel = report.authoritative ? 'AUTHORITATIVE' : 'NON-AUTHORITATIVE';
  const sectionTitle = report.reportSource === 'canonical-version'
    ? 'Pinned canonical installation'
    : 'Current installation diagnostic';
  const virtualCaveat = report.reportSource === 'canonical-version'
    ? 'The pinned formula subtracts the listed assignments from the pinned total assignment; changes made after this record version are not included.'
    : 'The live formula uses the current mutable tree and may change after this report is generated.';
  return `<div class="canonical-section">
    <div class="section-bar">${sectionTitle}</div>
    <div class="canonical-meta">Report source ${report.reportSource} &middot; ${authorityLabel} &middot; Tree revision ${report.treeRevision} &middot; Ready ${report.readyToComplete ? 'YES' : 'NO'} &middot; ${canonicalVersionMeta}</div>
    <h3>Physical-zone summary</h3>
    <table class="canonical-table"><thead><tr><th>Zone</th><th>Description</th><th>Stable ID</th></tr></thead><tbody>${physicalLocations}</tbody></table>
    <h3>Electrical hierarchy</h3>
    <table class="canonical-table"><thead><tr><th>Kind</th><th>Display</th><th>Name</th><th>Physical zone</th><th>Stable ID</th></tr></thead><tbody>${nodes}</tbody></table>
    <h3>Supply relationships</h3>
    <table class="canonical-table"><thead><tr><th>Relationship</th><th>Source</th><th>Target</th></tr></thead><tbody>${edges}</tbody></table>
    <h3>Unresolved electrical relationships</h3>
    <table class="canonical-table"><thead><tr><th>Subject</th><th>Stable ID</th><th>Relation</th><th>Missing end</th><th>Known node</th><th>Reason</th></tr></thead><tbody>${unresolved}</tbody></table>
    <h3>All-assets coverage</h3>
    <table class="canonical-table"><thead><tr><th>Display</th><th>Asset</th><th>Type</th><th>Physical zone</th><th>Coverage</th><th>Stable ID</th></tr></thead><tbody>${assets}</tbody></table>
    <h3>Meter and channel schedule</h3>
    ${meterChannelScheduleHtml(report)}
    <h3>Metering assignments</h3>
    <table class="canonical-table"><thead><tr><th>Meter</th><th>Channel</th><th>Direction</th><th>Target</th><th>Assignment ID</th></tr></thead><tbody>${metering}</tbody></table>
    <h3>Virtual-meter definitions</h3>
    <p class="canonical-meta"><strong>UNALLOCATED_RESIDUAL caveat:</strong> each virtual value is a calculated remainder, not a direct meter reading. ${virtualCaveat}</p>
    <table class="canonical-table"><thead><tr><th>Virtual ID</th><th>Parent node</th><th>Total assignment</th><th>Subtract assignments</th><th>Formula</th><th>Version</th><th>Allocation</th><th>Covered assets</th></tr></thead><tbody>${virtualMeters}</tbody></table>
    <h3>Readiness</h3>
    <table class="canonical-table"><thead><tr><th>Code</th><th>Entity</th><th>Stable ID</th><th>Message</th></tr></thead><tbody>${issues}</tbody></table>
  </div>`;
}

export function buildInstallHubReportHtml(input: {
  mode: 'form' | 'installation-pack';
  detailMode?: InstallHubReportDetailMode;
  installation: InstallHubReportInstallation;
  forms: InstallHubReportForm[];
  slices: InstallHubFormReportSlice[];
  resolvedByForm: Map<string, ResolvedInstallHubFormPhoto[]>;
  logoDataUri: string;
  includeIntro: boolean;
  includeEnd: boolean;
  generatedLabel: string;
  summaryPhotoCount?: number;
  canonicalReport?: InstallHubCanonicalReport;
  electricalMapImages?: InstallHubElectricalMapImages;
  /** Compatibility for callers that still provide one overview-only map. */
  electricalMapDataUri?: string;
}): string {
  const formsById = new Map(input.forms.map((form) => [form.id, form]));
  const firstForm = input.forms[0];
  const title =
    input.mode === 'form' && firstForm
      ? definitionFor(firstForm).title
      : `${input.installation.siteName} - Installation Pack`;
  const totalPhotos = [...input.resolvedByForm.values()]
    .reduce((sum, photos) => sum + photos.length, 0);
  const formBlocks = input.slices.map((slice) => {
    const form = formsById.get(slice.formId);
    if (!form) return '';
    const definition = definitionFor(form);
    const allPhotos = input.resolvedByForm.get(form.id) ?? [];
    const selectedPhotos = photosForInstallHubFormSlice(
      form,
      allPhotos,
      slice.sectionIndexes,
    );
    const heading =
      input.mode === 'installation-pack'
        ? `<div class="form-heading">
            <div class="form-heading-title">${escapeHtml(definition.title)}${slice.continuation ? ' - continued' : ''}</div>
            <div class="form-heading-meta">Submission ${escapeHtml(form.id)} &middot; Schema v${form.schemaVersion} &middot; ${escapeHtml(form.status)}</div>
          </div>`
        : slice.continuation
          ? `<div class="form-heading"><div class="form-heading-title">${escapeHtml(definition.shortTitle)} - continued</div></div>`
          : '';
    return `<div class="form-record">${heading}${formSectionsHtml(
      form,
      slice.sectionIndexes,
      selectedPhotos,
    )}</div>`;
  }).join('');

  const intro =
    input.includeIntro
      ? input.mode === 'form' && firstForm
        ? formCoverHtml(firstForm, input.logoDataUri)
        : installationCoverHtml(
            input.installation,
            input.forms.length,
            input.summaryPhotoCount ?? totalPhotos,
            input.logoDataUri,
          )
      : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${reportCss()}</style>
</head>
<body>
  <template data-pdf-header data-brand="INSTALLHUB" data-title="${escapeHtml(title)}"></template>
  <template data-pdf-footer data-left="SUSTAINABILITY WISE" data-right="${escapeHtml(input.generatedLabel)}" data-page-numbers="true"></template>
  <main class="content">
    ${intro}
    ${input.includeIntro && input.canonicalReport
      ? input.mode === 'installation-pack'
        ? installationDetailsHtml(
            input.canonicalReport,
            input.detailMode ?? 'by-electrical-hierarchy',
            input.electricalMapImages ?? (input.electricalMapDataUri
              ? {
                  overviewDataUri: input.electricalMapDataUri,
                  sourceWidth: 0,
                  sourceHeight: 0,
                  overviewWidth: 0,
                  overviewHeight: 0,
                  totalDetailWindows: 0,
                  omittedDetailWindows: 0,
                  detailTiles: [],
                }
              : undefined),
          )
        : canonicalReportHtml(input.canonicalReport)
      : ''}
    ${formBlocks}
    ${input.includeEnd ? `<div class="end-block">Prepared by Sustainability Wise &middot; Field App Complete report manifest v${INSTALLHUB_REPORT_MANIFEST_VERSION}</div>` : ''}
  </main>
</body>
</html>`;
}
