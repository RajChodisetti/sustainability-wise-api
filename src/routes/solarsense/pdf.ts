import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry, pdfJobs } from '../../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { renderPdf } from '../../pdf/renderer.js';
import { mergePdfBuffers } from '../../pdf/merge.js';
import { prepareCompressedPdfPhotos } from '../../pdf/photoCompression.js';
import { publicFileUrl, writeLocalFile } from '../../storage/localFiles.js';
import { mirrorPdfToOneDrive } from '../../onedrive/photoBackup.js';
import { makePdfStorageKeyFromName } from '../../services/storageNaming.js';
import { assertFound, assertSiteAccess } from './helpers.js';
import { markJobRunning, updateJobPhase, completeJob, failJob } from '../../services/pdfJobService.js';

const MAX_PDF_BYTES = 300 * 1024 * 1024;
const LARGE_PDF_PHOTO_COUNT_THRESHOLD = 120;
const LARGE_PDF_RAW_BYTES_THRESHOLD = 120 * 1024 * 1024;
const PDF_INLINE_CHUNK_PHOTO_TARGET = 50;
const brandLogoUrl = new URL('../../pdf/brand-logo.png', import.meta.url);

type SiteRow = typeof ssSites.$inferSelect;
type AssessmentRow = typeof ssRooftopAssessments.$inferSelect;
type PhotoRow = typeof photoRegistry.$inferSelect;

type PhotoMetadata = {
  name?: string;
  largeInPdf?: boolean;
};

type PhotoMetadataValue = string | PhotoMetadata | null | undefined;
type PhotoMetadataMap = Record<string, PhotoMetadataValue>;

type Switchboard = {
  panelNameId?: string | null;
  locationInBuilding?: string | null;
  incomingSupplyVoltage?: string | null;
  mainBreakerRating?: string | null;
  spareBreakers?: string | null;
  photoUri?: string | null;
};

type OtherConsideration = {
  issue?: string | null;
  details?: string | null;
  photoUris?: string[] | null;
};

type AssessmentView = AssessmentRow & {
  switchboards: Switchboard[];
  otherConsiderations: OtherConsideration[];
  additionalPhotos: string[];
  photoMetadata: PhotoMetadataMap;
};

type SitePackOptions = {
  includeRagFramework: boolean;
  includeAppendix: boolean;
};

let brandLogoDataUriPromise: Promise<string> | null = null;

