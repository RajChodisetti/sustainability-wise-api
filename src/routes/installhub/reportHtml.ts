import {
  INSTALLHUB_REPORT_DEFINITION_BY_TYPE,
  INSTALLHUB_REPORT_MANIFEST_VERSION,
  isReportItemVisible,
  type InstallHubReportDefinition,
  type InstallHubReportFormType,
} from './reportManifest.js';

export const INSTALLHUB_LARGE_REPORT_PHOTO_COUNT = 120;
export const INSTALLHUB_LARGE_REPORT_RAW_BYTES = 120 * 1024 * 1024;
export const INSTALLHUB_REPORT_CHUNK_PHOTO_TARGET = 50;

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
    physicalLocationId?: string;
  }>;
  supplyEdges: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    relationship: string;
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
    meterDisplayName: string;
    channelOrdinal: number | null;
    target: unknown;
    direction: string;
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
.canonical-meta{padding:8px 10px;background:#F8FAFC;border:1px solid #CBD5E1;font-size:7.5pt;overflow-wrap:anywhere;}
`;
}

function compactJson(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${key}: ${String(source[key])}`).join(', ')}}`;
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
    ${input.includeIntro && input.canonicalReport ? canonicalReportHtml(input.canonicalReport) : ''}
    ${formBlocks}
    ${input.includeEnd ? `<div class="end-block">Prepared by Sustainability Wise &middot; Field App Complete report manifest v${INSTALLHUB_REPORT_MANIFEST_VERSION}</div>` : ''}
  </main>
</body>
</html>`;
}
