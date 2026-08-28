import { eq } from 'drizzle-orm';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import {
  type ClientSiteMemoryExecutor,
  type ProductJobMemoryInput,
} from '../../services/clientSiteMemoryService.js';
import {
  prepareProductClientSite,
  rememberProductClientSite,
  type ProductClientSiteSnapshot,
} from '../productClientSiteMemory.js';
import type { JsonRecord } from './helpers.js';

function auditSnapshot(
  audit: typeof eaAudits.$inferSelect,
): ProductClientSiteSnapshot {
  return {
    clientName: audit.clientName,
    businessSiteId: audit.businessSiteId,
    siteName: audit.siteName,
    displayAddress: audit.siteAddress,
    locality: audit.siteLocality,
    state: audit.siteState,
    postcode: audit.sitePostcode,
    countryCode: audit.siteCountryCode,
    latitude: audit.siteLatitude,
    longitude: audit.siteLongitude,
    geocodingStatus: audit.siteGeocodeStatus,
    provider: audit.siteGeocodeProvider,
    placeId: audit.siteGeocodePlaceId,
    source: audit.siteAddressSource,
    fingerprint: audit.siteAddressFingerprint,
    geocodedAt: audit.siteGeocodedAt,
  };
}

function auditJobStatus(
  audit: typeof eaAudits.$inferSelect,
): ProductJobMemoryInput['status'] {
  if (audit.deletedAt) return 'cancelled';
  if (audit.status === 'Completed') return 'done';
  if (audit.startedAt || ['Started', 'In Progress', 'In progress'].includes(audit.status)) {
    return 'in_progress';
  }
  return 'planned';
}

export async function rememberEcoAuditClientSite(
  executor: ClientSiteMemoryExecutor,
  payload: JsonRecord,
  audit: typeof eaAudits.$inferSelect,
): Promise<{
  audit: typeof eaAudits.$inferSelect;
  clientId: string;
  clientSiteId: string;
  jobId: string | null;
}> {
  const snapshot = auditSnapshot(audit);
  const prepared = prepareProductClientSite(payload, snapshot);
  const remembered = await rememberProductClientSite(executor, {
    payload,
    current: snapshot,
    job: {
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: audit.id,
      jobType: 'ecoaudit',
      title: `${prepared.clientName} · ${prepared.siteName}`,
      status: auditJobStatus(audit),
      createdByUserId: audit.createdByUserId,
      detail: { kind: 'ecoaudit', auditId: audit.id },
    },
  });
  const columns = remembered.columns;
  const [updated] = await executor.update(eaAudits).set({
    clientName: columns.clientName,
    businessSiteId: columns.businessSiteId,
    siteName: columns.siteName,
    siteAddress: columns.displayAddress,
    siteLocality: columns.locality,
    siteState: columns.state,
    sitePostcode: columns.postcode,
    siteCountryCode: columns.countryCode,
    siteLatitude: columns.latitude,
    siteLongitude: columns.longitude,
    siteGeocodeStatus: columns.geocodingStatus,
    siteGeocodeProvider: columns.provider,
    siteGeocodePlaceId: columns.placeId,
    siteAddressSource: columns.source,
    siteAddressFingerprint: columns.fingerprint,
    siteGeocodedAt: columns.geocodedAt,
  }).where(eq(eaAudits.id, audit.id)).returning();
  if (!updated) throw new Error('EcoAudit client/site link was not persisted');
  return {
    audit: updated,
    clientId: remembered.memory.client.id,
    clientSiteId: remembered.memory.site.id,
    jobId: remembered.memory.jobId,
  };
}