function loadBrandLogo(): Promise<string> {
  brandLogoDataUriPromise ??= readFile(brandLogoUrl).then(
    (buffer) => `data:image/png;base64,${buffer.toString('base64')}`,
  );
  return brandLogoDataUriPromise;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function field(label: string, value: unknown): string {
  if (value == null || value === '') return '';
  return `<div class="field"><div class="fl">${esc(label)}</div><div class="fv">${esc(value)}</div></div>`;
}

function parseDisplayDate(ds: string | Date | null | undefined): Date | null {
  if (!ds) return null;
  if (ds instanceof Date) return Number.isNaN(ds.getTime()) ? null : ds;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds.trim());
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(ds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fmtDate(ds: string | null | undefined): string {
  if (!ds) return '—';
  const d = parseDisplayDate(ds);
  if (!d) return ds;
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

function viabilityBadge(v: string | null | undefined): string {
  if (v === 'Yes') return '<span class="badge badge-green">Viable</span>';
  if (v === 'No') return '<span class="badge badge-red">Excluded</span>';
  if (v === 'TBD') return '<span class="badge badge-tbd">TBD</span>';
  return '';
}

function ragBadge(r: string | null | undefined): string {
  if (r === 'Green') return '<span class="badge badge-green">Green</span>';
  if (r === 'Amber') return '<span class="badge badge-amber">Amber</span>';
  if (r === 'Red') return '<span class="badge badge-red">Red</span>';
  return '';
}

function flag(show: boolean, label: string): string {
  return show ? `<span class="badge badge-flag">&#9888; ${esc(label)}</span>` : '';
}

function chunk2<T>(arr: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += 2) rows.push(arr.slice(i, i + 2));
  return rows;
}

function splitByPhotoTarget<T>(
  items: T[],
  countPhotos: (item: T) => number,
  target = PDF_INLINE_CHUNK_PHOTO_TARGET,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentPhotos = 0;
  for (const item of items) {
    const itemPhotos = Math.max(1, countPhotos(item));
    if (current.length > 0 && currentPhotos + itemPhotos > target) {
      chunks.push(current);
      current = [];
      currentPhotos = 0;
    }
    current.push(item);
    currentPhotos += itemPhotos;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function totalPhotoBytes(photos: PhotoRow[]): number {
  return photos.reduce((sum, photo) => sum + (photo.fileSizeBytes ?? 0), 0);
}

function shouldUsePhotoAppendix(photos: PhotoRow[]): boolean {
  return photos.length > LARGE_PDF_PHOTO_COUNT_THRESHOLD
    || totalPhotoBytes(photos) > LARGE_PDF_RAW_BYTES_THRESHOLD;
}

function normalizePhotoMetadata(value: PhotoMetadataValue): PhotoMetadata {
  if (!value) return {};
  if (typeof value === 'string') {
    return value ? { name: value } : {};
  }
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(value.largeInPdf ? { largeInPdf: true } : {}),
  };
}

function normalizePhotoMetadataMap(value: unknown): PhotoMetadataMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as PhotoMetadataMap;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function asSwitchboards(value: unknown): Switchboard[] {
  return Array.isArray(value) ? (value as Switchboard[]) : [];
}

function asOtherConsiderations(value: unknown): OtherConsideration[] {
  return Array.isArray(value) ? (value as OtherConsideration[]) : [];
}

function normalizeAssessment(assessment: AssessmentRow): AssessmentView {
  return {
    ...assessment,
    switchboards: asSwitchboards(assessment.switchboards),
    otherConsiderations: asOtherConsiderations(assessment.otherConsiderations),
    additionalPhotos: asStringArray(assessment.additionalPhotos),
    photoMetadata: normalizePhotoMetadataMap(assessment.photoMetadata),
  };
}

function photoFieldKey(entityId: string, fieldName: string): string {
  return `${entityId}::${fieldName}`;
}

function buildPhotoMap(photos: PhotoRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const photo of photos) {
    if (!photo.remoteUrl) continue;
    map.set(photoFieldKey(photo.entityId, photo.fieldName), photo.remoteUrl);
  }
  return map;
}

function getPhoto(photoMap: Map<string, string>, entityId: string, fieldName: string): string | null {
  return photoMap.get(photoFieldKey(entityId, fieldName)) ?? null;
}

function photoImg(dataUri: string | null | undefined, caption: string | undefined, large: boolean): string {
  if (!dataUri) return '';
  const cls = large ? 'photo-img-large' : 'photo-img';
  const cap = caption ? `<div class="photo-caption">${esc(caption)}</div>` : '';
  return `<div class="photo-block"><img src="${dataUri}" class="${cls}" onerror="this.parentNode.style.display='none'" />${cap}</div>`;
}

function photoGrid(cells: string[]): string {
  if (!cells.length) return '';
  return `<table class="photo-grid-2">${chunk2(cells).map((row) => `<tr>${row.join('')}</tr>`).join('')}</table>`;
}

function secFields(title: string, rows: string): string {
  const content = rows.trim();
  if (!content) return '';
  return `<div class="sec-bar">${esc(title)}</div><div class="fields">${content}</div>`;
}

function renderSwitchboards(a: AssessmentView, photoMap: Map<string, string>): string {
  if (!a.switchboards.length) return '';
  return '<div class="sec-bar">Switchboards</div>' + a.switchboards.map((sb, i) => {
    const sbDu = getPhoto(photoMap, a.id, `switchboards[${i}].photoUri`);
    const sbMeta = normalizePhotoMetadata(a.photoMetadata[`switchboard.${i}.photo`]);
    return `
    <div class="sb-card">
      <div class="sb-card-title">Switchboard ${i + 1}${sb.panelNameId ? ` &mdash; ${esc(sb.panelNameId)}` : ''}</div>
      ${field('Location', sb.locationInBuilding)}
      ${field('Supply Voltage', sb.incomingSupplyVoltage)}
      ${field('Main Breaker', sb.mainBreakerRating)}
      ${field('Spare Breakers', sb.spareBreakers)}
      ${sbDu ? photoImg(sbDu, sbMeta.name, !!sbMeta.largeInPdf) : ''}
    </div>`;
  }).join('');
}

function renderConsiderations(a: AssessmentView, photoMap: Map<string, string>): string {
  if (!a.otherConsiderations.length) return '';
  const items = a.otherConsiderations.map((oc, i) => {
    const cells: string[] = [];
    const largeBlocks: string[] = [];
    (oc.photoUris ?? []).forEach((_, j) => {
      const du = getPhoto(photoMap, a.id, `other_considerations[${i}].photoUris[${j}]`);
      if (!du) return;
      const meta = normalizePhotoMetadata(a.photoMetadata[`consideration.${i}.${j}`]);
      if (meta.largeInPdf) largeBlocks.push(photoImg(du, meta.name, true));
      else cells.push(`<td class="photo-cell">${photoImg(du, meta.name, false)}</td>`);
    });
    return `<div class="consideration">
      ${oc.issue ? `<div class="consideration-issue">${esc(oc.issue)}</div>` : ''}
      ${oc.details ? `<div class="consideration-details">${esc(oc.details)}</div>` : ''}
      ${largeBlocks.join('')}
      ${photoGrid(cells)}
    </div>`;
  }).join('');
  return `<div class="sec-bar">Other Considerations</div>${items}`;
}

function renderBuilding(a: AssessmentView, idx: number, photoMap: Map<string, string>): string {
  const aerialDu = getPhoto(photoMap, a.id, 'aerial_photo_uri');
  const aerialMeta = normalizePhotoMetadata(a.photoMetadata.aerialPhoto);
  const msbDu = getPhoto(photoMap, a.id, 'msb_photo_uri');
  const msbMeta = normalizePhotoMetadata(a.photoMetadata.msbPhoto);

  const aerialHtml = aerialDu ? photoImg(aerialDu, aerialMeta.name, !!aerialMeta.largeInPdf) : '';
  const msbHtml = msbDu
    ? `<div class="sec-bar">Switchboard Photo</div>${photoImg(msbDu, msbMeta.name, !!msbMeta.largeInPdf)}`
    : '';

  const addlCells: string[] = [];
  const addlLargeBlocks: string[] = [];
  a.additionalPhotos.forEach((_, i) => {
    const du = getPhoto(photoMap, a.id, `additional_photos[${i}]`);
    if (!du) return;
    const meta = normalizePhotoMetadata(a.photoMetadata[`additionalPhoto.${i}`]);
    if (meta.largeInPdf) addlLargeBlocks.push(photoImg(du, meta.name, true));
    else addlCells.push(`<td class="photo-cell">${photoImg(du, meta.name, false)}</td>`);
  });
  const addlHtml = addlCells.length || addlLargeBlocks.length
    ? `<div class="sec-bar">Additional Photos</div>${addlLargeBlocks.join('')}${photoGrid(addlCells)}`
    : '';

  return `
  <div class="building">
    <div class="building-hdr">
      <div class="building-num">Building ${idx + 1}</div>
      <div class="building-name">${esc(a.buildingIdName)}</div>
      <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">
        ${viabilityBadge(a.viabilityStatus)}
        ${ragBadge(a.ragPriority)}
        ${flag(a.asbestosFlag, 'Asbestos')}
        ${flag(a.heritageDealBreaker, 'Heritage')}
        ${flag(a.structuralRiskFlag, 'Structural')}
      </div>
    </div>
    <div class="building-body">
      <table class="b-metrics"><tr>
        <td class="b-metric"><span class="b-metric-val">${a.roofAreaTotalM2 != null ? a.roofAreaTotalM2.toLocaleString() : '—'}</span><span class="b-metric-lbl">Roof m²</span></td>
        <td class="b-metric"><span class="b-metric-val">${a.roofAreaUsableM2 != null ? a.roofAreaUsableM2.toLocaleString() : '—'}</span><span class="b-metric-lbl">Usable m²</span></td>
        <td class="b-metric"><span class="b-metric-val">${a.pvSizeKwDc != null ? a.pvSizeKwDc.toFixed(1) : '—'}</span><span class="b-metric-lbl">kW DC</span></td>
        <td class="b-metric"><span class="b-metric-val">${a.acExportKw != null ? a.acExportKw.toFixed(1) : '—'}</span><span class="b-metric-lbl">kW AC</span></td>
      </tr></table>

      ${aerialHtml}

      ${secFields('Roof Characteristics', [
        field('Material', a.roofMaterial),
        field('Construction Material', a.roofConstructionMaterial),
        field('Framing Type', a.roofFramingType),
        field('Pitch Angle', a.roofPitchAngle),
        field('Condition', a.roofCondition),
        field('Estimated Age', a.roofEstimatedAge),
        field('Primary Orientation', a.roofOrientationPrimary),
        field('Shading Sources', a.roofShadingSources),
        field('Shading % Affected', a.roofShadingUsablePct),
        field('Orientation & Shading Notes', a.roofOrientationShading),
        field('Structural Feasibility', a.structuralFeasibility),
        field('Access & Safety', a.accessSafetyConstraints),
        field('Heritage Status', a.heritageStatus),
      ].join(''))}

      ${secFields('PV Sizing', [
        field('Indicative PV Size (kW DC)', a.pvSizeKwDc != null ? `${a.pvSizeKwDc.toFixed(1)} kW` : null),
        field('AC Export Capacity (kW AC)', a.acExportKw != null ? `${a.acExportKw.toFixed(1)} kW` : null),
      ].join(''))}

      ${secFields('Electrical & Network', [
        field('Existing Generation', a.existingGeneration),
        field('Distance to Connection', a.distanceToConnectionM != null ? `${a.distanceToConnectionM} m` : null),
        field('Electrical Pits & Entry', a.electricalPitsEntry),
        field('Inverter Siting', a.inverterSiting),
        field('Transformer / Supply Capacity', a.transformerSupplyCapacity),
        field('DNSP Constraints', a.dnspConstraints),
        field('Load Profile / Metering', a.loadProfileMetering),
      ].join(''))}

      ${renderSwitchboards(a, photoMap)}
      ${msbHtml}
      ${renderConsiderations(a, photoMap)}

      ${secFields('Viability & Assessment', [
        field('Site Representative Feedback', a.siteRepFeedback),
        field('Deal-Breaker Reason', a.dealBreakerReason),
        field('Key Assumptions & Data Gaps', a.keyAssumptionsGaps),
      ].join(''))}

      ${addlHtml}
    </div>
  </div>`;
}

const RAG_FRAMEWORK = `
<div style="page-break-before:always">
  <div class="sec-bar">RAG Priority Framework</div>
  <div class="fields">
    <div class="field">
      <div class="fl"><span class="badge badge-green">Green</span></div>
      <div class="fv">High viability. Strong roof structural condition, clear north-facing orientation (±45°), minimal shading, adequate electrical infrastructure, high kW AC potential. Recommended for immediate feasibility advancement.</div>
    </div>
    <div class="field">
      <div class="fl"><span class="badge badge-amber">Amber</span></div>
      <div class="fv">Moderate viability. One or more constraints present — suboptimal orientation, partial shading, ageing roof, switchboard upgrades required. Warrants further investigation before commitment.</div>
    </div>
    <div class="field">
      <div class="fl"><span class="badge badge-red">Red</span></div>
      <div class="fv">Low viability. Significant constraints identified: poor roof condition, major structural concerns, high shading, restricted access, or prohibitive DNSP constraints. Not recommended without major remediation works.</div>
    </div>
  </div>
</div>`;

async function buildHtml(args: {
  site: SiteRow;
  assessments: AssessmentRow[];
  photos: PhotoRow[];
  options: SitePackOptions;
}, renderOptions: { includeIntro?: boolean; includeEnd?: boolean } = {}): Promise<string> {
  const assessments = args.assessments.map(normalizeAssessment);
  const viable = assessments.filter((a) => a.viabilityStatus === 'Yes');
  const totalAcKw = viable.reduce((sum, a) => sum + (a.acExportKw ?? 0), 0);
  const ragCounts = viable.reduce(
    (counts, assessment) => {
      if (assessment.ragPriority === 'Green') counts.G += 1;
      else if (assessment.ragPriority === 'Amber') counts.A += 1;
      else if (assessment.ragPriority === 'Red') counts.R += 1;
      return counts;
    },
    { G: 0, A: 0, R: 0 },
  );
  const brandLogo = await loadBrandLogo();
  const photoMap = buildPhotoMap(args.photos);

  const viableRows = viable.length
    ? viable.map((a) => `<tr>
        <td>${esc(a.buildingIdName)}</td>
        <td>${a.pvSizeKwDc != null ? `${a.pvSizeKwDc.toFixed(1)} kW` : '—'}</td>
        <td>${a.acExportKw != null ? `${a.acExportKw.toFixed(1)} kW` : '—'}</td>
        <td>${ragBadge(a.ragPriority)}</td>
        <td>${esc(a.roofCondition || '—')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="color:#94A3B8;text-align:center;padding:12px">No viable buildings assessed.</td></tr>';

  const classTag = args.site.documentClassification
    ? `<span class="cover-class">${esc(args.site.documentClassification)}</span>`
    : '';

  const buildingsHtml = assessments.map((assessment, index) => renderBuilding(assessment, index, photoMap)).join('');

  const appendixHtml = args.options.includeAppendix ? secFields('Appendix', [
    field('Electrical Infrastructure Summary', args.site.electricalInfrastructureSummary),
    field('Known Site Constraints', args.site.knownConstraints),
    field('Load Profile / Metering Summary', args.site.loadProfileMeteringSummary),
    field('PPA Asset Demarcation', args.site.ppaAssetDemarcation),
    field('Appendix Notes', args.site.appendixNotes),
  ].join('')) : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #0F172A; font-size: 10pt; margin: 0; line-height: 1.45; }

  /* Cover */
  .cover { background: #142F70; border-top: 5px solid #0B3F59; border-radius: 8px; padding: 22px 24px 20px; margin-bottom: 18px; }
  .cover-eyebrow { color: #DBEAFE; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 8px; }
  .cover-title { color: #FFFFFF; font-size: 19pt; font-weight: 900; margin-bottom: 14px; }
  .cover-brand { margin: 10px 0 14px; }
  .cover-brand-label { font-size: 7pt; font-weight: 800; color: #BFDBFE; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 5px; }
  .cover-brand-logo { display: block; width: 162px; height: auto; background: #FFFFFF; border-radius: 6px; padding: 5px 9px; }
  .cover-meta { display: table; width: 100%; border-radius: 6px; border-collapse: collapse; overflow: hidden; }
  .cover-meta-row { display: table-row; }
  .cm { display: table-cell; padding: 11px 14px; background: #FFFFFF; border: 1px solid #BFDBFE; width: 50%; }
  .cml { font-size: 7pt; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
  .cmv { font-size: 10.5pt; font-weight: 600; color: #0F172A; }
  .cover-class { display: inline-block; margin-top: 12px; padding: 4px 12px; border: 1.5px solid #D97706; border-radius: 4px; background: #FEF3C7; color: #92400E; font-size: 8pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }

  /* Stats row */
  .stats { display: table; width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .stat { display: table-cell; text-align: center; padding: 10px 6px; border: 1px solid #DBEAFE; background: #EFF6FF; border-top: 3px solid #1E3A8A; }
  .stat-val { font-size: 15pt; font-weight: 900; color: #1E3A8A; display: block; }
  .stat-lbl { font-size: 7pt; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.06em; }

  /* Sections */
  .sec-bar { background: #1E3A8A; color: #FFFFFF; font-size: 8.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding: 7px 12px; margin-top: 14px; page-break-after: avoid; }
  .fields { border: 1px solid #DBEAFE; border-top: none; margin-bottom: 4px; }
  .field { display: table; width: 100%; border-top: 1px solid #DBEAFE; page-break-inside: avoid; }
  .fl { display: table-cell; width: 36%; padding: 6px 10px 6px 12px; color: #64748B; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; vertical-align: top; }
  .fv { display: table-cell; padding: 6px 12px 6px 0; font-size: 9pt; white-space: pre-wrap; line-height: 1.5; vertical-align: top; }

  /* Badges */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8pt; font-weight: 800; border: 1.5px solid; }
  .badge-green { background: #DCFCE7; color: #166534; border-color: #86EFAC; }
  .badge-amber { background: #FEF9C3; color: #854D0E; border-color: #FDE047; }
  .badge-red { background: #FEE2E2; color: #991B1B; border-color: #FCA5A5; }
  .badge-tbd { background: #EFF6FF; color: #1D4ED8; border-color: #BFDBFE; }
  .badge-flag { background: #FEE2E2; color: #991B1B; border-color: #FCA5A5; }

  /* Buildings */
  .building { border: 1.5px solid #DBEAFE; border-left: 3px solid #1E3A8A; border-radius: 8px; margin-bottom: 16px; page-break-inside: avoid; overflow: hidden; }
  .building-hdr { background: #1E3A8A; color: #FFFFFF; padding: 10px 14px; }
  .building-num { font-size: 7.5pt; font-weight: 700; color: #93C5FD; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2px; }
  .building-name { font-size: 12.5pt; font-weight: 900; }
  .building-body { padding: 12px 14px 6px; }
  .b-metrics { display: table; width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .b-metric { display: table-cell; text-align: center; padding: 8px 4px; border: 1px solid #DBEAFE; background: #EFF6FF; }
  .b-metric-val { font-size: 11pt; font-weight: 900; color: #1E3A8A; display: block; }
  .b-metric-lbl { font-size: 6.5pt; font-weight: 700; color: #94A3B8; text-transform: uppercase; }

  /* Photos */
  .photo-block { margin: 8px 0; page-break-inside: avoid; }
  .photo-img-large { width: 100%; max-height: 260px; object-fit: cover; border-radius: 8px; border: 1px solid #DBEAFE; }
  .photo-img { max-width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; border: 1px solid #DBEAFE; }
  .photo-caption { color: #64748B; font-size: 8pt; margin-top: 4px; }
  .photo-grid-2 { display: table; width: 100%; border-collapse: separate; border-spacing: 8px; }
  .photo-cell { display: table-cell; width: 50%; vertical-align: top; text-align: center; page-break-inside: avoid; }

  /* Switchboard */
  .sb-card { border: 1px solid #DBEAFE; border-left: 3px solid #1E3A8A; border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; background: #EFF6FF; }
  .sb-card-title { font-size: 8pt; font-weight: 800; color: #1E3A8A; margin-bottom: 4px; }

  /* Consideration */
  .consideration { border-left: 3px solid #93C5FD; padding: 6px 10px; margin: 6px 0 10px; }
  .consideration-issue { font-size: 10pt; font-weight: 800; color: #1E3A8A; margin-bottom: 4px; }
  .consideration-details { font-size: 9pt; color: #374151; white-space: pre-wrap; margin-bottom: 6px; }

  /* Summary table */
  .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 9pt; }
  .summary-table th { background: #1E3A8A; color: #FFFFFF; padding: 7px 10px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .summary-table td { padding: 7px 10px; border-bottom: 1px solid #DBEAFE; vertical-align: middle; }
  .summary-table tr:nth-child(even) td { background: #F8FAFC; }

  /* Footer */
  .footer-note { color: #94A3B8; font-size: 7pt; text-align: center; margin-top: 20px; border-top: 1.5px solid #93C5FD; padding-top: 8px; }
</style>
</head>
<body>

${renderOptions.includeIntro === false ? '' : `
<div class="cover">
  <div class="cover-eyebrow">Rooftop Solar &nbsp;&middot;&nbsp; Site Information Pack &nbsp;&middot;&nbsp; SolarSense</div>
  <div class="cover-title">SolarSense</div>
  <div class="cover-brand">
    <div class="cover-brand-label">Prepared by</div>
    <img class="cover-brand-logo" src="${brandLogo}" alt="Sustainability Wise" />
  </div>
  <div class="cover-meta">
    <div class="cover-meta-row">
      <div class="cm"><div class="cml">Site Name</div><div class="cmv">${esc(args.site.siteName)}</div></div>
      <div class="cm"><div class="cml">Location</div><div class="cmv">${esc(args.site.location || '—')}</div></div>
    </div>
    <div class="cover-meta-row">
      <div class="cm"><div class="cml">Date of Assessment</div><div class="cmv">${fmtDate(args.site.dateOfAssessment)}</div></div>
      <div class="cm"><div class="cml">Buildings Assessed</div><div class="cmv">${assessments.length}</div></div>
    </div>
    <div class="cover-meta-row">
      <div class="cm"><div class="cml">Viable Buildings</div><div class="cmv">${viable.length}</div></div>
      <div class="cm"><div class="cml">Total AC Capacity</div><div class="cmv">${totalAcKw >= 1000 ? `${(totalAcKw / 1000).toFixed(2)} MW` : `${totalAcKw.toFixed(1)} kW`}</div></div>
    </div>
  </div>
  ${classTag}
</div>

<table class="stats">
  <tr>
    <td class="stat"><span class="stat-val">${assessments.length}</span><span class="stat-lbl">Buildings</span></td>
    <td class="stat"><span class="stat-val">${viable.length}</span><span class="stat-lbl">Viable</span></td>
    <td class="stat"><span class="stat-val">${(totalAcKw / 1000).toFixed(2)}</span><span class="stat-lbl">AC MW</span></td>
    <td class="stat"><span class="stat-val">${ragCounts.G}</span><span class="stat-lbl">Green</span></td>
    <td class="stat"><span class="stat-val">${ragCounts.A}</span><span class="stat-lbl">Amber</span></td>
    <td class="stat"><span class="stat-val">${ragCounts.R}</span><span class="stat-lbl">Red</span></td>
  </tr>
</table>

${secFields('Site Context', [
  field('Document Classification', args.site.documentClassification),
  field('Date of Assessment', args.site.dateOfAssessment),
  field('Location', args.site.location),
].join(''))}

${viable.length ? `
<div class="sec-bar">Viable Buildings Summary</div>
<table class="summary-table">
  <thead><tr><th>Building</th><th>kW DC</th><th>kW AC</th><th>RAG</th><th>Roof Condition</th></tr></thead>
  <tbody>${viableRows}</tbody>
</table>` : ''}
`}

<div class="sec-bar">Building Assessments</div>
${buildingsHtml}

${renderOptions.includeEnd === false ? '' : `
${args.options.includeRagFramework ? RAG_FRAMEWORK : ''}

${appendixHtml}

<div class="footer-note">
  Generated by SolarSense &nbsp;&middot;&nbsp; ${new Date().toLocaleDateString('en-AU')}
</div>
`}
</body>
</html>`;
}

async function renderSolarSensePdf(args: {
  site: SiteRow;
  assessments: AssessmentRow[];
  photos: PhotoRow[];
  options: SitePackOptions;
}): Promise<Buffer> {
  if (!shouldUsePhotoAppendix(args.photos)) {
    const compressedPhotos = await prepareCompressedPdfPhotos(args.photos);
    return renderPdf(await buildHtml({
      site: args.site,
      assessments: args.assessments,
      photos: compressedPhotos,
      options: args.options,
    }));
  }

  console.info('[pdf] Using chunked SolarSense inline render', {
    siteId: args.site.id,
    photoCount: args.photos.length,
    rawBytes: totalPhotoBytes(args.photos),
    chunkSize: PDF_INLINE_CHUNK_PHOTO_TARGET,
  });

  const assessmentChunks = splitByPhotoTarget(args.assessments, (assessment) =>
    args.photos.filter((photo) => photo.entityId === assessment.id && photo.remoteUrl).length,
  );
  const chunks = assessmentChunks.length > 0 ? assessmentChunks : [args.assessments];
  const pdfParts: Buffer[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const assessmentIds = new Set(chunks[index].map((assessment) => assessment.id));
    const chunkPhotos = args.photos.filter((photo) => assessmentIds.has(photo.entityId));
    const compressedPhotos = await prepareCompressedPdfPhotos(chunkPhotos);
    pdfParts.push(await renderPdf(await buildHtml({
      site: args.site,
      assessments: chunks[index],
      photos: compressedPhotos,
      options: args.options,
    }, {
      includeIntro: index === 0,
      includeEnd: index === chunks.length - 1,
    })));
  }

  return mergePdfBuffers(pdfParts);
}

// ── Async job runner ──────────────────────────────────────────────────────────────
export async function runSolarSensePdfJob(
  siteId: string,
  assessmentIds: string[],
  options: SitePackOptions,
  onPhase?: (phase: string) => void | Promise<void>,
): Promise<{ storageKey: string; remoteUrl: string }> {
  await onPhase?.('Fetching site data…');

  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  if (!site) throw new Error('Site not found');

  const assessmentConditions: ReturnType<typeof eq>[] = [
    eq(ssRooftopAssessments.siteId, siteId),
    isNull(ssRooftopAssessments.deletedAt),
  ];
  if (assessmentIds.length > 0) {
    assessmentConditions.push(inArray(ssRooftopAssessments.id, assessmentIds));
  }
  const assessments = await db
    .select()
    .from(ssRooftopAssessments)
    .where(and(...assessmentConditions))
    .orderBy(asc(ssRooftopAssessments.createdAt));

  const photos = await db
    .select()
    .from(photoRegistry)
    .where(and(
      eq(photoRegistry.app, 'solarsense'),
      eq(photoRegistry.parentId, siteId),
      eq(photoRegistry.status, 'confirmed'),
    ));
  const selectedPhotoEntityIds = new Set([siteId, ...assessments.map((a) => a.id)]);
  const scopedPhotos = photos.filter((p) => selectedPhotoEntityIds.has(p.entityId));

  await onPhase?.(`Rendering PDF (${scopedPhotos.length} photo${scopedPhotos.length !== 1 ? 's' : ''})…`);

  const pdf = await renderSolarSensePdf({ site, assessments, photos: scopedPhotos, options });

  if (pdf.byteLength > MAX_PDF_BYTES) {
    console.warn('[pdf] SolarSense PDF exceeded preferred size limit; saving generated PDF anyway', {
      siteId,
      actualSizeBytes: pdf.byteLength,
      preferredMaxSizeBytes: MAX_PDF_BYTES,
    });
  }

  await onPhase?.('Saving PDF…');

  const storageKey = makePdfStorageKeyFromName({
    app: 'solarsense',
    parentName: site.siteName,
    fieldName: 'site-pack-pdf',
    sessionId: randomUUID(),
    filename: 'site-pack.pdf',
  });
  await writeLocalFile(storageKey, pdf);
  const remoteUrl = publicFileUrl(storageKey);
  await mirrorPdfToOneDrive({
    app: 'solarsense',
    parentId: siteId,
    filename: storageKey.split('/').pop() ?? 'site-pack.pdf',
    storageKey,
    body: pdf,
  });

  await db
    .update(ssSites)
    .set({ reportPdfLocalPath: storageKey, reportPdfRemoteUrl: remoteUrl, updatedAt: new Date() })
    .where(eq(ssSites.id, siteId));

  return { storageKey, remoteUrl };
}

async function runSolarSensePdfJobInBackground(
  jobId: string,
  siteId: string,
  assessmentIds: string[],
  options: SitePackOptions,
): Promise<void> {
  try {
    await markJobRunning(jobId, 'Starting…');
    const { storageKey, remoteUrl } = await runSolarSensePdfJob(
      siteId,
      assessmentIds,
      options,
      (phase) => updateJobPhase(jobId, phase),
    );
    await completeJob(jobId, remoteUrl, storageKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(jobId, message);
    console.error('[pdf-job] SolarSense job failed', { jobId, siteId, error: message });
  }
}

export async function solarsensePdfRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sites/:siteId/site-pack/pdf/jobs', {
    schema: {
      tags: ['SolarSense PDF'],
      summary: 'Start an async SolarSense site pack PDF generation job',
      description: 'Queues a background PDF generation job and returns a jobId immediately. Poll GET /v1/pdf/jobs/:jobId for progress.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['siteId'],
        properties: { siteId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          assessmentIds: { type: 'array', items: { type: 'string' } },
          options: { type: 'object', additionalProperties: true },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: { jobId: { type: 'string' } },
        },
      },
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const body = (request.body as {
      assessmentIds?: string[];
      options?: Record<string, unknown>;
    }) ?? {};

    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
    const foundSite = assertFound(site, 'Site');
    assertSiteAccess(foundSite, request.user);

    const assessmentIds = Array.isArray(body.assessmentIds) ? body.assessmentIds.filter(Boolean) : [];
    const rawOptions = (body.options && typeof body.options === 'object' ? body.options : {}) as Record<string, unknown>;
    const options: SitePackOptions = {
      includeRagFramework: rawOptions.includeRagFramework !== false,
      includeAppendix: rawOptions.includeAppendix !== false,
    };

    const jobId = randomUUID();
    await db.insert(pdfJobs).values({
      id: jobId,
      app: 'solarsense',
      entityId: siteId,
      entityType: 'site',
      userId: request.user.userId,
      params: { assessmentIds, options } as Record<string, unknown>,
      status: 'queued',
      phase: 'Queued…',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    setImmediate(() => { void runSolarSensePdfJobInBackground(jobId, siteId, assessmentIds, options); });

    return reply.status(202).send({ jobId });
  });

  app.post('/sites/:siteId/site-pack/pdf', {
    schema: {
      tags: ['SolarSense PDF'],
      summary: 'Generate a SolarSense site pack PDF',
      description: 'Builds a server-side PDF from the selected site and rooftop assessments, stores it in the configured storage backend, and streams the PDF back to the caller.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['siteId'],
        properties: { siteId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          assessmentIds: { type: 'array', items: { type: 'string' } },
          options: { type: 'object', additionalProperties: true },
        },
      },
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const body = (request.body as {
      assessmentIds?: string[];
      options?: Record<string, unknown>;
    }) ?? {};

    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
    const foundSite = assertFound(site, 'Site');
    assertSiteAccess(foundSite, request.user);

    const assessmentConditions = [
      eq(ssRooftopAssessments.siteId, siteId),
      isNull(ssRooftopAssessments.deletedAt),
    ];
    if (Array.isArray(body.assessmentIds) && body.assessmentIds.length > 0) {
      assessmentConditions.push(inArray(ssRooftopAssessments.id, body.assessmentIds));
    }

    const assessments = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(...assessmentConditions))
      .orderBy(asc(ssRooftopAssessments.createdAt));

    const photos = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.parentId, siteId),
        eq(photoRegistry.status, 'confirmed'),
      ));
    const selectedPhotoEntityIds = new Set([
      siteId,
      ...assessments.map((assessment) => assessment.id),
    ]);
    const scopedPhotos = photos.filter((photo) => selectedPhotoEntityIds.has(photo.entityId));

    const rawOptions = (body.options && typeof body.options === 'object' ? body.options : {}) as Record<string, unknown>;
    const options: SitePackOptions = {
      includeRagFramework: rawOptions.includeRagFramework !== false,
      includeAppendix: rawOptions.includeAppendix !== false,
    };

    const pdf = await renderSolarSensePdf({
      site: foundSite,
      assessments,
      photos: scopedPhotos,
      options,
    });
    if (pdf.byteLength > MAX_PDF_BYTES) {
      console.warn('[pdf] SolarSense PDF exceeded preferred size limit; returning generated PDF anyway', {
        siteId,
        actualSizeBytes: pdf.byteLength,
        preferredMaxSizeBytes: MAX_PDF_BYTES,
      });
    }

    const storageKey = makePdfStorageKeyFromName({
      app: 'solarsense',
      parentName: foundSite.siteName,
      fieldName: 'site-pack-pdf',
      sessionId: randomUUID(),
      filename: 'site-pack.pdf',
    });
    await writeLocalFile(storageKey, pdf);
    const remoteUrl = publicFileUrl(storageKey);
    await mirrorPdfToOneDrive({
      app: 'solarsense',
      parentId: siteId,
      filename: storageKey.split('/').pop() ?? 'site-pack.pdf',
      storageKey,
      body: pdf,
      logger: request.log,
    });

    await db
      .update(ssSites)
      .set({
        reportPdfLocalPath: storageKey,
        reportPdfRemoteUrl: remoteUrl,
        updatedAt: new Date(),
      })
      .where(eq(ssSites.id, siteId));

    return reply
      .header('Content-Disposition', `attachment; filename="solarsense-${siteId}-site-pack.pdf"`)
      .header('Content-Length', String(pdf.byteLength))
      .type('application/pdf')
      .send(pdf);
  });
}
