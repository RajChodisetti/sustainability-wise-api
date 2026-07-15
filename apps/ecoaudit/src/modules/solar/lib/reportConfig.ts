import type { RooftopAssessment } from '@solar/types/domain';

export type SitePackReportOptions = {
  includedAssessmentIds: Set<string>;
  includedPhotoUris: Set<string>;
  includeRagFramework: boolean;
  includeAppendix: boolean;
};

export type SitePackPhotoItem = {
  uri: string;
  label: string;
  assessmentId: string;
};

export type SitePackBuildingGroup = {
  assessmentId: string;
  buildingName: string;
  photos: SitePackPhotoItem[];
};

export function buildSitePackInventory(assessments: RooftopAssessment[]): SitePackBuildingGroup[] {
  return assessments.map((a) => {
    const photos: SitePackPhotoItem[] = [];
    if (a.aerialPhotoUri) photos.push({ uri: a.aerialPhotoUri, label: 'Aerial Photo', assessmentId: a.id });
    if (a.msbPhotoUri) photos.push({ uri: a.msbPhotoUri, label: 'MSB Photo', assessmentId: a.id });
    for (const [i, sb] of a.switchboards.entries()) {
      if (sb.photoUri) {
        photos.push({
          uri: sb.photoUri,
          label: sb.panelNameId ? `SB ${i + 1} — ${sb.panelNameId}` : `Switchboard ${i + 1} Photo`,
          assessmentId: a.id,
        });
      }
    }
    for (const [i, oc] of a.otherConsiderations.entries()) {
      for (const [j, u] of (oc.photoUris ?? []).entries()) {
        photos.push({
          uri: u,
          label: oc.issue ? `${oc.issue} — Photo ${j + 1}` : `Consideration ${i + 1} Photo ${j + 1}`,
          assessmentId: a.id,
        });
      }
    }
    for (const [i, u] of a.additionalPhotos.entries()) {
      photos.push({ uri: u, label: `Additional Photo ${i + 1}`, assessmentId: a.id });
    }
    return { assessmentId: a.id, buildingName: a.buildingIdName, photos };
  });
}

export function createDefaultReportOptions(assessments: RooftopAssessment[]): SitePackReportOptions {
  const includedAssessmentIds = new Set(assessments.map((a) => a.id));
  const inventory = buildSitePackInventory(assessments);
  const includedPhotoUris = new Set(inventory.flatMap((g) => g.photos.map((p) => p.uri)));
  return { includedAssessmentIds, includedPhotoUris, includeRagFramework: true, includeAppendix: true };
}

export function countIncludedPhotos(options: SitePackReportOptions, inventory: SitePackBuildingGroup[]): number {
  return inventory
    .filter((g) => options.includedAssessmentIds.has(g.assessmentId))
    .flatMap((g) => g.photos)
    .filter((p) => options.includedPhotoUris.has(p.uri))
    .length;
}
