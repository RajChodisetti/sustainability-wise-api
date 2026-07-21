import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry, pdfJobs } from '../../db/schema/shared.js';
import {
  completeJob,
  failJob,
  findActiveExportJob,
  markJobRunning,
  updateJobPhase,
  type ExportJobParams,
} from '../../services/pdfJobService.js';
import { enqueueExportTask } from '../../services/exportJobQueue.js';
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
} from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { renderPdf } from '../../pdf/renderer.js';
import { renderPdfEquipmentIcon } from '../../pdf/equipmentIcons.js';
import { mergePdfBuffers } from '../../pdf/merge.js';
import { prepareCompressedPdfPhotos } from '../../pdf/photoCompression.js';
import { publicFileUrl, sanitizeStorageSegment, writeLocalFile } from '../../storage/localFiles.js';
import { mirrorPdfToOneDrive } from '../../onedrive/photoBackup.js';
import { makePdfStorageKeyFromName } from '../../services/storageNaming.js';
import { assertAuditAccess, assertFound } from './helpers.js';
import {
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import { canonicalEcoAuditPhotoFieldName } from './lightingPhotoField.js';

const MAX_PDF_BYTES = 300 * 1024 * 1024;
const LARGE_PDF_PHOTO_COUNT_THRESHOLD = 120;
const LARGE_PDF_RAW_BYTES_THRESHOLD = 120 * 1024 * 1024;
const PDF_INLINE_CHUNK_PHOTO_TARGET = 50;
const brandLogoUrl = new URL('../../pdf/brand-logo.png', import.meta.url);

type EquipmentItem = {
  id: string;
  zoneId: string;
  auditId: string;
  [key: string]: unknown;
};

type PhotoRow = typeof photoRegistry.$inferSelect;
type PhotoEntry = { src: string; label: string; largeInPdf: boolean };
type PhotoMetadata = { name?: string; largeInPdf?: boolean };
type PhotoMetadataValue = string | PhotoMetadata | null | undefined;
type PhotoMetadataMap = Record<string, PhotoMetadataValue>;

// ── Brand logo (cached after first load) ─────────────────────────────────────────
let _brandLogoDataUri: string | null = null;
async function loadBrandLogo(): Promise<string> {
  if (!_brandLogoDataUri) {
    const buf = await readFile(brandLogoUrl);
    _brandLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
  }
  return _brandLogoDataUri;
}

// ── Photo registry → PhotoEntry ───────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
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

function normalizePhotoMetadata(value: PhotoMetadataValue): PhotoMetadata {
  if (!value) return {};
  if (typeof value === 'string') return value ? { name: value } : {};
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(value.largeInPdf ? { largeInPdf: true } : {}),
  };
}

function normalizePhotoMetadataMap(value: unknown): PhotoMetadataMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PhotoMetadataMap
    : {};
}

function photoMetadataKey(fieldName: string | null): string {
  if (!fieldName) return '';
  const arrayMatch = /^([A-Za-z][A-Za-z0-9_]*?)(?:\[(\d+)\]|_(\d+)|\.(\d+))$/.exec(fieldName);
  if (arrayMatch) {
    return `${canonicalEcoAuditPhotoFieldName(arrayMatch[1])}.${arrayMatch[2] ?? arrayMatch[3] ?? arrayMatch[4]}`;
  }
  return canonicalEcoAuditPhotoFieldName(fieldName);
}

function photosForEntity(photos: PhotoRow[], entityId: string, metadata?: unknown): PhotoEntry[] {
  const photoMetadata = normalizePhotoMetadataMap(metadata);
  return photos
    .filter((p) => p.entityId === entityId && p.remoteUrl)
    .map((p) => {
      const metadataKey = photoMetadataKey(p.fieldName);
      const baseFieldName = metadataKey.replace(/\.\d+$/, '');
      const defaultLabel = FIELD_LABELS[baseFieldName] ?? (p.originalFilename ?? p.fieldName ?? 'Photo');
      const meta = normalizePhotoMetadata(photoMetadata[metadataKey]);
      return {
        src: p.remoteUrl!,
        label: meta.name?.trim() || defaultLabel,
        largeInPdf: meta.largeInPdf === true,
      };
    });
}

function totalPhotoBytes(photos: PhotoRow[]): number {
  return photos.reduce((sum, photo) => sum + (photo.fileSizeBytes ?? 0), 0);
}

