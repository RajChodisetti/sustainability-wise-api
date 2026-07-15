import type { DashboardMetrics, RooftopAssessment, Site } from '@solar/types/domain';

export function computeDashboardMetrics(sites: Site[], assessments: RooftopAssessment[]): DashboardMetrics {
  const viable = assessments.filter((a) => a.viabilityStatus === 'Yes');
  const totalAcKw = viable.reduce((sum, a) => sum + (a.acExportKw ?? 0), 0);
  const totalPotentialAcKw = assessments.reduce((sum, a) => sum + (a.acExportKw ?? 0), 0);
  const siteNameById = new Map(sites.map((site) => [site.id, site.siteName]));
  const siteMap = new Map<string, { siteId: string | null; siteName: string; viableKw: number; buildingCount: number }>();

  for (const a of assessments) {
    const key = a.siteId ? `id:${a.siteId}` : `name:${a.siteName}`;
    const prev = siteMap.get(key) ?? {
      siteId: a.siteId ?? null,
      siteName: a.siteId ? (siteNameById.get(a.siteId) ?? a.siteName) : a.siteName,
      viableKw: 0,
      buildingCount: 0,
    };
    siteMap.set(key, {
      ...prev,
      viableKw: prev.viableKw + (a.viabilityStatus === 'Yes' ? (a.acExportKw ?? 0) : 0),
      buildingCount: prev.buildingCount + 1,
    });
  }

  return {
    siteCount: sites.length,
    assessmentCount: assessments.length,
    viableCount: viable.length,
    tbdCount: assessments.filter((a) => a.viabilityStatus === 'TBD').length,
    excludedCount: assessments.filter((a) => a.viabilityStatus === 'No').length,
    totalAcKw,
    totalPotentialAcKw,
    ragGreen: assessments.filter((a) => a.ragPriority === 'Green').length,
    ragAmber: assessments.filter((a) => a.ragPriority === 'Amber').length,
    ragRed: assessments.filter((a) => a.ragPriority === 'Red').length,
    siteCapacity: [...siteMap.values()],
  };
}
