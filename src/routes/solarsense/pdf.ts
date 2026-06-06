import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { renderPdf } from '../../pdf/renderer.js';
import { prepareCompressedPdfPhotos } from '../../pdf/photoCompression.js';
import { makeLocalStorageKey, publicFileUrl, writeLocalFile } from '../../storage/localFiles.js';
import { assertFound, assertSiteAccess } from './helpers.js';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const templateUrl = new URL('../../pdf/templates/solarsense.html', import.meta.url);

let templatePromise: Promise<string> | null = null;

function loadTemplate(): Promise<string> {
  templatePromise ??= readFile(templateUrl, 'utf8');
  return templatePromise;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function valueRow(label: string, value: unknown): string {
  if (isBlank(value)) return '';
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(displayValue(value))}</td></tr>`;
}

function summaryCard(label: string, value: unknown): string {
  return `
    <div class="summary-card">
      <div class="summary-label">${escapeHtml(label)}</div>
      <div class="summary-value">${escapeHtml(displayValue(value))}</div>
    </div>
  `;
}

function badge(label: unknown, kind: 'green' | 'amber' | 'red' | 'gray' = 'gray'): string {
  if (isBlank(label)) return '';
  return `<span class="badge ${kind}">${escapeHtml(label)}</span>`;
}

function statusKind(value: unknown): 'green' | 'amber' | 'red' | 'gray' {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('viable') || text.includes('green') || text.includes('low')) return 'green';
  if (text.includes('red') || text.includes('not') || text.includes('deal')) return 'red';
  if (text.includes('amber') || text.includes('medium') || text.includes('risk')) return 'amber';
  return 'gray';
}

function sectionTable(rows: string): string {
  return rows.trim() ? `<table>${rows}</table>` : '<p class="empty">No details recorded.</p>';
}

function renderJsonList(title: string, value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const items = value.map((item) => {
    if (item && typeof item === 'object') {
      const fields = Object.entries(item as Record<string, unknown>)
        .filter(([, fieldValue]) => !isBlank(fieldValue))
        .map(([key, fieldValue]) => `${escapeHtml(key)}: ${escapeHtml(displayValue(fieldValue))}`)
        .join('<br/>');
      return `<li>${fields || escapeHtml(JSON.stringify(item))}</li>`;
    }
    return `<li>${escapeHtml(displayValue(item))}</li>`;
  }).join('');
  return items ? `<h3>${escapeHtml(title)}</h3><ul>${items}</ul>` : '';
}

function photosForEntity(
  photos: Array<typeof photoRegistry.$inferSelect>,
  entityId: string,
): string {
  const figures = photos
    .filter((photo) => photo.entityId === entityId && photo.remoteUrl)
    .map((photo) => {
      const caption = [photo.fieldName, photo.originalFilename].filter(Boolean).join(' - ');
      return `
        <figure>
          <img src="${escapeHtml(photo.remoteUrl)}" />
          <figcaption>${escapeHtml(caption)}</figcaption>
        </figure>
      `;
    })
    .join('');

  return figures ? `<div class="photos">${figures}</div>` : '';
}

function buildBody(args: {
  site: typeof ssSites.$inferSelect;
  assessments: Array<typeof ssRooftopAssessments.$inferSelect>;
  photos: Array<typeof photoRegistry.$inferSelect>;
}): string {
  const totalPv = args.assessments.reduce((sum, assessment) => sum + (assessment.pvSizeKwDc ?? 0), 0);
  const viableCount = args.assessments.filter((assessment) => {
    const status = String(assessment.viabilityStatus ?? '').toLowerCase();
    return status.includes('viable') && !status.includes('not');
  }).length;
  const dealBreakerCount = args.assessments.filter((assessment) =>
    assessment.heritageDealBreaker || assessment.structuralRiskFlag || !isBlank(assessment.dealBreakerReason),
  ).length;

  const assessmentHtml = args.assessments.map((assessment) => {
    const title = assessment.buildingIdName || assessment.siteName || 'Assessment';
    const rows = [
      valueRow('Viability', assessment.viabilityStatus),
      valueRow('RAG Priority', assessment.ragPriority),
      valueRow('Heritage Status', assessment.heritageStatus),
      valueRow('Heritage Deal Breaker', assessment.heritageDealBreaker),
      valueRow('Roof Area Total m2', assessment.roofAreaTotalM2),
      valueRow('Usable Roof Area m2', assessment.roofAreaUsableM2),
      valueRow('PV Size kW DC', assessment.pvSizeKwDc),
      valueRow('AC Export kW', assessment.acExportKw),
      valueRow('Roof Material', assessment.roofMaterial),
      valueRow('Roof Framing Type', assessment.roofFramingType),
      valueRow('Roof Pitch / Angle', assessment.roofPitchAngle),
      valueRow('Roof Construction', assessment.roofConstructionMaterial),
      valueRow('Asbestos Flag', assessment.asbestosFlag),
      valueRow('Roof Condition', assessment.roofCondition),
      valueRow('Estimated Roof Age', assessment.roofEstimatedAge),
      valueRow('Primary Orientation', assessment.roofOrientationPrimary),
      valueRow('Shading Sources', assessment.roofShadingSources),
      valueRow('Usable Shading %', assessment.roofShadingUsablePct),
      valueRow('Orientation / Shading', assessment.roofOrientationShading),
      valueRow('Structural Feasibility', assessment.structuralFeasibility),
      valueRow('Structural Risk Flag', assessment.structuralRiskFlag),
      valueRow('Access / Safety Constraints', assessment.accessSafetyConstraints),
      valueRow('MSB Details', assessment.msbDetails),
      valueRow('Existing Generation', assessment.existingGeneration),
      valueRow('Distance to Connection m', assessment.distanceToConnectionM),
      valueRow('Electrical Pits / Entry', assessment.electricalPitsEntry),
      valueRow('Inverter Siting', assessment.inverterSiting),
      valueRow('Transformer / Supply Capacity', assessment.transformerSupplyCapacity),
      valueRow('DNSP Constraints', assessment.dnspConstraints),
      valueRow('Load Profile / Metering', assessment.loadProfileMetering),
      valueRow('Site Rep Feedback', assessment.siteRepFeedback),
      valueRow('Deal Breaker Reason', assessment.dealBreakerReason),
      valueRow('Key Assumptions / Gaps', assessment.keyAssumptionsGaps),
    ].join('');

    return `
      <section class="assessment">
        <h2>
          ${escapeHtml(title)}
          ${badge(assessment.viabilityStatus, statusKind(assessment.viabilityStatus))}
          ${badge(assessment.ragPriority, statusKind(assessment.ragPriority))}
        </h2>
        ${sectionTable(rows)}
        ${renderJsonList('Switchboards', assessment.switchboards)}
        ${renderJsonList('Other Considerations', assessment.otherConsiderations)}
        ${photosForEntity(args.photos, assessment.id)}
      </section>
    `;
  }).join('');

  return `
    <section class="cover">
      <div class="eyebrow">SolarSense Site Pack</div>
      <h1>${escapeHtml(args.site.siteName)}</h1>
      <div class="meta">
        ${escapeHtml(args.site.location ?? '')}
        ${args.site.dateOfAssessment ? ` | ${escapeHtml(args.site.dateOfAssessment)}` : ''}
        ${args.site.documentClassification ? ` | ${escapeHtml(args.site.documentClassification)}` : ''}
      </div>
      <div class="summary-grid">
        ${summaryCard('Assessments', args.assessments.length)}
        ${summaryCard('Viable', viableCount)}
        ${summaryCard('Deal Breakers', dealBreakerCount)}
        ${summaryCard('PV kW DC', totalPv ? totalPv.toFixed(2) : '0')}
      </div>
    </section>

    <section>
      <h2>Site Overview</h2>
      ${sectionTable([
        valueRow('Document Classification', args.site.documentClassification),
        valueRow('Electrical Infrastructure Summary', args.site.electricalInfrastructureSummary),
        valueRow('Known Constraints', args.site.knownConstraints),
        valueRow('Load Profile / Metering Summary', args.site.loadProfileMeteringSummary),
        valueRow('PPA Asset Demarcation', args.site.ppaAssetDemarcation),
        valueRow('Appendix Notes', args.site.appendixNotes),
      ].join(''))}
      ${renderJsonList('Appendix Items', args.site.appendixItems)}
    </section>

    <section>
      <h2>Rooftop Assessments</h2>
      ${assessmentHtml || '<p class="empty">No assessments selected.</p>'}
    </section>
  `;
}

async function buildHtml(args: {
  site: typeof ssSites.$inferSelect;
  assessments: Array<typeof ssRooftopAssessments.$inferSelect>;
  photos: Array<typeof photoRegistry.$inferSelect>;
}): Promise<string> {
  const title = `${args.site.siteName} Site Pack`;
  const template = await loadTemplate();
  return template
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{BODY}}', buildBody(args));
}

export async function solarsensePdfRoutes(app: FastifyInstance): Promise<void> {
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
    const body = (request.body as { assessmentIds?: string[] }) ?? {};

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
    const compressedPhotos = await prepareCompressedPdfPhotos(photos);

    const pdf = await renderPdf(await buildHtml({ site: foundSite, assessments, photos: compressedPhotos }));
    if (pdf.byteLength > MAX_PDF_BYTES) {
      return reply.status(413).send({
        error: 'PDF too large to generate server-side',
        actualSizeBytes: pdf.byteLength,
        suggestion: 'Reduce the number of selected assessments or photos',
      });
    }

    const storageKey = makeLocalStorageKey({
      app: 'solarsense',
      parentId: siteId,
      entityType: 'site-pack',
      entityId: siteId,
      fieldName: 'site-pack-pdf',
      sessionId: randomUUID(),
      filename: 'site-pack.pdf',
    });
    await writeLocalFile(storageKey, pdf);
    const remoteUrl = publicFileUrl(storageKey);

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
