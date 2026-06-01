import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { eaAudits, eaZones, eaHvacUnits, eaLightingSystems, eaSolarPv, eaMainSwitchboards } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { renderPdf } from '../../pdf/renderer.js';
import { makeLocalStorageKey, publicFileUrl, writeLocalFile } from '../../storage/localFiles.js';
import { assertFound, assertAuditAccess } from './helpers.js';

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function row(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
}

export async function eaPdfRoutes(app: FastifyInstance): Promise<void> {
  app.post('/audits/:auditId/site-pack/pdf', {
    schema: { tags: ['EcoAudit PDF'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const body = (request.body as { zoneIds?: string[] }) ?? {};

    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);

    const zones = await db.select().from(eaZones).where(and(eq(eaZones.auditId, auditId), isNull(eaZones.deletedAt)));
    const hvacUnits = await db.select().from(eaHvacUnits).where(and(eq(eaHvacUnits.auditId, auditId), isNull(eaHvacUnits.deletedAt)));
    const lighting = await db.select().from(eaLightingSystems).where(and(eq(eaLightingSystems.auditId, auditId), isNull(eaLightingSystems.deletedAt)));
    const solarPv = await db.select().from(eaSolarPv).where(and(eq(eaSolarPv.auditId, auditId), isNull(eaSolarPv.deletedAt)));
    const mainSwitchboards = await db.select().from(eaMainSwitchboards).where(and(eq(eaMainSwitchboards.auditId, auditId), isNull(eaMainSwitchboards.deletedAt)));
    const photos = await db.select().from(photoRegistry).where(and(eq(photoRegistry.app, 'ecoaudit'), eq(photoRegistry.parentId, auditId), eq(photoRegistry.status, 'confirmed')));

    const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
      body{color:#172033;font-family:Arial,sans-serif;font-size:12px;line-height:1.45}
      h1{color:#0a3d62;font-size:26px;margin:0 0 6px}h2{color:#12394f;font-size:18px;margin:20px 0 8px}
      .meta{color:#5b6577;margin-bottom:16px}table{border-collapse:collapse;width:100%;margin:8px 0 12px}
      th,td{border:1px solid #d8dee8;padding:7px 8px;text-align:left;vertical-align:top}th{background:#f0f7ee;width:34%}
      .photos{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
      figure{margin:0;border:1px solid #d8dee8;padding:6px}img{display:block;width:100%;max-height:220px;object-fit:contain}
      figcaption{color:#5b6577;font-size:10px;margin-top:4px}
    </style></head><body>
    <h1>${esc(audit.siteName)} — Energy Audit Report</h1>
    <div class="meta">${esc(audit.siteAddress)}${audit.auditDate ? ` | ${esc(audit.auditDate)}` : ''} | Inspector: ${esc(audit.inspectorName)}</div>
    <table>${row('Status', audit.status)}${row('Audit Date', audit.auditDate)}</table>

    <h2>Zones (${zones.length})</h2>
    ${zones.map(z => `<p><strong>${esc(z.zoneName)}</strong>${z.zoneDescription ? ` — ${esc(z.zoneDescription)}` : ''}</p>`).join('')}

    <h2>HVAC Units (${hvacUnits.length})</h2>
    ${hvacUnits.map(u => `<section><h3>${esc(u.unitName)}</h3><table>
      ${row('Type', u.type)}${row('Model', u.model)}${row('Heating kW', u.heatingCapacityKw)}${row('Cooling kW', u.coolingCapacityKw)}
      ${row('Energy Improvements', u.energyImprovementObservations)}
    </table></section>`).join('')}

    <h2>Lighting Systems (${lighting.length})</h2>
    ${lighting.map(l => `<section><h3>${esc(l.lightType)}</h3><table>
      ${row('Brand/Model', l.brandModel)}${row('Wattage', l.ratedWattage)}${row('Quantity', l.quantity)}
      ${row('Controls', l.controlsType)}${row('Energy Improvements', l.energyImprovementObservations)}
    </table></section>`).join('')}

    <h2>Solar PV (${solarPv.length})</h2>
    ${solarPv.map(s => `<section><table>
      ${row('System Size kW', s.systemSizeKw)}${row('Inverter', s.inverterBrandModel)}${row('Available Roof Space', s.availableRoofSpace)}
      ${row('Energy Improvements', s.energyImprovementObservations)}
    </table></section>`).join('')}

    <h2>Main Switchboards (${mainSwitchboards.length})</h2>
    ${mainSwitchboards.map(m => `<section><h3>${esc(m.name)}</h3><table>
      ${row('Location', m.location)}${row('Site NMI', m.siteNmi)}${row('Sub-circuits', m.subCircuitsDescription)}
    </table></section>`).join('')}

    ${photos.filter(p => p.remoteUrl).length > 0 ? `<h2>Photos</h2><div class="photos">
      ${photos.filter(p => p.remoteUrl).map(p => `<figure><img src="${esc(p.remoteUrl)}"/><figcaption>${esc(p.fieldName)}</figcaption></figure>`).join('')}
    </div>` : ''}
    </body></html>`;

    const pdf = await renderPdf(html);
    if (pdf.byteLength > 50 * 1024 * 1024) {
      return reply.status(413).send({ error: 'Generated PDF exceeds 50 MB limit', actualSizeBytes: pdf.byteLength });
    }

    const storageKey = makeLocalStorageKey({ app: 'ecoaudit', parentId: auditId, entityType: 'audit', entityId: auditId, fieldName: 'audit-pdf', sessionId: randomUUID(), filename: 'audit.pdf' });
    await writeLocalFile(storageKey, pdf);
    const remoteUrl = publicFileUrl(storageKey);
    await db.update(eaAudits).set({ reportPdfLocalPath: storageKey, reportPdfRemoteUrl: remoteUrl, updatedAt: new Date() }).where(eq(eaAudits.id, auditId));

    return reply
      .header('Content-Disposition', `attachment; filename="ecoaudit-${auditId}.pdf"`)
      .header('Content-Length', String(pdf.byteLength))
      .type('application/pdf')
      .send(pdf);
  });
}
