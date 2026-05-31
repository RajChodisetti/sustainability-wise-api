import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { renderPdf } from '../../pdf/renderer.js';
import { makeLocalStorageKey, publicFileUrl, writeLocalFile } from '../../storage/localFiles.js';
import { assertFound, assertSiteAccess } from './helpers.js';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function valueRow(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function buildHtml(args: {
  site: typeof ssSites.$inferSelect;
  assessments: Array<typeof ssRooftopAssessments.$inferSelect>;
  photos: Array<typeof photoRegistry.$inferSelect>;
}): string {
  const assessmentHtml = args.assessments.map((assessment) => {
    const photos = args.photos
      .filter((photo) => photo.entityId === assessment.id && photo.remoteUrl)
      .map((photo) => `
        <figure>
          <img src="${escapeHtml(photo.remoteUrl)}" />
          <figcaption>${escapeHtml(photo.fieldName)}</figcaption>
        </figure>
      `)
      .join('');

    return `
      <section class="assessment">
        <h2>${escapeHtml(assessment.buildingIdName)}</h2>
        <table>
          ${valueRow('Viability', assessment.viabilityStatus)}
          ${valueRow('RAG Priority', assessment.ragPriority)}
          ${valueRow('Roof area total m2', assessment.roofAreaTotalM2)}
          ${valueRow('Usable roof area m2', assessment.roofAreaUsableM2)}
          ${valueRow('PV size kW DC', assessment.pvSizeKwDc)}
          ${valueRow('AC export kW', assessment.acExportKw)}
          ${valueRow('Roof material', assessment.roofMaterial)}
          ${valueRow('Roof condition', assessment.roofCondition)}
          ${valueRow('Structural feasibility', assessment.structuralFeasibility)}
          ${valueRow('Deal breaker reason', assessment.dealBreakerReason)}
          ${valueRow('Key assumptions / gaps', assessment.keyAssumptionsGaps)}
        </table>
        ${photos ? `<div class="photos">${photos}</div>` : ''}
      </section>
    `;
  }).join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { color: #172033; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.45; }
        h1 { color: #0f5132; font-size: 26px; margin: 0 0 6px; }
        h2 { color: #12394f; font-size: 18px; margin: 24px 0 10px; page-break-after: avoid; }
        .meta { color: #5b6577; margin-bottom: 18px; }
        table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; }
        th, td { border: 1px solid #d8dee8; padding: 7px 8px; text-align: left; vertical-align: top; }
        th { background: #f2f6f4; width: 34%; }
        .assessment { page-break-inside: avoid; }
        .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
        figure { margin: 0; border: 1px solid #d8dee8; padding: 6px; page-break-inside: avoid; }
        img { display: block; width: 100%; max-height: 240px; object-fit: contain; }
        figcaption { color: #5b6577; font-size: 10px; margin-top: 4px; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(args.site.siteName)} Site Pack</h1>
      <div class="meta">${escapeHtml(args.site.location)} ${args.site.dateOfAssessment ? `| ${escapeHtml(args.site.dateOfAssessment)}` : ''}</div>
      <table>
        ${valueRow('Document classification', args.site.documentClassification)}
        ${valueRow('Electrical infrastructure summary', args.site.electricalInfrastructureSummary)}
        ${valueRow('Known constraints', args.site.knownConstraints)}
        ${valueRow('Load profile / metering summary', args.site.loadProfileMeteringSummary)}
        ${valueRow('PPA asset demarcation', args.site.ppaAssetDemarcation)}
        ${valueRow('Appendix notes', args.site.appendixNotes)}
      </table>
      ${assessmentHtml}
    </body>
  </html>`;
}

export async function solarsensePdfRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sites/:siteId/site-pack/pdf', {
    schema: {
      tags: ['SolarSense PDF'],
      summary: 'Generate a SolarSense site pack PDF',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const body = request.body as { assessmentIds?: string[] };

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

    const pdf = await renderPdf(buildHtml({ site: foundSite, assessments, photos }));
    if (pdf.byteLength > MAX_PDF_BYTES) {
      return reply.status(413).send({
        error: 'Generated PDF exceeds the 50 MB limit',
        actualSizeBytes: pdf.byteLength,
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
