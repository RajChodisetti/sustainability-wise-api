import { eq } from 'drizzle-orm';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
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

function siteSnapshot(site: typeof ssSites.$inferSelect): ProductClientSiteSnapshot {
  return {
    clientName: site.clientName,
    businessSiteId: site.businessSiteId,
    siteName: site.siteName,
    displayAddress: site.location,
    locality: site.siteLocality,
    state: site.siteState,
    postcode: site.sitePostcode,
    countryCode: site.siteCountryCode,
    latitude: site.siteLatitude,
    longitude: site.siteLongitude,
    geocodingStatus: site.siteGeocodeStatus,
    provider: site.siteGeocodeProvider,
    placeId: site.siteGeocodePlaceId,
    source: site.siteAddressSource,
    fingerprint: site.siteAddressFingerprint,
    geocodedAt: site.siteGeocodedAt,
  };
}

function assessmentJobStatus(
  assessment: typeof ssRooftopAssessments.$inferSelect,
): ProductJobMemoryInput['status'] {
  if (assessment.deletedAt) return 'cancelled';
  return assessment.status === 'Completed' ? 'done' : 'planned';
}

export async function rememberSolarSiteClientSite(
  executor: ClientSiteMemoryExecutor,
  payload: JsonRecord,
  site: typeof ssSites.$inferSelect,
  assessment?: typeof ssRooftopAssessments.$inferSelect,
): Promise<{
  site: typeof ssSites.$inferSelect;
  clientId: string;
  clientSiteId: string;
  jobId: string | null;
}> {
  const snapshot = siteSnapshot(site);
  const prepared = prepareProductClientSite(payload, snapshot);
  const remembered = await rememberProductClientSite(executor, {
    payload,
    current: snapshot,
    job: assessment
      ? {
          sourceApp: 'solarsense',
          sourceType: 'assessment',
          sourceId: assessment.id,
          jobType: 'solarsense',
          title: `${prepared.siteName} · ${assessment.buildingIdName}`,
          status: assessmentJobStatus(assessment),
          createdByUserId: assessment.createdByUserId,
          detail: {
            kind: 'solarsense',
            assessmentId: assessment.id,
            buildingName: assessment.buildingIdName,
          },
        }
      : undefined,
  });
  const columns = remembered.columns;
  const [updated] = await executor.update(ssSites).set({
    clientName: columns.clientName,
    businessSiteId: columns.businessSiteId,
    siteName: columns.siteName,
    location: columns.displayAddress,
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
  }).where(eq(ssSites.id, site.id)).returning();
  if (!updated) throw new Error('SolarSense client/site link was not persisted');
  return {
    site: updated,
    clientId: remembered.memory.client.id,
    clientSiteId: remembered.memory.site.id,
    jobId: remembered.memory.jobId,
  };
}
