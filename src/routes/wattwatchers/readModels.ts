export type FleetAccountReference = {
  id: string;
  code: string;
  name: string;
  isMaas: boolean;
  apiKeyConfigured: boolean;
  apiKeyUpdatedAt: Date | string | null;
};

export type BusinessClientReference = {
  id: string;
  name: string;
};

export type BusinessSiteReference = {
  id: string;
  name: string;
  address: string;
};

export type DevicePlacementReference = {
  source: 'field_installation' | 'maas_assignment' | 'meter_register';
  effectiveDate: string | null;
  businessClient: BusinessClientReference;
  site: BusinessSiteReference | null;
};

export type DevicePlacement = DevicePlacementReference & {
  deviceRole: 'current' | 'existing' | 'new';
  provenance: {
    assignmentId: string;
    sourceWorkbook: string;
    sourceSheet: string;
    sourceRow: number;
    manualCorrection?: boolean;
  } | null;
};

export type DevicePlacementResolution = {
  currentPlacement: DevicePlacementReference | null;
  placementConflict: boolean;
};

export type DeviceStatusSummary = {
  totalDevices: number;
  communicating: number;
  delayed: number;
  offline: number;
  inactive: number;
  unknown: number;
  notCollected: number;
  reportOffline: number;
};

type StatusSummaryInput = {
  /**
   * Collection rows can contain a forward-compatible provider status. Only
   * the five Fleet connectivity states below contribute to named counters.
   */
  status: string;
  fetchStatus?: string | null;
  reportOffline?: boolean | null;
};

function placementIdentity(placement: DevicePlacementReference): string {
  return `${placement.businessClient.id}\u0000${placement.site?.id ?? ''}`;
}

function assignmentOrder(left: DevicePlacement, right: DevicePlacement): number {
  if (left.source === 'meter_register' && right.source === 'meter_register') {
    const correctionOrder = Number(right.provenance?.manualCorrection === true)
      - Number(left.provenance?.manualCorrection === true);
    if (correctionOrder !== 0) return correctionOrder;
    const hasMeaningfulSite = (placement: DevicePlacement) => {
      const address = placement.site?.address.trim().toLocaleUpperCase('en-AU') ?? '';
      return address !== '' && address !== '0' && address !== 'NA' && address !== 'N/A';
    };
    const completenessOrder = Number(hasMeaningfulSite(right)) - Number(hasMeaningfulSite(left));
    if (completenessOrder !== 0) return completenessOrder;
  }
  const dateOrder = (right.effectiveDate ?? '').localeCompare(left.effectiveDate ?? '');
  if (dateOrder !== 0) return dateOrder;
  const rowOrder = (right.provenance?.sourceRow ?? -1) - (left.provenance?.sourceRow ?? -1);
  if (rowOrder !== 0) return rowOrder;
  const assignmentIdOrder = (left.provenance?.assignmentId ?? '').localeCompare(
    right.provenance?.assignmentId ?? '',
  );
  if (assignmentIdOrder !== 0) return assignmentIdOrder;
  return placementIdentity(left).localeCompare(placementIdentity(right));
}

export function sortDevicePlacements(placements: DevicePlacement[]): DevicePlacement[] {
  const sourcePriority: Record<DevicePlacement['source'], number> = {
    field_installation: 0,
    maas_assignment: 1,
    meter_register: 2,
  };
  return [...placements].sort((left, right) => {
    if (left.source !== right.source) {
      return sourcePriority[left.source] - sourcePriority[right.source];
    }
    return assignmentOrder(left, right);
  });
}

/** Prefer the most authoritative complete placement; incomplete evidence remains visible. */
export function resolveDevicePlacement(
  placements: DevicePlacement[],
): DevicePlacementResolution {
  const currentCandidates = sortDevicePlacements(
    placements.filter((placement) => placement.deviceRole === 'current'),
  );
  const completeField = currentCandidates.find((placement) => (
    placement.source === 'field_installation' && placement.site !== null
  ));
  const selected = completeField
    ?? currentCandidates.find((placement) => placement.site !== null)
    ?? currentCandidates[0]
    ?? null;
  return {
    currentPlacement: selected ? {
      source: selected.source,
      effectiveDate: selected.effectiveDate,
      businessClient: selected.businessClient,
      site: selected.site,
    } : null,
    placementConflict: new Set(currentCandidates.map(placementIdentity)).size > 1,
  };
}

export function summarizeDeviceStatuses(rows: StatusSummaryInput[]): DeviceStatusSummary {
  const count = (status: 'communicating' | 'delayed' | 'offline' | 'inactive' | 'unknown') => (
    rows.filter((row) => row.status === status).length
  );
  const knownStatuses = new Set(['communicating', 'delayed', 'offline', 'inactive', 'unknown']);
  return {
    totalDevices: rows.length,
    communicating: count('communicating'),
    delayed: count('delayed'),
    offline: count('offline'),
    inactive: count('inactive'),
    unknown: rows.filter((row) => (
      row.status === 'unknown' || !knownStatuses.has(row.status)
    )).length,
    notCollected: rows.filter((row) => row.fetchStatus === 'not_collected').length,
    reportOffline: rows.filter((row) => row.reportOffline === true).length,
  };
}

export function matchedRegisterRoles(
  row: {
    existingWattwatchersDeviceId: string | null;
    newWattwatchersDeviceId: string | null;
    currentWattwatchersDeviceId: string | null;
  },
  internalDeviceId: string,
): Array<'existing' | 'new' | 'current'> {
  const roles: Array<'existing' | 'new' | 'current'> = [];
  if (row.existingWattwatchersDeviceId === internalDeviceId) roles.push('existing');
  if (row.newWattwatchersDeviceId === internalDeviceId) roles.push('new');
  if (row.currentWattwatchersDeviceId === internalDeviceId) roles.push('current');
  return roles;
}
