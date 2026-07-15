import type { RooftopAssessment, Site, Switchboard, OtherConsideration } from '@solar/types/domain';

function pick<T>(raw: Record<string, unknown>, camel: string, snake: string): T | undefined {
  if (raw[camel] !== undefined) return raw[camel] as T;
  if (raw[snake] !== undefined) return raw[snake] as T;
  return undefined;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

export function normalizeSite(raw: Record<string, unknown>): Site {
  return {
    id: String(raw.id ?? ''),
    serverId: pick(raw, 'serverId', 'server_id') as string | null | undefined,
    syncStatus: pick(raw, 'syncStatus', 'sync_status') as Site['syncStatus'],
    status: (pick(raw, 'status', 'status') as Site['status']) ?? 'Draft',
    syncEnabled: bool(pick(raw, 'syncEnabled', 'sync_enabled'), true),
    updatedAt: String(pick(raw, 'updatedAt', 'updated_at') ?? new Date().toISOString()),
    deletedAt: pick(raw, 'deletedAt', 'deleted_at') as string | null | undefined,
    siteName: String(pick(raw, 'siteName', 'site_name') ?? ''),
    location: pick(raw, 'location', 'location') as string | null | undefined,
    dateOfAssessment: pick(raw, 'dateOfAssessment', 'date_of_assessment') as string | null | undefined,
    documentClassification: pick(raw, 'documentClassification', 'document_classification') as string | null | undefined,
    electricalInfrastructureSummary: pick(raw, 'electricalInfrastructureSummary', 'electrical_infrastructure_summary') as string | null | undefined,
    knownConstraints: pick(raw, 'knownConstraints', 'known_constraints') as string | null | undefined,
    loadProfileMeteringSummary: pick(raw, 'loadProfileMeteringSummary', 'load_profile_metering_summary') as string | null | undefined,
    ppaAssetDemarcation: pick(raw, 'ppaAssetDemarcation', 'ppa_asset_demarcation') as string | null | undefined,
    appendixNotes: pick(raw, 'appendixNotes', 'appendix_notes') as string | null | undefined,
    appendixItems: parseJson(pick(raw, 'appendixItems', 'appendix_items'), []),
    reportPdfRemoteUrl: pick(raw, 'reportPdfRemoteUrl', 'report_pdf_remote_url') as string | null | undefined,
    createdByUserId: pick(raw, 'createdByUserId', 'created_by_user_id') as string | null | undefined,
    createdAt: String(pick(raw, 'createdAt', 'created_at') ?? new Date().toISOString()),
  };
}

export function normalizeAssessment(raw: Record<string, unknown>): RooftopAssessment {
  return {
    id: String(raw.id ?? ''),
    serverId: pick(raw, 'serverId', 'server_id') as string | null | undefined,
    syncStatus: pick(raw, 'syncStatus', 'sync_status') as RooftopAssessment['syncStatus'],
    status: (pick(raw, 'status', 'status') as RooftopAssessment['status']) ?? 'Draft',
    updatedAt: String(pick(raw, 'updatedAt', 'updated_at') ?? new Date().toISOString()),
    deletedAt: pick(raw, 'deletedAt', 'deleted_at') as string | null | undefined,
    siteId: pick(raw, 'siteId', 'site_id') as string | null | undefined,
    siteName: String(pick(raw, 'siteName', 'site_name') ?? ''),
    buildingIdName: String(pick(raw, 'buildingIdName', 'building_id_name') ?? ''),
    heritageStatus: pick(raw, 'heritageStatus', 'heritage_status') as string | null | undefined,
    heritageDealBreaker: bool(pick(raw, 'heritageDealBreaker', 'heritage_deal_breaker')),
    aerialPhotoUri: pick(raw, 'aerialPhotoUri', 'aerial_photo_uri') as string | null | undefined,
    roofAreaTotalM2: num(pick(raw, 'roofAreaTotalM2', 'roof_area_total_m2')),
    roofMaterial: pick(raw, 'roofMaterial', 'roof_material') as string | null | undefined,
    roofFramingType: pick(raw, 'roofFramingType', 'roof_framing_type') as string | null | undefined,
    roofPitchAngle: pick(raw, 'roofPitchAngle', 'roof_pitch_angle') as string | null | undefined,
    roofConstructionMaterial: pick(raw, 'roofConstructionMaterial', 'roof_construction_material') as string | null | undefined,
    asbestosFlag: bool(pick(raw, 'asbestosFlag', 'asbestos_flag')),
    roofCondition: pick(raw, 'roofCondition', 'roof_condition') as string | null | undefined,
    roofEstimatedAge: pick(raw, 'roofEstimatedAge', 'roof_estimated_age') as string | null | undefined,
    roofOrientationPrimary: pick(raw, 'roofOrientationPrimary', 'roof_orientation_primary') as string | null | undefined,
    roofShadingSources: pick(raw, 'roofShadingSources', 'roof_shading_sources') as string | null | undefined,
    roofShadingUsablePct: pick(raw, 'roofShadingUsablePct', 'roof_shading_usable_pct') as string | null | undefined,
    roofOrientationShading: pick(raw, 'roofOrientationShading', 'roof_orientation_shading') as string | null | undefined,
    structuralFeasibility: pick(raw, 'structuralFeasibility', 'structural_feasibility') as string | null | undefined,
    structuralRiskFlag: bool(pick(raw, 'structuralRiskFlag', 'structural_risk_flag')),
    roofAreaUsableM2: num(pick(raw, 'roofAreaUsableM2', 'roof_area_usable_m2')),
    pvSizeKwDc: num(pick(raw, 'pvSizeKwDc', 'pv_size_kw_dc')),
    acExportKw: num(pick(raw, 'acExportKw', 'ac_export_kw')),
    accessSafetyConstraints: pick(raw, 'accessSafetyConstraints', 'access_safety_constraints') as string | null | undefined,
    switchboards: parseJson<Switchboard[]>(pick(raw, 'switchboards', 'switchboards'), []),
    msbDetails: pick(raw, 'msbDetails', 'msb_details') as string | null | undefined,
    msbPhotoUri: pick(raw, 'msbPhotoUri', 'msb_photo_uri') as string | null | undefined,
    existingGeneration: pick(raw, 'existingGeneration', 'existing_generation') as string | null | undefined,
    distanceToConnectionM: num(pick(raw, 'distanceToConnectionM', 'distance_to_connection_m')),
    electricalPitsEntry: pick(raw, 'electricalPitsEntry', 'electrical_pits_entry') as string | null | undefined,
    inverterSiting: pick(raw, 'inverterSiting', 'inverter_siting') as string | null | undefined,
    transformerSupplyCapacity: pick(raw, 'transformerSupplyCapacity', 'transformer_supply_capacity') as string | null | undefined,
    dnspConstraints: pick(raw, 'dnspConstraints', 'dnsp_constraints') as string | null | undefined,
    loadProfileMetering: pick(raw, 'loadProfileMetering', 'load_profile_metering') as string | null | undefined,
    otherConsiderations: parseJson<OtherConsideration[]>(pick(raw, 'otherConsiderations', 'other_considerations'), []),
    siteRepFeedback: pick(raw, 'siteRepFeedback', 'site_rep_feedback') as string | null | undefined,
    viabilityStatus: pick(raw, 'viabilityStatus', 'viability_status') as string | null | undefined,
    dealBreakerReason: pick(raw, 'dealBreakerReason', 'deal_breaker_reason') as string | null | undefined,
    ragPriority: pick(raw, 'ragPriority', 'rag_priority') as string | null | undefined,
    keyAssumptionsGaps: pick(raw, 'keyAssumptionsGaps', 'key_assumptions_gaps') as string | null | undefined,
    additionalPhotos: parseJson<string[]>(pick(raw, 'additionalPhotos', 'additional_photos'), []),
    photoMetadata: parseJson<Record<string, unknown>>(pick(raw, 'photoMetadata', 'photo_metadata'), {}),
    createdByUserId: pick(raw, 'createdByUserId', 'created_by_user_id') as string | null | undefined,
    createdAt: String(pick(raw, 'createdAt', 'created_at') ?? new Date().toISOString()),
  };
}

export function unwrapList<T>(payload: unknown, normalizer: (raw: Record<string, unknown>) => T): T[] {
  if (Array.isArray(payload)) return payload.map((item) => normalizer(item as Record<string, unknown>));
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data.map((item) => normalizer(item as Record<string, unknown>));
    if (Array.isArray(obj.items)) return obj.items.map((item) => normalizer(item as Record<string, unknown>));
  }
  return [];
}