function shouldUsePhotoAppendix(photos: PhotoRow[]): boolean {
  return photos.length > LARGE_PDF_PHOTO_COUNT_THRESHOLD
    || totalPhotoBytes(photos) > LARGE_PDF_RAW_BYTES_THRESHOLD;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────────
function esc(v: string | null | undefined): string {
  if (!v) return '';
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatText(text: string | null | undefined): string {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (!inList) { html += '<ul class="fmt-list">'; inList = true; }
      html += `<li>${esc(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (html && !html.endsWith('>')) html += '<br />';
      html += esc(line);
    }
  }
  if (inList) html += '</ul>';
  return html;
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

function fmtDate(ds: string | Date | null | undefined): string {
  if (!ds) return '—';
  const d = parseDisplayDate(ds);
  if (!d) return String(ds);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function gallery(photos: PhotoEntry[], title = 'Photographic Evidence', count = photos.length, className = '', colsOverride?: number): string {
  if (photos.length === 0) return '';
  const cols = colsOverride ?? (photos.length <= 2 ? 2 : 3);
  const rows: PhotoEntry[][] = [];
  for (let i = 0; i < photos.length; i += cols) rows.push(photos.slice(i, i + cols));
  const cells = (row: PhotoEntry[]) =>
    row.map((p) => `<div class="photo-cell"><img src="${p.src}" alt="" class="photo-img" onerror="this.parentNode.style.display='none'" /><div class="photo-lbl">${esc(p.label)}</div></div>`).join('')
    + Array.from({ length: cols - row.length }, () => '<div class="photo-cell photo-empty"></div>').join('');
  return `<div class="photos photos-cols-${cols}${className ? ` ${className}` : ''}">
    <div class="photos-title"><span>${title}</span><b>${count}</b></div>
    <div class="photo-grid">${rows.map((r) => `<div class="photo-row-pair">${cells(r)}</div>`).join('')}</div>
  </div>`;
}

function largePhotoBlock(photo: PhotoEntry, title: string, count: number, showTitle: boolean): string {
  return `<div class="photos photos-large">
    ${showTitle ? `<div class="photos-title"><span>${title}</span><b>${count}</b></div>` : ''}
    <div class="photo-large-cell">
      <img src="${photo.src}" alt="" class="photo-large-img" onerror="this.parentNode.style.display='none'" />
      <div class="photo-lbl photo-large-lbl">${esc(photo.label)}</div>
    </div>
  </div>`;
}

function renderPhotoBlocks(photos: PhotoEntry[], title = 'Photographic Evidence', count = photos.length, className = ''): string {
  if (photos.length === 0) return '';
  let html = '';
  let compact: PhotoEntry[] = [];
  let titleShown = false;
  const flushCompact = () => {
    if (!compact.length) return;
    html += gallery(compact, titleShown ? 'Additional Photos' : title, count, className || (titleShown ? 'photos-more' : 'photos-lead'));
    titleShown = true;
    compact = [];
  };
  photos.forEach((photo) => {
    if (photo.largeInPdf) { flushCompact(); html += largePhotoBlock(photo, titleShown ? 'Additional Photos' : title, count, !titleShown); titleShown = true; }
    else { compact.push(photo); }
  });
  flushCompact();
  return html;
}

function renderItem(header: string, details: string, photos: PhotoEntry[]): string {
  return `<div class="item"><div class="item-lead">${header}${details}${renderPhotoBlocks(photos)}</div></div>`;
}

function noteBox(label: string, text: string | null | undefined, cls: string): string {
  if (!text) return '';
  return `<div class="${cls}"><div class="note-label">${label}</div><div class="note-text">${formatText(text)}</div></div>`;
}

function fieldRow(label: string, value: string | null | undefined): string {
  if (!value) return '';
  return `<div class="ifield"><span class="fl">${label}</span><span class="fv">${esc(value)}</span></div>`;
}

function fieldHtml(label: string, html: string | null | undefined): string {
  if (!html) return '';
  return `<div class="ifield"><span class="fl">${label}</span><span class="fv">${html}</span></div>`;
}

function fieldGrid(...rows: string[]): string {
  const fields = rows.filter(Boolean);
  if (!fields.length) return '';
  const fieldRows: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    fieldRows.push(`<div class="field-row">${fields.slice(i, i + 2).join('')}${fields[i + 1] ? '' : '<div class="ifield ifield-empty"></div>'}</div>`);
  }
  return `<div class="fields">${fieldRows.join('')}</div>`;
}

function secHeader(num: string, title: string): string {
  return `<div class="sec-bar"><span class="sec-num-badge">${num.padStart(2, '0')}</span><span class="sec-bar-name">${title}</span></div>`;
}

function secHeaderLabel(label: string, title: string): string {
  return `<div class="sec-bar"><span class="sec-num-badge">${label}</span><span class="sec-bar-name">${title}</span></div>`;
}

function zoneBadge(name: string | undefined): string {
  return name ? `<span class="zone-badge">${esc(name)}</span>` : '';
}

function statPill(n: number, label: string): string {
  return `<div class="sp"><div class="sn">${n}</div><div class="sl">${label}</div></div>`;
}

// ── Field accessors for generic EquipmentItem ─────────────────────────────────────
function sf(key: string, item: EquipmentItem): string | null {
  const v = item[key];
  return v != null && v !== '' ? String(v) : null;
}

function nf(key: string, item: EquipmentItem): number | null {
  const v = item[key];
  return v != null && !isNaN(Number(v)) ? Number(v) : null;
}

// ── Item renderers ────────────────────────────────────────────────────────────────
function renderMs(m: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const header = `<div class="item-head">${renderPdfEquipmentIcon('switchboard')}<div class="item-title">
      <div class="iname">${esc(sf('name', m))}</div>
      <div class="isub">Main Switchboard${sf('location', m) ? ` &middot; ${esc(sf('location', m))}` : ''}${sf('siteNmi', m) ? ` &middot; NMI: ${esc(sf('siteNmi', m))}` : ''}</div>
      ${showZone ? zoneBadge(zoneMap.get(m.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(fieldRow('GPS Locator', sf('mapLocator', m)), fieldRow('Sub-Circuits', sf('subCircuitsDescription', m)), fieldRow('Comments', sf('comments', m)))}
    ${noteBox('Additional Notes', sf('extraNotes', m), 'note-green')}`;
  return renderItem(header, details, photos);
}

function renderAddlSb(a: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const header = `<div class="item-head">${renderPdfEquipmentIcon('switchboard')}<div class="item-title">
      <div class="iname">${esc(sf('name', a))}${sf('type', a) ? ` <span class="type-chip">(${esc(sf('type', a))})</span>` : ''}</div>
      <div class="isub">Additional Switchboard${sf('location', a) ? ` &middot; ${esc(sf('location', a))}` : ''}</div>
      ${showZone ? zoneBadge(zoneMap.get(a.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(fieldRow('GPS Locator', sf('mapLocator', a)), fieldRow('Sub-Circuits', sf('subCircuitsDescription', a)), fieldRow('Comments', sf('comments', a)))}
    ${noteBox('Additional Notes', sf('extraNotes', a), 'note-green')}`;
  return renderItem(header, details, photos);
}

function renderHvac(h: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const heatingKw = nf('heatingCapacityKw', h);
  const coolingKw = nf('coolingCapacityKw', h);
  const header = `<div class="item-head">${renderPdfEquipmentIcon('hvac')}<div class="item-title">
      <div class="iname">${esc(sf('unitName', h))}</div>
      <div class="isub">${esc([sf('type', h), sf('make', h), sf('model', h)].filter(Boolean).join(' · ')) || 'HVAC Unit'}</div>
      ${showZone ? zoneBadge(zoneMap.get(h.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(
    fieldRow('Location', sf('location', h)), fieldRow('Serial Number', sf('serialNumber', h)),
    heatingKw != null ? fieldHtml('Heating Capacity', `${heatingKw} kW`) : '',
    coolingKw != null ? fieldHtml('Cooling Capacity', `${coolingKw} kW`) : '',
    fieldRow('Power Supply', sf('powerSupplyPhase', h)), fieldRow('Indoor Unit Model', sf('indoorUnitModel', h)),
    fieldRow('Indoor Unit Serial', sf('indoorUnitSerial', h)), fieldRow('Controller Type', sf('controllerType', h)),
    fieldRow('Controller Model', sf('controllerModel', h)), fieldRow('Temperature Sensor', sf('temperatureSensorType', h)),
    fieldRow('System Coverage', sf('systemCoverage', h)),
  )}
  ${noteBox('Additional Notes', sf('extraNotes', h), 'note-green')}
  ${noteBox('Observations for Energy Improvement', sf('energyImprovementObservations', h), 'note-amber')}`;
  return renderItem(header, details, photos);
}

function renderLight(l: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const qty = nf('quantity', l);
  const watts = nf('ratedWattage', l);
  const header = `<div class="item-head">${renderPdfEquipmentIcon('lighting')}<div class="item-title">
      <div class="iname">${esc(sf('lightType', l))}${sf('brandModel', l) ? ` &mdash; ${esc(sf('brandModel', l))}` : ''}</div>
      <div class="isub">${[sf('areaLocation', l), qty != null ? `×${qty}` : null].filter(Boolean).join(' · ') || 'Lighting System'}</div>
      ${showZone ? zoneBadge(zoneMap.get(l.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(
    fieldRow('Area / Location', sf('areaLocation', l)),
    qty != null ? fieldHtml('Quantity', `${qty}`) : '',
    watts != null ? fieldHtml('Rated Wattage', `${watts} W / fixture${qty != null ? ` · Total ${((watts * qty) / 1000).toFixed(2)} kW` : ''}`) : '',
    fieldRow('Controls', sf('controlsType', l)), fieldRow('Operating Hours', sf('operatingHours', l)),
    fieldRow('Mounting Height', sf('mountingHeight', l)), fieldRow('Fixtures Installed', sf('fixturesInstalled', l)),
    fieldRow('Circuit Grouping', sf('circuitGrouping', l)), fieldRow('Access Limitations', sf('accessLimitations', l)),
  )}
  ${noteBox('Additional Notes', sf('extraNotes', l), 'note-green')}
  ${noteBox('Observations for Energy Improvement', sf('energyImprovementObservations', l), 'note-amber')}`;
  return renderItem(header, details, photos);
}

function renderSolar(sv: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const sizeKw = nf('systemSizeKw', sv);
  const hasRoofSpace = sf('availableRoofSpace', sv);
  const header = `<div class="item-head">${renderPdfEquipmentIcon('solar')}<div class="item-title">
      <div class="iname">Solar PV${sizeKw != null ? ` &mdash; ${sizeKw} kW` : ''}</div>
      <div class="isub">${sf('inverterBrandModel', sv) ? esc(sf('inverterBrandModel', sv)) : 'Solar PV System'}</div>
      ${showZone ? zoneBadge(zoneMap.get(sv.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(
    sizeKw != null ? fieldHtml('System Size', `${sizeKw} kW`) : '',
    fieldRow('Inverter Brand / Model', sf('inverterBrandModel', sv)),
    fieldRow('Inverter Location', sf('inverterLocation', sv)), fieldRow('Power Supply to PV', sf('powerSupplyToPv', sv)),
    hasRoofSpace ? fieldHtml('Additional Roof Space', `${esc(hasRoofSpace)}${sf('roofSpaceAmount', sv) ? ` · ${esc(sf('roofSpaceAmount', sv))}` : ''}`) : '',
    fieldRow('Suitable Switchboard', sf('suitableSwitchboard', sv)), fieldRow('Switchboard Location', sf('switchboardLocation', sv)),
    fieldRow('Cable Distance', sf('cableDistance', sv)), fieldRow('Cable Route', sf('cableRouteDescription', sv)),
  )}
  ${noteBox('Additional Notes', sf('extraNotes', sv), 'note-green')}
  ${noteBox('Observations for Energy Improvement', sf('energyImprovementObservations', sv), 'note-amber')}`;
  return renderItem(header, details, photos);
}

function renderForklift(f: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const qty = nf('quantity', f);
  const header = `<div class="item-head">${renderPdfEquipmentIcon('charger')}<div class="item-title">
      <div class="iname">${esc(sf('chargerType', f))}${sf('brandModel', f) ? ` &mdash; ${esc(sf('brandModel', f))}` : ''}</div>
      <div class="isub">Forklift Charger${sf('location', f) ? ` · ${esc(sf('location', f))}` : ''}${qty != null ? ` · ×${qty}` : ''}</div>
      ${showZone ? zoneBadge(zoneMap.get(f.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(
    fieldRow('Location', sf('location', f)), qty != null ? fieldHtml('Quantity', `${qty}`) : '',
    fieldRow('Rating', sf('rating', f)), fieldRow('Power Supply', sf('powerSupply', f)),
    fieldRow('Connection Description', sf('connectionDescription', f)), fieldRow('Local Isolator', sf('localIsolator', f)),
    fieldRow('Circuit Identifiable', sf('circuitIdentifiable', f)), fieldRow('Distance to Switchboard', sf('distanceToSwitchboard', f)),
    fieldRow('Space for Additional', sf('spaceForAdditional', f)), fieldRow('Connection Type', sf('hardwiredSocket', f)),
    fieldRow('Scheduling Opportunity', sf('schedulingOpportunity', f)),
  )}
  ${noteBox('Additional Notes', sf('extraNotes', f), 'note-green')}
  ${noteBox('Observations for Energy Improvement', sf('energyImprovementObservations', f), 'note-amber')}`;
  return renderItem(header, details, photos);
}

function renderHotWater(h: EquipmentItem, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const liters = nf('sizeLiters', h);
  const header = `<div class="item-head">${renderPdfEquipmentIcon('hot-water')}<div class="item-title">
      <div class="iname">${esc(sf('dhwDetailsType', h))}</div>
      <div class="isub">${[sf('fuelType', h), liters != null ? `${liters} L` : null, sf('location', h)].filter(Boolean).join(' · ') || 'Hot Water System'}</div>
      ${showZone ? zoneBadge(zoneMap.get(h.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(
    fieldRow('Location', sf('location', h)), fieldRow('Fuel Type', sf('fuelType', h)),
    liters != null ? fieldHtml('Size', `${liters} L`) : '',
    fieldRow('Serial Number', sf('serialNumber', h)), fieldRow('Pipe Insulation', sf('pipeInsulation', h)),
    fieldRow('Insulation Thickness', sf('pipeInsulationThickness', h)), fieldRow('Tempering Valve', sf('temperingValve', h)),
    fieldRow('More DHW on Site', sf('moreDhwSystems', h)), fieldRow('Additional Comments', sf('additionalComments', h)),
  )}
  ${noteBox('Additional Notes', sf('extraNotes', h), 'note-green')}
  ${noteBox('Observations for Energy Improvement', sf('energyImprovementObservations', h), 'note-amber')}`;
  return renderItem(header, details, photos);
}

function renderGenWater(g: EquipmentItem, idx: number, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const header = `<div class="item-head">${renderPdfEquipmentIcon('water')}<div class="item-title">
      <div class="iname">Water Item ${idx + 1}${sf('question', g) ? ` &mdash; ${esc(sf('question', g))}` : ''}</div>
      ${showZone ? zoneBadge(zoneMap.get(g.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(fieldRow('Question', sf('question', g)), fieldRow('Answer', sf('answer', g)))}
    ${noteBox('Additional Notes', sf('extraNotes', g), 'note-green')}`;
  return renderItem(header, details, photos);
}

function renderGenElec(g: EquipmentItem, idx: number, photos: PhotoEntry[], zoneMap: Map<string, string>, showZone = true): string {
  const header = `<div class="item-head">${renderPdfEquipmentIcon('electricity')}<div class="item-title">
      <div class="iname">Electricity Item ${idx + 1}${sf('question', g) ? ` &mdash; ${esc(sf('question', g))}` : ''}</div>
      ${showZone ? zoneBadge(zoneMap.get(g.zoneId)) : ''}
    </div></div>`;
  const details = `${fieldGrid(fieldRow('Question', sf('question', g)), fieldRow('Answer', sf('answer', g)))}
    ${noteBox('Additional Notes', sf('extraNotes', g), 'note-green')}`;
  return renderItem(header, details, photos);
}

// ── Shared report-body CSS; server page framing follows ECOAUDIT_PDF_RULES.md ────
function buildCss(): string {
  return `
@page{size:A4;background:#FFFFFF;}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:10.5pt;color:#1E293B;background:#fff;line-height:1.55;}

.doc-table{width:100%;border-collapse:collapse;border-spacing:0;}
.doc-table thead,.doc-table tfoot{display:none;}

.hdr-cell{background:#142F70;padding:0;height:56px;border-bottom:8px solid #FFFFFF;}
.hdr-inner{width:100%;height:56px;display:table;}
.hdr-brand{display:table-cell;vertical-align:middle;padding:0 18px;white-space:nowrap;width:1%;}
.hdr-brand-title{font-size:10pt;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:0.12em;}
.hdr-sep{display:table-cell;vertical-align:middle;width:1px;padding:0;}
.hdr-sep-line{width:1px;height:28px;background:rgba(255,255,255,0.28);}
.hdr-report{display:table-cell;vertical-align:middle;padding:0 16px;color:rgba(255,255,255,0.92);font-size:9pt;font-weight:600;letter-spacing:0.03em;}

.ftr-cell{border-top:1.5px solid #93C5FD;border-left:2.5px solid #1E3A8A;border-right:2.5px solid #1E3A8A;border-bottom:2.5px solid #1E3A8A;padding:0;height:30px;}
.ftr-inner{width:100%;height:30px;display:table;}
.ftr-left{display:table-cell;vertical-align:middle;padding:0 20px;font-size:7pt;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.12em;}
.ftr-right{display:table-cell;vertical-align:middle;padding:0 20px;text-align:right;font-size:7pt;color:#CBD5E1;}

.content-cell{padding:18px 28px 40px;border-left:2.5px solid #1E3A8A;border-right:2.5px solid #1E3A8A;background:#FFFFFF;}

.cover{border:1px solid #1D4ED8;border-top:5px solid #0B3F59;border-radius:0 0 8px 8px;padding:20px 24px 18px;margin-bottom:20px;background:#142F70;}
.cover-eyebrow{font-size:7.5pt;font-weight:700;color:#DBEAFE;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:5px;}
.cover-brand{margin:10px 0 14px;}
.cover-brand-label{font-size:7pt;font-weight:800;color:#BFDBFE;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px;}
.cover-brand-logo{display:block;width:162px;height:auto;background:#FFFFFF;border-radius:6px;padding:5px 9px;}
.cover-meta{display:table;width:100%;border:1px solid rgba(255,255,255,0.28);border-radius:6px;border-collapse:collapse;}
.cover-meta-row{display:table-row;}
.cm{display:table-cell;padding:11px 14px;background:#FFFFFF;border:1px solid #BFDBFE;width:50%;}
.cml{font-size:7pt;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px;}
.cmv{font-size:10.5pt;font-weight:600;color:#1E293B;}

.exec-title{font-size:13pt;font-weight:800;color:#0F172A;margin-bottom:8px;padding-bottom:7px;border-bottom:2px solid #1E3A8A;}
.exec-mode{font-size:8pt;font-weight:700;color:#1E3A8A;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;}
.exec-copy{font-size:10pt;line-height:1.6;color:#334155;background:#F8FAFC;border-left:3px solid #1E3A8A;padding:11px 14px 18px;margin-bottom:18px;border-radius:0 6px 6px 0;page-break-inside:auto;break-inside:auto;overflow-wrap:anywhere;orphans:3;widows:3;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.stats{display:table;width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:24px;}
.stats-row{display:table-row;}
.sp{display:table-cell;text-align:center;background:#F8FAFC;border:1px solid #DBEAFE;border-radius:8px;padding:10px 6px;border-top:3px solid #1E3A8A;}
.sn{font-size:16pt;font-weight:800;color:#1E3A8A;line-height:1;display:block;}
.sl{font-size:7pt;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;display:block;}

.sec-bar{display:block;background:#1E3A8A;border-radius:8px 8px 0 0;padding:12px 16px;margin-top:26px;page-break-after:avoid;break-after:avoid;}
.sec-num-badge{display:inline-block;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.18);text-align:center;line-height:26px;font-size:9pt;font-weight:800;color:#fff;margin-right:10px;vertical-align:middle;}
.sec-bar-name{display:inline;font-size:12pt;font-weight:800;color:#fff;vertical-align:middle;letter-spacing:0.04em;text-transform:uppercase;}

.sec-desc{font-size:9.5pt;color:#64748B;margin-bottom:12px;margin-top:10px;}
.subsec-title{display:block;background:#EFF6FF;border-left:4px solid #1E3A8A;color:#1E3A8A;font-size:9.5pt;font-weight:800;padding:8px 14px;margin:10px 0 4px;letter-spacing:0.04em;text-transform:uppercase;page-break-after:avoid;break-after:avoid;}

.zone-hdr{background:#1E3A8A;border-radius:8px 8px 0 0;padding:12px 16px;page-break-after:avoid;break-after:avoid;}
.zone-hdr-inner{display:table;width:100%;}
.zh-left{display:table-cell;vertical-align:middle;}
.zh-num-wrap{display:inline-block;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.18);text-align:center;line-height:26px;font-size:9pt;font-weight:800;color:#fff;margin-right:10px;vertical-align:middle;}
.zh-name{display:inline;font-size:12pt;font-weight:800;color:#fff;vertical-align:middle;}
.zh-desc{font-size:9pt;color:rgba(255,255,255,0.7);margin-top:4px;padding-left:36px;}
.zh-right{display:table-cell;vertical-align:middle;text-align:right;font-size:8pt;font-weight:600;color:#93C5FD;white-space:nowrap;}
.zone-section{margin-bottom:4px;}
.zone-type-label{display:block;background:#EFF6FF;border-left:4px solid #1E3A8A;color:#1E3A8A;font-size:9.5pt;font-weight:800;padding:8px 14px;margin:10px 0 4px;letter-spacing:0.04em;text-transform:uppercase;page-break-after:avoid;break-after:avoid;}

.item{background:#FFFFFF;border:1px solid #DBEAFE;border-left:3px solid #1E3A8A;border-radius:0 8px 8px 0;padding:11px 14px 18px;margin-bottom:14px;page-break-inside:auto;break-inside:auto;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.item-lead{page-break-inside:auto;break-inside:auto;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.item-head{display:table;width:100%;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #E2E8F0;page-break-after:avoid;break-after:avoid;}
.iico{display:table-cell;vertical-align:top;width:28px;padding-top:1px;color:#1E3A8A;}
.iico-svg{display:block;width:19px;height:19px;overflow:visible;}
.item-title{display:table-cell;vertical-align:top;}
.iname{font-size:11.5pt;font-weight:700;color:#1E3A8A;}
.isub{font-size:9.5pt;color:#64748B;margin-top:2px;}
.zone-badge{display:inline-block;font-size:7.5pt;color:#166534;background:#DCFCE7;border:1px solid #BBF7D0;padding:2px 8px;border-radius:4px;font-weight:700;margin-top:5px;}
.type-chip{font-size:9.5pt;font-weight:400;color:#64748B;}
.empty-note{font-size:10pt;color:#CBD5E1;font-style:italic;padding:8px 0 12px;}

.fields{display:table;width:100%;border-collapse:separate;border-spacing:0 5px;margin-bottom:5px;}
.field-row{display:table-row;}
.ifield{display:table-cell;width:50%;padding-right:16px;vertical-align:top;}
.ifield-empty{visibility:hidden;}
.fl{display:block;font-size:7pt;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;}
.fv{display:block;font-size:10pt;color:#1E293B;font-weight:600;overflow-wrap:anywhere;padding-bottom:3px;orphans:3;widows:3;}

.note-green{margin-top:8px;margin-bottom:8px;padding:9px 12px 18px;background:#F0FDF4;border:1px solid #BBF7D0;border-left:3px solid #86EFAC;border-radius:0 6px 6px 0;page-break-inside:auto;break-inside:auto;orphans:3;widows:3;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.note-amber{margin-top:8px;margin-bottom:8px;padding:9px 12px 18px;background:#FEFCE8;border:1px solid #FEF08A;border-left:3px solid #FDE047;border-radius:0 6px 6px 0;page-break-inside:auto;break-inside:auto;orphans:3;widows:3;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.note-label{font-size:7.5pt;font-weight:700;color:#334155;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em;page-break-after:avoid;break-after:avoid;}
.note-text{font-size:9.5pt;color:#334155;line-height:1.65;overflow-wrap:anywhere;padding-bottom:5px;}

.photos{margin-top:11px;padding-top:9px;border-top:1px solid #E2E8F0;page-break-inside:auto;break-inside:auto;}
.photos-lead{page-break-inside:avoid;break-inside:avoid;}
.photos-more{margin-top:7px;padding-top:7px;}
.photos-title{display:table;width:100%;font-size:7.5pt;font-weight:800;color:#64748B;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;}
.photos-title span{display:table-cell;}
.photos-title b{display:table-cell;text-align:right;color:#1E3A8A;font-size:8pt;}
.photo-grid{display:table;width:100%;border-collapse:separate;border-spacing:8px 9px;}
.photo-row-pair{display:table-row;page-break-inside:avoid;break-inside:avoid;}
.photo-cell{display:table-cell;width:33.33%;vertical-align:top;text-align:center;page-break-inside:avoid;break-inside:avoid;}
.photos-cols-2 .photo-cell{width:50%;}
.photos-cols-3 .photo-cell{width:33.33%;}
.photo-empty{visibility:hidden;}
.photo-img{max-width:100%;max-height:172px;width:auto;height:auto;display:inline-block;border:1px solid #CBD5E1;border-radius:4px;background:#FFFFFF;padding:2px;}
.photo-lbl{font-size:7pt;color:#64748B;margin-top:4px;text-align:center;word-break:break-word;line-height:1.25;}
.photos-large{page-break-inside:avoid;break-inside:avoid;}
.photo-large-cell{width:100%;text-align:center;page-break-inside:avoid;break-inside:avoid;}
.photo-large-img{max-width:100%;max-height:370px;width:auto;height:auto;display:inline-block;border:1px solid #CBD5E1;border-radius:5px;background:#FFFFFF;padding:3px;}
.photo-large-lbl{font-size:7.5pt;font-weight:700;margin-top:5px;}
.fmt-list{margin:4px 0 4px 16px;padding:0;}
.fmt-list li{margin-bottom:2px;}

.obs-block{border-radius:0 8px 8px 0;border-left:3px solid #1E3A8A;padding:12px 16px 20px;background:#FEFCE8;margin-bottom:16px;page-break-inside:auto;break-inside:auto;orphans:3;widows:3;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.obs-summary{background:#F8FAFC;border:1px solid #DBEAFE;border-left:3px solid #1E3A8A;}
.obs-num{font-size:7.5pt;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;page-break-after:avoid;break-after:avoid;}
.obs-title{font-size:10.5pt;font-weight:700;color:#1E3A8A;margin-bottom:5px;page-break-after:avoid;break-after:avoid;}
.obs-text{font-size:9.5pt;line-height:1.65;color:#334155;overflow-wrap:anywhere;padding-bottom:5px;}

.end-block{margin-top:28px;padding:18px 24px;background:#1E3A8A;border-radius:8px;}
.end-inner{display:table;width:100%;}
.end-left{display:table-cell;vertical-align:middle;}
.end-right{display:table-cell;vertical-align:middle;text-align:right;}
.end-title{font-size:11pt;font-weight:800;color:#fff;}
.end-sub{font-size:8pt;color:#93C5FD;margin-top:4px;}
.end-badge{display:inline-block;background:#fff;border-radius:5px;padding:4px 7px;}
.end-logo{display:block;width:116px;height:auto;}
  `;
}

// ── Body builders ─────────────────────────────────────────────────────────────────
type BodyArgs = {
  audit: typeof eaAudits.$inferSelect;
  zones: Array<typeof eaZones.$inferSelect>;
  photos: PhotoRow[];
  mode: 'by-equipment' | 'by-zone';
  msList: EquipmentItem[];
  addlSbList: EquipmentItem[];
  hvacList: EquipmentItem[];
  lightList: EquipmentItem[];
  solarList: EquipmentItem[];
  forkliftList: EquipmentItem[];
  hotWaterList: EquipmentItem[];
  genWaterList: EquipmentItem[];
  genElecList: EquipmentItem[];
  brandLogo: string;
  genDate: string;
};

function zonePhotoCount(zoneId: string, photos: PhotoRow[], allEquipment: EquipmentItem[][]): number {
  const entityIds = new Set<string>([zoneId, ...allEquipment.flat().filter((x) => x.zoneId === zoneId).map((x) => x.id)]);
  return photos.filter((p) => entityIds.has(p.entityId) && p.remoteUrl).length;
}

function defaultExecutiveSummary(args: BodyArgs): string {
  const itemCount = args.msList.length + args.addlSbList.length + args.hvacList.length + args.lightList.length
    + args.solarList.length + args.forkliftList.length + args.hotWaterList.length + args.genWaterList.length + args.genElecList.length;
  return `This energy audit report summarises findings for ${args.audit.siteName || 'the audited site'}, covering ${args.zones.length} zone${args.zones.length === 1 ? '' : 's'} and ${itemCount} captured item${itemCount === 1 ? '' : 's'}.`;
}

function defaultConsolidatedObservations(
  hvacList: EquipmentItem[],
  lightList: EquipmentItem[],
  solarList: EquipmentItem[],
  forkliftList: EquipmentItem[],
  hotWaterList: EquipmentItem[],
): string {
  const observations = [
    ...hvacList.map((item) => sf('energyImprovementObservations', item)),
    ...lightList.map((item) => sf('energyImprovementObservations', item)),
    ...solarList.map((item) => sf('energyImprovementObservations', item)),
    ...forkliftList.map((item) => sf('energyImprovementObservations', item)),
    ...hotWaterList.map((item) => sf('energyImprovementObservations', item)),
  ].filter((value): value is string => !!value);
  return observations.length ? observations.join('\n\n') : '';
}

function observationsBody(
  hvacList: EquipmentItem[],
  lightList: EquipmentItem[],
  solarList: EquipmentItem[],
  forkliftList: EquipmentItem[],
  hotWaterList: EquipmentItem[],
  consolidated: string | null | undefined,
): string {
  const allObs: Array<{ section: string; text: string }> = [
    ...hvacList.filter((h) => sf('energyImprovementObservations', h)).map((h) => ({ section: `HVAC · ${esc(sf('unitName', h))}`, text: sf('energyImprovementObservations', h)! })),
    ...lightList.filter((l) => sf('energyImprovementObservations', l)).map((l) => ({ section: `Lighting · ${esc(sf('lightType', l))}`, text: sf('energyImprovementObservations', l)! })),
    ...solarList.filter((s) => sf('energyImprovementObservations', s)).map((s) => ({ section: `Solar PV${nf('systemSizeKw', s) != null ? ` · ${nf('systemSizeKw', s)} kW` : ''}`, text: sf('energyImprovementObservations', s)! })),
    ...forkliftList.filter((f) => sf('energyImprovementObservations', f)).map((f) => ({ section: `Forklift · ${esc(sf('chargerType', f))}`, text: sf('energyImprovementObservations', f)! })),
    ...hotWaterList.filter((h) => sf('energyImprovementObservations', h)).map((h) => ({ section: `Hot Water · ${esc(sf('dhwDetailsType', h))}`, text: sf('energyImprovementObservations', h)! })),
  ];
  if (!consolidated && allObs.length === 0) return '';
  return `
    ${secHeader('9', 'Observations for Energy Improvements')}
    ${consolidated ? `<div class="obs-block obs-summary"><div class="obs-title">Consolidated Observations</div><div class="obs-text">${formatText(consolidated)}</div></div>` : ''}
    ${allObs.length ? `<p class="sec-desc">Equipment-specific observations provided by the auditor.</p>` : ''}
    ${allObs.map((o, i) => `<div class="obs-block"><div class="obs-num">Observation ${i + 1}</div><div class="obs-title">${o.section}</div><div class="obs-text">${formatText(o.text)}</div></div>`).join('')}`;
}

function zonePhotosBody(zones: Array<typeof eaZones.$inferSelect>, photos: PhotoRow[]): string {
  const blocks = zones.map((zone) => {
    const zPhotos = photosForEntity(photos, zone.id, zone.photoDescs);
    if (zPhotos.length === 0) return '';
    return `<div class="item">
      <div class="item-head">${renderPdfEquipmentIcon('camera')}<div class="item-title">
        <div class="iname">${esc(zone.zoneName)}</div>
        ${zone.zoneDescription ? `<div class="isub">${esc(zone.zoneDescription)}</div>` : '<div class="isub">Zone Photos</div>'}
      </div></div>
      ${renderPhotoBlocks(zPhotos, 'Zone Photos', zPhotos.length)}
    </div>`;
  }).filter(Boolean).join('');
  return blocks ? `${secHeaderLabel('ZP', 'Zone Photos')}${blocks}` : '';
}

function byEquipmentBody(args: BodyArgs): string {
  const zoneMap = new Map(args.zones.map((z) => [z.id, z.zoneName]));
  const { photos, msList, addlSbList, hvacList, lightList, solarList, forkliftList, hotWaterList, genWaterList, genElecList } = args;
  const consolidatedObservations = defaultConsolidatedObservations(hvacList, lightList, solarList, forkliftList, hotWaterList);

  const elecParts = [
    msList.length ? `<div class="subsec-title">1.1 &nbsp;Main Switchboard</div>${msList.map((m) => renderMs(m, photosForEntity(photos, m.id, m.photoDescs), zoneMap)).join('')}` : '',
    addlSbList.length ? `<div class="subsec-title" style="margin-top:16px;">1.2 &nbsp;Additional Switchboards</div>${addlSbList.map((a) => renderAddlSb(a, photosForEntity(photos, a.id, a.photoDescs), zoneMap)).join('')}` : '',
  ].filter(Boolean).join('');

  return zonePhotosBody(args.zones, photos)
    + (elecParts ? `${secHeader('1', 'Electrical Infrastructure')}${elecParts}` : '')
    + (hvacList.length ? `${secHeader('2', 'HVAC Systems')}${hvacList.map((h) => renderHvac(h, photosForEntity(photos, h.id, h.photoDescs), zoneMap)).join('')}` : '')
    + (lightList.length ? `${secHeader('3', 'Lighting Systems')}${lightList.map((l) => renderLight(l, photosForEntity(photos, l.id, l.photoDescs), zoneMap)).join('')}` : '')
    + (solarList.length ? `${secHeader('4', 'Solar PV Infrastructure')}${solarList.map((s) => renderSolar(s, photosForEntity(photos, s.id, s.photoDescs), zoneMap)).join('')}` : '')
    + (forkliftList.length ? `${secHeader('5', 'Forklift Charging')}${forkliftList.map((f) => renderForklift(f, photosForEntity(photos, f.id, f.photoDescs), zoneMap)).join('')}` : '')
    + (hotWaterList.length ? `${secHeader('6', 'Hot Water Systems')}${hotWaterList.map((h) => renderHotWater(h, photosForEntity(photos, h.id, h.photoDescs), zoneMap)).join('')}` : '')
    + (genWaterList.length ? `${secHeader('7', 'General Water')}${genWaterList.map((g, i) => renderGenWater(g, i, photosForEntity(photos, g.id, g.photoDescs), zoneMap)).join('')}` : '')
    + (genElecList.length ? `${secHeader('8', 'General Electricity')}${genElecList.map((g, i) => renderGenElec(g, i, photosForEntity(photos, g.id, g.photoDescs), zoneMap)).join('')}` : '')
    + observationsBody(hvacList, lightList, solarList, forkliftList, hotWaterList, consolidatedObservations);
}

function byZoneBody(args: BodyArgs): string {
  const zoneMap = new Map(args.zones.map((z) => [z.id, z.zoneName]));
  const { photos, msList, addlSbList, hvacList, lightList, solarList, forkliftList, hotWaterList, genWaterList, genElecList, zones } = args;
  const allEquipment = [msList, addlSbList, hvacList, lightList, solarList, forkliftList, hotWaterList, genWaterList, genElecList];
  const knownZoneIds = new Set(zones.map((z) => z.id));

  type ZoneBlock = {
    id: string | null; title: string; description: string | null;
    zMs: EquipmentItem[]; zAddl: EquipmentItem[]; zHvac: EquipmentItem[]; zLight: EquipmentItem[];
    zSolar: EquipmentItem[]; zFork: EquipmentItem[]; zHw: EquipmentItem[]; zGw: EquipmentItem[]; zGe: EquipmentItem[];
    zPhotos: PhotoEntry[]; total: number; photoCount: number;
  };

  const zoneBlocks: ZoneBlock[] = zones.map((zone) => {
    const zMs = msList.filter((x) => x.zoneId === zone.id);
    const zAddl = addlSbList.filter((x) => x.zoneId === zone.id);
    const zHvac = hvacList.filter((x) => x.zoneId === zone.id);
    const zLight = lightList.filter((x) => x.zoneId === zone.id);
    const zSolar = solarList.filter((x) => x.zoneId === zone.id);
    const zFork = forkliftList.filter((x) => x.zoneId === zone.id);
    const zHw = hotWaterList.filter((x) => x.zoneId === zone.id);
    const zGw = genWaterList.filter((x) => x.zoneId === zone.id);
    const zGe = genElecList.filter((x) => x.zoneId === zone.id);
    const total = zMs.length + zAddl.length + zHvac.length + zLight.length + zSolar.length + zFork.length + zHw.length + zGw.length + zGe.length;
    const zPhotos = photosForEntity(photos, zone.id, zone.photoDescs);
    return { id: zone.id, title: zone.zoneName, description: zone.zoneDescription, zMs, zAddl, zHvac, zLight, zSolar, zFork, zHw, zGw, zGe, total, zPhotos, photoCount: zonePhotoCount(zone.id, photos, allEquipment) };
  }).filter((z) => z.total > 0 || z.photoCount > 0);

  const unzMs = msList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzAddl = addlSbList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzHvac = hvacList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzLight = lightList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzSolar = solarList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzFork = forkliftList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzHw = hotWaterList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzGw = genWaterList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzGe = genElecList.filter((x) => !x.zoneId || !knownZoneIds.has(x.zoneId));
  const unzTotal = unzMs.length + unzAddl.length + unzHvac.length + unzLight.length + unzSolar.length + unzFork.length + unzHw.length + unzGw.length + unzGe.length;
  if (unzTotal > 0) {
    zoneBlocks.push({ id: null, title: 'Unzoned', description: null, zMs: unzMs, zAddl: unzAddl, zHvac: unzHvac, zLight: unzLight, zSolar: unzSolar, zFork: unzFork, zHw: unzHw, zGw: unzGw, zGe: unzGe, total: unzTotal, zPhotos: [], photoCount: unzTotal });
  }

  if (zoneBlocks.length === 0) return '<p class="empty-note">No selected zone items in this report.</p>';

  return zoneBlocks.map((zone, zIdx) => {
    return `<div class="zone-section">
      <div class="zone-hdr">
        <div class="zone-hdr-inner">
          <div class="zh-left">
            <span class="zh-num-wrap">${zIdx + 1}</span>
            <span class="zh-name">${esc(zone.title)}</span>
            ${zone.description ? `<div class="zh-desc">${esc(zone.description)}</div>` : ''}
          </div>
          <div class="zh-right">${zone.total} item${zone.total !== 1 ? 's' : ''} &nbsp;·&nbsp; ${zone.photoCount} photo${zone.photoCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
      ${zone.zPhotos.length ? renderPhotoBlocks(zone.zPhotos, 'Zone Photos', zone.zPhotos.length, 'photos-lead') : ''}
      ${zone.zMs.length ? `<div class="zone-type-label">Main Switchboard</div>${zone.zMs.map((m) => renderMs(m, photosForEntity(photos, m.id, m.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zAddl.length ? `<div class="zone-type-label">Additional Switchboards</div>${zone.zAddl.map((a) => renderAddlSb(a, photosForEntity(photos, a.id, a.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zHvac.length ? `<div class="zone-type-label">HVAC Systems</div>${zone.zHvac.map((h) => renderHvac(h, photosForEntity(photos, h.id, h.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zLight.length ? `<div class="zone-type-label">Lighting Systems</div>${zone.zLight.map((l) => renderLight(l, photosForEntity(photos, l.id, l.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zSolar.length ? `<div class="zone-type-label">Solar PV</div>${zone.zSolar.map((s) => renderSolar(s, photosForEntity(photos, s.id, s.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zFork.length ? `<div class="zone-type-label">Forklift Charging</div>${zone.zFork.map((f) => renderForklift(f, photosForEntity(photos, f.id, f.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zHw.length ? `<div class="zone-type-label">Hot Water</div>${zone.zHw.map((h) => renderHotWater(h, photosForEntity(photos, h.id, h.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zGw.length ? `<div class="zone-type-label">General Water</div>${zone.zGw.map((g, i) => renderGenWater(g, i, photosForEntity(photos, g.id, g.photoDescs), zoneMap, false)).join('')}` : ''}
      ${zone.zGe.length ? `<div class="zone-type-label">General Electricity</div>${zone.zGe.map((g, i) => renderGenElec(g, i, photosForEntity(photos, g.id, g.photoDescs), zoneMap, false)).join('')}` : ''}
    </div>`;
  }).join('');
}

function buildAuditEndBlock(args: Pick<BodyArgs, 'audit' | 'brandLogo' | 'genDate'>): string {
  return `<div class="end-block">
    <div class="end-inner">
      <div class="end-left">
        <div class="end-title">End of Report</div>
        <div class="end-sub">Sustainability Wise &nbsp;·&nbsp; ${esc(args.audit.siteName)} &nbsp;·&nbsp; ${args.genDate}</div>
      </div>
      <div class="end-right"><div class="end-badge"><img class="end-logo" src="${args.brandLogo}" alt="Sustainability Wise" /></div></div>
    </div>
  </div>`;
}

type BuildAuditHtmlOptions = {
  includeEnd?: boolean;
  includeIntro?: boolean;
  introNoticeHtml?: string;
};

// ── Full HTML builder ─────────────────────────────────────────────────────────────
function buildAuditHtml(args: BodyArgs, options: BuildAuditHtmlOptions = {}): string {
  const { audit, zones, mode, brandLogo, genDate, msList, addlSbList, hvacList, lightList, solarList, forkliftList, hotWaterList, genWaterList, genElecList, photos } = args;
  const modeLabel = mode === 'by-zone' ? 'Report by Zone' : 'Report by Equipment';
  const statusLabel = audit.status === 'Completed' ? 'Completed' : 'In Progress';
  const totalEquipment = msList.length + addlSbList.length + hvacList.length + lightList.length + solarList.length + forkliftList.length + hotWaterList.length + genWaterList.length + genElecList.length;
  const totalPhotos = photos.filter((p) => p.remoteUrl).length;
  const consolidatedObservations = defaultConsolidatedObservations(hvacList, lightList, solarList, forkliftList, hotWaterList);
  const executiveSummary = defaultExecutiveSummary(args);
  const knownZoneIds = new Set(zones.map((zone) => zone.id));
  const representedZones = new Set<string>();
  [
    ...zones.filter((zone) => photosForEntity(photos, zone.id, zone.photoDescs).length > 0).map((zone) => zone.id),
    ...msList.map((item) => item.zoneId),
    ...addlSbList.map((item) => item.zoneId),
    ...hvacList.map((item) => item.zoneId),
    ...lightList.map((item) => item.zoneId),
    ...solarList.map((item) => item.zoneId),
    ...forkliftList.map((item) => item.zoneId),
    ...hotWaterList.map((item) => item.zoneId),
    ...genWaterList.map((item) => item.zoneId),
    ...genElecList.map((item) => item.zoneId),
  ].forEach((zoneId) => representedZones.add(zoneId && knownZoneIds.has(zoneId) ? zoneId : '__unzoned__'));
  const selectedZoneCount = representedZones.size;

  const statCells = [
    { count: selectedZoneCount, label: 'Zones', always: true },
    { count: totalPhotos, label: 'Photos', always: true },
    { count: msList.length + addlSbList.length, label: 'Switchboards' },
    { count: hvacList.length, label: 'HVAC' },
    { count: lightList.length, label: 'Lighting' },
    { count: solarList.length, label: 'Solar PV' },
    { count: forkliftList.length, label: 'Forklift' },
    { count: hotWaterList.length, label: 'Hot Water' },
    { count: genWaterList.length + genElecList.length, label: 'General' },
    { count: totalEquipment, label: 'Total', always: true },
  ]
    .filter((stat) => stat.always || stat.count > 0)
    .map((stat) => statPill(stat.count, stat.label))
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>${buildCss()}</style></head>
<body>
<template data-pdf-header data-brand="ENERGY AUDIT REPORT" data-title="${esc(audit.siteName)} &#8212; ${modeLabel}"></template>
<template data-pdf-footer data-left="CONFIDENTIAL" data-right="${modeLabel} &#183; Generated ${genDate}"></template>
<table class="doc-table">
  <thead>
    <tr><td class="hdr-cell">
      <div class="hdr-inner">
        <div class="hdr-brand"><span class="hdr-brand-title">Energy Audit Report</span></div>
        <div class="hdr-sep"><div class="hdr-sep-line"></div></div>
        <div class="hdr-report">${esc(audit.siteName)} &mdash; ${modeLabel}</div>
      </div>
    </td></tr>
  </thead>
  <tfoot>
    <tr><td class="ftr-cell">
      <div class="ftr-inner">
        <div class="ftr-left">Confidential</div>
        <div class="ftr-right">${modeLabel} &nbsp;·&nbsp; Generated ${genDate}</div>
      </div>
    </td></tr>
  </tfoot>
  <tbody>
    <tr><td class="content-cell">

      ${options.includeIntro === false ? '' : `
      <div class="cover">
        <div class="cover-eyebrow">Energy Audit Report &nbsp;·&nbsp; ${modeLabel}</div>
        <div class="cover-brand">
          <div class="cover-brand-label">Audit by</div>
          <img class="cover-brand-logo" src="${brandLogo}" alt="Sustainability Wise" />
        </div>
        <div class="cover-meta">
          <div class="cover-meta-row">
            <div class="cm"><div class="cml">Audit Site</div><div class="cmv">${esc(audit.siteName)}</div></div>
            <div class="cm"><div class="cml">Inspector</div><div class="cmv">${esc(audit.inspectorName)}</div></div>
          </div>
          <div class="cover-meta-row">
            <div class="cm"><div class="cml">Date of Audit</div><div class="cmv">${fmtDate(audit.auditDate)}</div></div>
            <div class="cm"><div class="cml">Status</div><div class="cmv">${statusLabel}</div></div>
          </div>
          <div class="cover-meta-row">
            <div class="cm"><div class="cml">Site Address</div><div class="cmv">${esc(audit.siteAddress)}</div></div>
            <div class="cm"><div class="cml">Report Type</div><div class="cmv">${modeLabel}</div></div>
          </div>
        </div>
      </div>

      <div class="exec-title">Executive Summary</div>
      <div class="exec-mode">${modeLabel}</div>
      ${executiveSummary ? `<div class="exec-copy">${formatText(executiveSummary)}</div>` : ''}
      <div class="stats"><div class="stats-row">${statCells}</div></div>
      ${options.introNoticeHtml ?? ''}
      `}

      ${mode === 'by-zone'
        ? byZoneBody(args) + observationsBody(hvacList, lightList, solarList, forkliftList, hotWaterList, consolidatedObservations)
        : byEquipmentBody(args)}

      ${options.includeEnd === false ? '' : buildAuditEndBlock(args)}

    </td></tr>
  </tbody>
</table>
</body></html>`;
}

function photoCountForEntities(photos: PhotoRow[], entityIds: Set<string>): number {
  return photos.filter((photo) => entityIds.has(photo.entityId) && photo.remoteUrl).length;
}

function photosForEntities(photos: PhotoRow[], entityIds: Set<string>): PhotoRow[] {
  return photos.filter((photo) => entityIds.has(photo.entityId));
}

function emptyBodyArgs(args: BodyArgs): BodyArgs {
  return {
    ...args,
    zones: [],
    photos: [],
    msList: [],
    addlSbList: [],
    hvacList: [],
    lightList: [],
    solarList: [],
    forkliftList: [],
    hotWaterList: [],
    genWaterList: [],
    genElecList: [],
  };
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

function buildZoneChunk(args: BodyArgs, scopedPhotos: PhotoRow[], zones: Array<typeof eaZones.$inferSelect>): BodyArgs {
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const entityIds = new Set<string>(zones.map((zone) => zone.id));
  const byZone = <T extends EquipmentItem>(items: T[]) => items.filter((item) => {
    if (!zoneIds.has(item.zoneId)) return false;
    entityIds.add(item.id);
    return true;
  });
  const msList = byZone(args.msList);
  const addlSbList = byZone(args.addlSbList);
  const hvacList = byZone(args.hvacList);
  const lightList = byZone(args.lightList);
  const solarList = byZone(args.solarList);
  const forkliftList = byZone(args.forkliftList);
  const hotWaterList = byZone(args.hotWaterList);
  const genWaterList = byZone(args.genWaterList);
  const genElecList = byZone(args.genElecList);
  return {
    ...emptyBodyArgs(args),
    zones,
    photos: photosForEntities(scopedPhotos, entityIds),
    msList,
    addlSbList,
    hvacList,
    lightList,
    solarList,
    forkliftList,
    hotWaterList,
    genWaterList,
    genElecList,
  };
}

function buildEquipmentChunk<T extends EquipmentItem>(
  args: BodyArgs,
  scopedPhotos: PhotoRow[],
  key: 'msList' | 'addlSbList' | 'hvacList' | 'lightList' | 'solarList' | 'forkliftList' | 'hotWaterList' | 'genWaterList' | 'genElecList',
  items: T[],
): BodyArgs {
  const entityIds = new Set(items.map((item) => item.id));
  return {
    ...emptyBodyArgs(args),
    zones: args.zones,
    photos: photosForEntities(scopedPhotos, entityIds),
    [key]: items,
  } as BodyArgs;
}

function buildInlineEcoAuditChunks(args: BodyArgs, scopedPhotos: PhotoRow[]): BodyArgs[] {
  if (args.mode === 'by-zone') {
    const knownZoneIds = new Set(args.zones.map((zone) => zone.id));
    const zoneChunks = splitByPhotoTarget(args.zones, (zone) => {
      const entityIds = new Set<string>([
        zone.id,
        ...args.msList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.addlSbList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.hvacList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.lightList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.solarList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.forkliftList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.hotWaterList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.genWaterList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
        ...args.genElecList.filter((item) => item.zoneId === zone.id).map((item) => item.id),
      ]);
      return photoCountForEntities(scopedPhotos, entityIds);
    });
    const chunks = zoneChunks.map((zones) => buildZoneChunk(args, scopedPhotos, zones));
    const unzonedMs = args.msList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedAddl = args.addlSbList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedHvac = args.hvacList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedLight = args.lightList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedSolar = args.solarList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedForklift = args.forkliftList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedHotWater = args.hotWaterList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedGenWater = args.genWaterList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedGenElec = args.genElecList.filter((item) => !knownZoneIds.has(item.zoneId));
    const unzonedEntityIds = new Set([
      ...unzonedMs,
      ...unzonedAddl,
      ...unzonedHvac,
      ...unzonedLight,
      ...unzonedSolar,
      ...unzonedForklift,
      ...unzonedHotWater,
      ...unzonedGenWater,
      ...unzonedGenElec,
    ].map((item) => item.id));
    if (unzonedEntityIds.size > 0) {
      chunks.push({
        ...emptyBodyArgs(args),
        zones: [],
        photos: photosForEntities(scopedPhotos, unzonedEntityIds),
        msList: unzonedMs,
        addlSbList: unzonedAddl,
        hvacList: unzonedHvac,
        lightList: unzonedLight,
        solarList: unzonedSolar,
        forkliftList: unzonedForklift,
        hotWaterList: unzonedHotWater,
        genWaterList: unzonedGenWater,
        genElecList: unzonedGenElec,
      });
    }
    return chunks;
  }

  const chunks: BodyArgs[] = [];
  const zonePhotoZones = args.zones.filter((zone) => photosForEntity(scopedPhotos, zone.id, zone.photoDescs).length > 0);
  for (const zones of splitByPhotoTarget(zonePhotoZones, (zone) => photosForEntity(scopedPhotos, zone.id, zone.photoDescs).length)) {
    const entityIds = new Set(zones.map((zone) => zone.id));
    chunks.push({ ...emptyBodyArgs(args), zones, photos: photosForEntities(scopedPhotos, entityIds) });
  }

  const addEquipmentChunks = <T extends EquipmentItem>(
    key: Parameters<typeof buildEquipmentChunk<T>>[2],
    items: T[],
  ) => {
    for (const part of splitByPhotoTarget(items, (item) => photoCountForEntities(scopedPhotos, new Set([item.id])))) {
      chunks.push(buildEquipmentChunk(args, scopedPhotos, key, part));
    }
  };

  addEquipmentChunks('msList', args.msList);
  addEquipmentChunks('addlSbList', args.addlSbList);
  addEquipmentChunks('hvacList', args.hvacList);
  addEquipmentChunks('lightList', args.lightList);
  addEquipmentChunks('solarList', args.solarList);
  addEquipmentChunks('forkliftList', args.forkliftList);
  addEquipmentChunks('hotWaterList', args.hotWaterList);
  addEquipmentChunks('genWaterList', args.genWaterList);
  addEquipmentChunks('genElecList', args.genElecList);

  return chunks.length > 0 ? chunks : [emptyBodyArgs(args)];
}

async function renderEcoAuditPdf(args: BodyArgs, scopedPhotos: PhotoRow[]): Promise<Buffer> {
  if (!shouldUsePhotoAppendix(scopedPhotos)) {
    const compressedPhotos = await prepareCompressedPdfPhotos(scopedPhotos);
    return renderPdf(buildAuditHtml({ ...args, photos: compressedPhotos }));
  }

  console.info('[pdf] Using chunked EcoAudit inline render', {
    auditId: args.audit.id,
    photoCount: scopedPhotos.length,
    rawBytes: totalPhotoBytes(scopedPhotos),
    chunkSize: PDF_INLINE_CHUNK_PHOTO_TARGET,
  });

  const chunks = buildInlineEcoAuditChunks(args, scopedPhotos);
  const pdfParts: Buffer[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const compressedPhotos = await prepareCompressedPdfPhotos(chunk.photos);
    pdfParts.push(await renderPdf(buildAuditHtml(
      { ...chunk, photos: compressedPhotos },
      {
        includeIntro: index === 0,
        includeEnd: index === chunks.length - 1,
      },
    )));
  }

  return mergePdfBuffers(pdfParts);
}

// ── DB helpers ────────────────────────────────────────────────────────────────────
function zoneScopedWhere<T extends { auditId: unknown; deletedAt: unknown; zoneId: unknown }>(
  table: T,
  auditId: string,
  selectedZoneIds: string[],
  restrictToZones: boolean,
) {
  const conditions = [
    eq(table.auditId as never, auditId),
    isNull(table.deletedAt as never),
  ];
  if (restrictToZones) {
    if (selectedZoneIds.length === 0) {
      conditions.push(eq(table.zoneId as never, '__no_matching_zone__'));
      return and(...conditions);
    }
    conditions.push(inArray(table.zoneId as never, selectedZoneIds));
  }
  return and(...conditions);
}

// ── Route handler ─────────────────────────────────────────────────────────────────
async function handleEcoAuditPdf(request: FastifyRequest, reply: FastifyReply) {
  const { auditId } = request.params as { auditId: string };
  const body = (request.body ?? {}) as { zoneIds?: string[]; mode?: 'by-equipment' | 'by-zone' };
  const mode = body.mode === 'by-zone' ? 'by-zone' : 'by-equipment';
  const requestedZoneIds = Array.isArray(body.zoneIds) ? body.zoneIds.filter(Boolean) : [];

  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
  const foundAudit = assertFound(audit, 'Audit');
  assertAuditAccess(foundAudit, request.user);
  await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId, actor: request.user });

  const zoneConditions = [eq(eaZones.auditId, auditId), isNull(eaZones.deletedAt)];
  if (requestedZoneIds.length > 0) {
    zoneConditions.push(inArray(eaZones.id, requestedZoneIds));
  }

  const zones = await db.select().from(eaZones).where(and(...zoneConditions));
  const selectedZoneIds = requestedZoneIds.length > 0 ? zones.map((zone) => zone.id) : [];
  const restrictToZones = requestedZoneIds.length > 0;

  const [
    mainSwitchboards,
    additionalSwitchboards,
    hvacUnits,
    lightingSystems,
    solarPv,
    forkliftChargers,
    hotWaterSystems,
    generalWater,
    generalElectricity,
    photos,
  ] = await Promise.all([
    db.select().from(eaMainSwitchboards).where(zoneScopedWhere(eaMainSwitchboards, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaAdditionalSwitchboards).where(zoneScopedWhere(eaAdditionalSwitchboards, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaHvacUnits).where(zoneScopedWhere(eaHvacUnits, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaLightingSystems).where(zoneScopedWhere(eaLightingSystems, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaSolarPv).where(zoneScopedWhere(eaSolarPv, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaForkliftChargers).where(zoneScopedWhere(eaForkliftChargers, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaHotWaterSystems).where(zoneScopedWhere(eaHotWaterSystems, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaGeneralWater).where(zoneScopedWhere(eaGeneralWater, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaGeneralElectricity).where(zoneScopedWhere(eaGeneralElectricity, auditId, selectedZoneIds, restrictToZones)),
    loadPhotosForParent({ app: 'ecoaudit', parentId: auditId }),
  ]);

  const allowedPhotoEntityIds = new Set([
    foundAudit.id,
    ...zones.map((zone) => zone.id),
    ...mainSwitchboards.map((x) => x.id),
    ...additionalSwitchboards.map((x) => x.id),
    ...hvacUnits.map((x) => x.id),
    ...lightingSystems.map((x) => x.id),
    ...solarPv.map((x) => x.id),
    ...forkliftChargers.map((x) => x.id),
    ...hotWaterSystems.map((x) => x.id),
    ...generalWater.map((x) => x.id),
    ...generalElectricity.map((x) => x.id),
  ]);
  const scopedPhotos = restrictToZones
    ? photos.filter((photo) => allowedPhotoEntityIds.has(photo.entityId))
    : photos;

  const brandLogo = await loadBrandLogo();
  const genDate = fmtDate(new Date().toISOString());

  const pdf = await enqueueExportTask(() => renderEcoAuditPdf({
    audit: foundAudit,
    zones,
    photos: [],
    mode,
    brandLogo,
    genDate,
    msList: mainSwitchboards as unknown as EquipmentItem[],
    addlSbList: additionalSwitchboards as unknown as EquipmentItem[],
    hvacList: hvacUnits as unknown as EquipmentItem[],
    lightList: lightingSystems as unknown as EquipmentItem[],
    solarList: solarPv as unknown as EquipmentItem[],
    forkliftList: forkliftChargers as unknown as EquipmentItem[],
    hotWaterList: hotWaterSystems as unknown as EquipmentItem[],
    genWaterList: generalWater as unknown as EquipmentItem[],
    genElecList: generalElectricity as unknown as EquipmentItem[],
  }, scopedPhotos));
  if (pdf.byteLength > MAX_PDF_BYTES) {
    console.warn('[pdf] EcoAudit PDF exceeded preferred size limit; returning generated PDF anyway', {
      auditId,
      actualSizeBytes: pdf.byteLength,
      preferredMaxSizeBytes: MAX_PDF_BYTES,
    });
  }

  const storageKey = makePdfStorageKeyFromName({
    app: 'ecoaudit',
    parentName: foundAudit.siteName,
    fieldName: 'audit-pdf',
    sessionId: randomUUID(),
    filename: 'audit-report.pdf',
  });
  await writeLocalFile(storageKey, pdf);
  const remoteUrl = publicFileUrl(storageKey);
  await mirrorPdfToOneDrive({
    app: 'ecoaudit',
    parentId: auditId,
    parentName: foundAudit.siteName,
    filename: `${foundAudit.siteName} - Audit Report.pdf`,
    storageKey,
    body: pdf,
    logger: request.log,
  });

  await db
    .update(eaAudits)
    .set({ reportPdfLocalPath: storageKey, reportPdfRemoteUrl: remoteUrl, updatedAt: new Date() })
    .where(eq(eaAudits.id, auditId));

  return reply
    .header('Content-Disposition', `attachment; filename="ecoaudit-${auditId}.pdf"`)
    .header('Content-Length', String(pdf.byteLength))
    .type('application/pdf')
    .send(pdf);
}

// ── Async job runner ──────────────────────────────────────────────────────────────
export async function runEcoAuditPdfJob(
  auditId: string,
  mode: 'by-equipment' | 'by-zone',
  zoneIds: string[],
  onPhase?: (phase: string) => void | Promise<void>,
): Promise<{ storageKey: string; remoteUrl: string }> {
  await onPhase?.('Fetching audit data…');

  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
  if (!audit) throw new Error('Audit not found');
  // Background jobs have no authenticated actor. They may remap an existing
  // trusted grant, but reconciliation cannot create a new generic grant here.
  await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId });

  const requestedZoneIds = zoneIds.filter(Boolean);
  const zoneConditions: ReturnType<typeof eq>[] = [eq(eaZones.auditId, auditId), isNull(eaZones.deletedAt)];
  if (requestedZoneIds.length > 0) {
    zoneConditions.push(inArray(eaZones.id, requestedZoneIds));
  }
  const zones = await db.select().from(eaZones).where(and(...zoneConditions));
  const selectedZoneIds = requestedZoneIds.length > 0 ? zones.map((z) => z.id) : [];
  const restrictToZones = requestedZoneIds.length > 0;

  const [
    mainSwitchboards,
    additionalSwitchboards,
    hvacUnits,
    lightingSystems,
    solarPv,
    forkliftChargers,
    hotWaterSystems,
    generalWater,
    generalElectricity,
    photos,
  ] = await Promise.all([
    db.select().from(eaMainSwitchboards).where(zoneScopedWhere(eaMainSwitchboards, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaAdditionalSwitchboards).where(zoneScopedWhere(eaAdditionalSwitchboards, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaHvacUnits).where(zoneScopedWhere(eaHvacUnits, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaLightingSystems).where(zoneScopedWhere(eaLightingSystems, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaSolarPv).where(zoneScopedWhere(eaSolarPv, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaForkliftChargers).where(zoneScopedWhere(eaForkliftChargers, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaHotWaterSystems).where(zoneScopedWhere(eaHotWaterSystems, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaGeneralWater).where(zoneScopedWhere(eaGeneralWater, auditId, selectedZoneIds, restrictToZones)),
    db.select().from(eaGeneralElectricity).where(zoneScopedWhere(eaGeneralElectricity, auditId, selectedZoneIds, restrictToZones)),
    loadPhotosForParent({ app: 'ecoaudit', parentId: auditId }),
  ]);

  const allowedPhotoEntityIds = new Set([
    audit.id,
    ...zones.map((z) => z.id),
    ...mainSwitchboards.map((x) => x.id),
    ...additionalSwitchboards.map((x) => x.id),
    ...hvacUnits.map((x) => x.id),
    ...lightingSystems.map((x) => x.id),
    ...solarPv.map((x) => x.id),
    ...forkliftChargers.map((x) => x.id),
    ...hotWaterSystems.map((x) => x.id),
    ...generalWater.map((x) => x.id),
    ...generalElectricity.map((x) => x.id),
  ]);
  const scopedPhotos = restrictToZones
    ? photos.filter((p) => allowedPhotoEntityIds.has(p.entityId))
    : photos;

  const brandLogo = await loadBrandLogo();
  const genDate = fmtDate(new Date().toISOString());

  await onPhase?.(`Rendering PDF (${scopedPhotos.length} photo${scopedPhotos.length !== 1 ? 's' : ''})…`);

  const pdf = await renderEcoAuditPdf({
    audit,
    zones,
    photos: [],
    mode,
    brandLogo,
    genDate,
    msList: mainSwitchboards as unknown as EquipmentItem[],
    addlSbList: additionalSwitchboards as unknown as EquipmentItem[],
    hvacList: hvacUnits as unknown as EquipmentItem[],
    lightList: lightingSystems as unknown as EquipmentItem[],
    solarList: solarPv as unknown as EquipmentItem[],
    forkliftList: forkliftChargers as unknown as EquipmentItem[],
    hotWaterList: hotWaterSystems as unknown as EquipmentItem[],
    genWaterList: generalWater as unknown as EquipmentItem[],
    genElecList: generalElectricity as unknown as EquipmentItem[],
  }, scopedPhotos);

  if (pdf.byteLength > MAX_PDF_BYTES) {
    console.warn('[pdf] EcoAudit PDF exceeded preferred size limit; saving generated PDF anyway', {
      auditId,
      actualSizeBytes: pdf.byteLength,
      preferredMaxSizeBytes: MAX_PDF_BYTES,
    });
  }

  await onPhase?.('Saving PDF…');

  const storageKey = makePdfStorageKeyFromName({
    app: 'ecoaudit',
    parentName: audit.siteName,
    fieldName: 'audit-pdf',
    sessionId: randomUUID(),
    filename: 'audit-report.pdf',
  });
  await writeLocalFile(storageKey, pdf);
  const remoteUrl = publicFileUrl(storageKey);
  await mirrorPdfToOneDrive({
    app: 'ecoaudit',
    parentId: auditId,
    parentName: audit.siteName,
    filename: `${audit.siteName} - Audit Report.pdf`,
    storageKey,
    body: pdf,
  });

  await db
    .update(eaAudits)
    .set({ reportPdfLocalPath: storageKey, reportPdfRemoteUrl: remoteUrl, updatedAt: new Date() })
    .where(eq(eaAudits.id, auditId));

  return { storageKey, remoteUrl };
}

async function runEcoAuditPdfJobInBackground(
  jobId: string,
  auditId: string,
  mode: 'by-equipment' | 'by-zone',
  zoneIds: string[],
): Promise<void> {
  try {
    await markJobRunning(jobId, 'Starting…');
    const { storageKey, remoteUrl } = await runEcoAuditPdfJob(
      auditId,
      mode,
      zoneIds,
      (phase) => updateJobPhase(jobId, phase),
    );
    await completeJob(jobId, remoteUrl, storageKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(jobId, message);
    console.error('[pdf-job] EcoAudit job failed', { jobId, auditId, error: message });
  }
}

async function handleEcoAuditPdfJobCreate(request: FastifyRequest, reply: FastifyReply) {
  const { auditId } = request.params as { auditId: string };
  const body = (request.body ?? {}) as { zoneIds?: string[]; mode?: 'by-equipment' | 'by-zone' };
  const mode = body.mode === 'by-zone' ? 'by-zone' : 'by-equipment';
  const zoneIds = Array.isArray(body.zoneIds) ? body.zoneIds.filter(Boolean) : [];

  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
  const foundAudit = assertFound(audit, 'Audit');
  assertAuditAccess(foundAudit, request.user);
  await reconcilePhotoCopyReferencesForParent({
    app: 'ecoaudit',
    parentId: auditId,
    actor: request.user,
  });

  const params: ExportJobParams = {
    artifactType: 'pdf',
    filename: `${sanitizeStorageSegment(foundAudit.siteName)}-report.pdf`,
    contentType: 'application/pdf',
    mode,
    zoneIds,
  };
  const activeJob = await findActiveExportJob({
    app: 'ecoaudit',
    entityId: auditId,
    userId: request.user.userId,
    params,
  });
  if (activeJob) return reply.status(202).send({ jobId: activeJob.id, reused: true });

  const jobId = randomUUID();
  await db.insert(pdfJobs).values({
    id: jobId,
    app: 'ecoaudit',
    entityId: auditId,
    entityType: 'audit',
    userId: request.user.userId,
    params,
    status: 'queued',
    phase: 'Queued…',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  void enqueueExportTask(
    () => runEcoAuditPdfJobInBackground(jobId, auditId, mode, zoneIds),
  ).catch((error) => {
    console.error('[pdf-job] EcoAudit queue failed', {
      jobId,
      auditId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return reply.status(202).send({ jobId });
}

const reportPdfRoute: RouteShorthandOptions = {
  schema: {
    tags: ['EcoAudit PDF'],
    summary: 'Generate an EcoAudit report PDF',
    description: 'Builds a server-side PDF from an audit, its zones, equipment records, and synced photos. Supports by-equipment and by-zone layouts.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['auditId'],
      properties: { auditId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['by-equipment', 'by-zone'], default: 'by-equipment' },
        zoneIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
};

export async function eaPdfRoutes(app: FastifyInstance): Promise<void> {
  app.post('/audits/:auditId/report/pdf', reportPdfRoute, handleEcoAuditPdf);

  app.post('/audits/:auditId/report/pdf/jobs', {
    schema: {
      tags: ['EcoAudit PDF'],
      summary: 'Start an async EcoAudit PDF generation job',
      description: 'Queues a background PDF generation job and returns a jobId immediately. Poll GET /v1/pdf/jobs/:jobId for progress.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['auditId'],
        properties: { auditId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['by-equipment', 'by-zone'], default: 'by-equipment' },
          zoneIds: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: { jobId: { type: 'string' } },
        },
      },
    },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, handleEcoAuditPdfJobCreate);

  app.post('/audits/:auditId/site-pack/pdf', {
    ...reportPdfRoute,
    schema: {
      ...reportPdfRoute.schema,
      hide: true,
      summary: 'Generate an EcoAudit report PDF (legacy alias)',
    },
  }, handleEcoAuditPdf);
}
