import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  ihElectricalAssets,
  ihFormSubmissions,
  ihInstallations,
  ihInventoryMeterMovements,
  ihInventoryMeters,
  ihMeterDevices,
  ihMeterHistoryEvents,
  ihZones,
} from '../../db/schema/installhub.js';
import { businessClients, businessJobs, businessSites } from '../../db/schema/shared.js';
import {
  wwClientCredentials,
  wwClients,
  wwDeviceClients,
  wwDeviceInstallationAssignments,
  wwDevices,
  wwMeterRegisterEntries,
  wwMeterRegisterImports,
} from '../../db/schema/wattwatchers.js';
import {
  matchedRegisterRoles,
  resolveDevicePlacement,
  sortDevicePlacements,
  type DevicePlacement,
  type FleetAccountReference,
} from './readModels.js';

export type FleetDeviceReference = {
  internalDeviceId: string;
  deviceId: string;
  label: string | null;
  model: string | null;
};

function dateValue(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function installationPaths(input: {
  id: string;
  meterId?: string | null;
  boardId?: string | null;
  zoneId?: string | null;
}) {
  const base = `/installhub/installations/${encodeURIComponent(input.id)}`;
  const meter = input.meterId && input.boardId && input.zoneId
    ? `${base}/zones/${encodeURIComponent(input.zoneId)}/boards/${encodeURIComponent(input.boardId)}/meters/${encodeURIComponent(input.meterId)}`
    : null;
  return {
    overview: base,
    electricalMap: `${base}/data#canonical-electrical-map`,
    report: `${base}/report`,
    clientReport: `${base}/client-report`,
    cloud: `${base}/cloud`,
    meter,
  };
}

function fieldFormPath(installationId: string, formId: string) {
  return `/installhub/installations/${encodeURIComponent(installationId)}`
    + `/forms/${encodeURIComponent(formId)}`;
}

export async function loadFleetAccountsByDevice(
  internalDeviceIds: string[],
): Promise<Map<string, FleetAccountReference[]>> {
  const result = new Map<string, FleetAccountReference[]>();
  if (internalDeviceIds.length === 0) return result;
  const rows = await db.select({
    internalDeviceId: wwDeviceClients.deviceId,
    id: wwClients.id,
    code: wwClients.code,
    name: wwClients.name,
    isMaas: wwClients.isMaas,
    credentialClientId: wwClientCredentials.clientId,
    apiKeyUpdatedAt: wwClientCredentials.updatedAt,
  }).from(wwDeviceClients)
    .innerJoin(wwClients, eq(wwClients.id, wwDeviceClients.clientId))
    .leftJoin(wwClientCredentials, eq(wwClientCredentials.clientId, wwClients.id))
    .where(and(
      inArray(wwDeviceClients.deviceId, internalDeviceIds),
      eq(wwDeviceClients.isCurrent, true),
    ))
    .orderBy(asc(wwClients.name), asc(wwClients.id));
  for (const row of rows) {
    const list = result.get(row.internalDeviceId) ?? [];
    list.push({
      id: row.id,
      code: row.code,
      name: row.name,
      isMaas: row.isMaas,
      apiKeyConfigured: row.credentialClientId !== null,
      apiKeyUpdatedAt: row.apiKeyUpdatedAt,
    });
    result.set(row.internalDeviceId, list);
  }
  return result;
}

export async function loadPlacementsByDevice(
  devices: FleetDeviceReference[],
): Promise<Map<string, DevicePlacement[]>> {
  const result = new Map<string, DevicePlacement[]>();
  if (devices.length === 0) return result;
  const internalIds = devices.map((device) => device.internalDeviceId);

  const assignments = await db.select({
    assignmentId: wwDeviceInstallationAssignments.id,
    sourceWorkbook: wwDeviceInstallationAssignments.sourceWorkbook,
    sourceSheet: wwDeviceInstallationAssignments.sourceSheet,
    sourceRow: wwDeviceInstallationAssignments.sourceRow,
    effectiveDate: wwDeviceInstallationAssignments.effectiveDate,
    existingDeviceId: wwDeviceInstallationAssignments.existingDeviceId,
    newDeviceId: wwDeviceInstallationAssignments.newDeviceId,
    currentDeviceId: wwDeviceInstallationAssignments.currentDeviceId,
    businessClientId: businessClients.id,
    businessClientName: businessClients.name,
    siteId: businessSites.id,
    siteName: businessSites.name,
    siteAddress: businessSites.address,
  }).from(wwDeviceInstallationAssignments)
    .innerJoin(
      businessClients,
      eq(businessClients.id, wwDeviceInstallationAssignments.businessClientId),
    )
    .leftJoin(businessSites, and(
      eq(businessSites.id, wwDeviceInstallationAssignments.businessSiteId),
      eq(businessSites.clientId, businessClients.id),
    ))
    .where(and(
      or(
        inArray(wwDeviceInstallationAssignments.currentDeviceId, internalIds),
        inArray(wwDeviceInstallationAssignments.existingDeviceId, internalIds),
        inArray(wwDeviceInstallationAssignments.newDeviceId, internalIds),
      ),
      eq(businessClients.companyKey, config.businessDirectory.companyKey),
      isNull(businessClients.mergedIntoClientId),
    ))
    .orderBy(
      desc(wwDeviceInstallationAssignments.effectiveDate),
      desc(wwDeviceInstallationAssignments.sourceRow),
      asc(wwDeviceInstallationAssignments.id),
    );

  for (const row of assignments) {
    const roles: Array<{ id: string | null; role: DevicePlacement['deviceRole'] }> = [
      { id: row.currentDeviceId, role: 'current' },
      { id: row.existingDeviceId, role: 'existing' },
      { id: row.newDeviceId, role: 'new' },
    ];
    for (const role of roles) {
      if (!role.id || !internalIds.includes(role.id)) continue;
      const list = result.get(role.id) ?? [];
      list.push({
        source: 'maas_assignment',
        effectiveDate: row.effectiveDate,
        businessClient: { id: row.businessClientId, name: row.businessClientName },
        site: row.siteId && row.siteName && row.siteAddress
          ? { id: row.siteId, name: row.siteName, address: row.siteAddress }
          : null,
        deviceRole: role.role,
        provenance: {
          assignmentId: row.assignmentId,
          sourceWorkbook: row.sourceWorkbook,
          sourceSheet: row.sourceSheet,
          sourceRow: row.sourceRow,
        },
      });
      result.set(role.id, list);
    }
  }

  const fieldPlacements = await db.select({
    internalDeviceId: wwDevices.id,
    businessClientId: businessClients.id,
    businessClientName: businessClients.name,
    siteId: businessSites.id,
    siteName: businessSites.name,
    siteAddress: businessSites.address,
    effectiveDate: ihInstallations.completedAt,
  }).from(ihInventoryMeters)
    .innerJoin(wwDevices, sql`upper(${wwDevices.deviceId}) = upper(${ihInventoryMeters.deviceId})`)
    .innerJoin(businessClients, eq(businessClients.id, ihInventoryMeters.businessClientId))
    .leftJoin(businessSites, and(
      eq(businessSites.id, ihInventoryMeters.businessSiteId),
      eq(businessSites.clientId, businessClients.id),
    ))
    .leftJoin(ihInstallations, and(
      eq(ihInstallations.id, ihInventoryMeters.installedInstallationId),
      isNull(ihInstallations.deletedAt),
    ))
    .where(and(
      inArray(wwDevices.id, internalIds),
      eq(ihInventoryMeters.status, 'installed'),
      isNull(ihInventoryMeters.deletedAt),
      eq(businessClients.companyKey, config.businessDirectory.companyKey),
      isNull(businessClients.mergedIntoClientId),
    ));
  for (const row of fieldPlacements) {
    const list = result.get(row.internalDeviceId) ?? [];
    list.push({
      source: 'field_installation',
      effectiveDate: dateValue(row.effectiveDate),
      businessClient: { id: row.businessClientId, name: row.businessClientName },
      site: row.siteId && row.siteName && row.siteAddress
        ? { id: row.siteId, name: row.siteName, address: row.siteAddress }
        : null,
      deviceRole: 'current',
      provenance: null,
    });
    result.set(row.internalDeviceId, list);
  }

  for (const [deviceId, placements] of result) {
    result.set(deviceId, sortDevicePlacements(placements));
  }
  return result;
}

export function placementSummary(placements: DevicePlacement[]) {
  return resolveDevicePlacement(placements);
}

export async function loadDeviceAssociations(device: FleetDeviceReference) {
  const [inventoryRow] = await db.select({
    inventoryId: ihInventoryMeters.id,
    inventoryDeviceId: ihInventoryMeters.deviceId,
    inventoryModel: ihInventoryMeters.deviceModel,
    customManufacturerName: ihInventoryMeters.customManufacturerName,
    customModelName: ihInventoryMeters.customModelName,
    inventoryStatus: ihInventoryMeters.status,
    installedInstallationId: ihInventoryMeters.installedInstallationId,
    installedMeterId: ihInventoryMeters.installedMeterId,
    businessClientId: ihInventoryMeters.businessClientId,
    businessSiteId: ihInventoryMeters.businessSiteId,
    businessJobId: ihInventoryMeters.businessJobId,
    revision: ihInventoryMeters.revision,
    meterId: ihMeterDevices.id,
    meterInstallationId: ihMeterDevices.installationId,
    installedOnBoardId: ihMeterDevices.installedOnBoardId,
    meterCustomName: ihMeterDevices.customName,
    deviceFamily: ihMeterDevices.deviceFamily,
    deviceModel: ihMeterDevices.deviceModel,
    deviceNumber: ihMeterDevices.deviceNumber,
    serialNumber: ihMeterDevices.serialNumber,
    displayCode: ihMeterDevices.displayCode,
    zoneId: ihElectricalAssets.zoneId,
    zoneName: ihZones.zoneName,
    boardName: ihElectricalAssets.assetName,
    installationId: ihInstallations.id,
    installationSiteCode: ihInstallations.siteCode,
    installationSiteName: ihInstallations.siteName,
    installationStatus: ihInstallations.status,
    installationCompletedAt: ihInstallations.completedAt,
    electricalMapLayout: ihInstallations.electricalMapLayout,
  }).from(ihInventoryMeters)
    .leftJoin(businessClients, eq(businessClients.id, ihInventoryMeters.businessClientId))
    .leftJoin(businessSites, and(
      eq(businessSites.id, ihInventoryMeters.businessSiteId),
      eq(businessSites.clientId, businessClients.id),
    ))
    .leftJoin(ihMeterDevices, and(
      eq(ihMeterDevices.id, ihInventoryMeters.installedMeterId),
      eq(ihMeterDevices.installationId, ihInventoryMeters.installedInstallationId),
      isNull(ihMeterDevices.deletedAt),
    ))
    .leftJoin(ihInstallations, and(
      eq(ihInstallations.id, ihInventoryMeters.installedInstallationId),
      isNull(ihInstallations.deletedAt),
    ))
    .leftJoin(ihElectricalAssets, and(
      eq(ihElectricalAssets.id, ihMeterDevices.installedOnBoardId),
      eq(ihElectricalAssets.installationId, ihMeterDevices.installationId),
      isNull(ihElectricalAssets.deletedAt),
    ))
    .leftJoin(ihZones, and(
      eq(ihZones.id, ihElectricalAssets.zoneId),
      eq(ihZones.installationId, ihElectricalAssets.installationId),
      isNull(ihZones.deletedAt),
    ))
    .where(and(
      sql`upper(${ihInventoryMeters.deviceId}) = upper(${device.deviceId})`,
      isNull(ihInventoryMeters.deletedAt),
      or(
        isNull(ihInventoryMeters.businessClientId),
        and(
          eq(businessClients.companyKey, config.businessDirectory.companyKey),
          isNull(businessClients.mergedIntoClientId),
        ),
      ),
      or(
        isNull(ihInventoryMeters.businessSiteId),
        eq(businessSites.clientId, ihInventoryMeters.businessClientId),
      ),
    ))
    .orderBy(desc(ihInventoryMeters.updatedAt), asc(ihInventoryMeters.id))
    .limit(1);

  const movements = inventoryRow
    ? await db.select({
        id: ihInventoryMeterMovements.id,
        action: ihInventoryMeterMovements.action,
        fromStatus: ihInventoryMeterMovements.fromStatus,
        toStatus: ihInventoryMeterMovements.toStatus,
        installationId: ihInventoryMeterMovements.installationId,
        meterId: ihInventoryMeterMovements.meterId,
        occurredAt: ihInventoryMeterMovements.occurredAt,
      }).from(ihInventoryMeterMovements)
        .where(eq(ihInventoryMeterMovements.inventoryMeterId, inventoryRow.inventoryId))
        .orderBy(desc(ihInventoryMeterMovements.occurredAt))
    : [];

  const registerRows = await db.select({
    id: wwMeterRegisterEntries.id,
    sourceKey: wwMeterRegisterEntries.sourceKey,
    sourceWorkbook: wwMeterRegisterImports.sourceWorkbook,
    sourceSheet: wwMeterRegisterImports.sourceSheet,
    sourceRow: wwMeterRegisterEntries.sourceRow,
    status: wwMeterRegisterEntries.statusSnapshot,
    customerName: wwMeterRegisterEntries.customerNameSnapshot,
    fleetAccountName: wwMeterRegisterEntries.clientNameSnapshot,
    siteAddress: wwMeterRegisterEntries.siteAddressSnapshot,
    jobNumber: wwMeterRegisterEntries.fergusJobNumberSnapshot,
    jobCompletionDate: wwMeterRegisterEntries.jobCompletionDate,
    jobCompletedBy: wwMeterRegisterEntries.jobCompletedBySnapshot,
    existingDeviceIdentifier: wwMeterRegisterEntries.existingDeviceIdentifier,
    newDeviceIdentifier: wwMeterRegisterEntries.newDeviceIdentifier,
    currentDeviceIdentifier: wwMeterRegisterEntries.currentDeviceIdentifier,
    existingWattwatchersDeviceId: wwMeterRegisterEntries.existingWattwatchersDeviceId,
    newWattwatchersDeviceId: wwMeterRegisterEntries.newWattwatchersDeviceId,
    currentWattwatchersDeviceId: wwMeterRegisterEntries.currentWattwatchersDeviceId,
    maas: wwMeterRegisterEntries.maas,
    dataEnabled: wwMeterRegisterEntries.dataEnabled,
    productName: wwMeterRegisterEntries.productNameSnapshot,
  }).from(wwMeterRegisterEntries)
    .innerJoin(wwMeterRegisterImports, eq(wwMeterRegisterImports.id, wwMeterRegisterEntries.importId))
    .where(or(
      eq(wwMeterRegisterEntries.existingWattwatchersDeviceId, device.internalDeviceId),
      eq(wwMeterRegisterEntries.newWattwatchersDeviceId, device.internalDeviceId),
      eq(wwMeterRegisterEntries.currentWattwatchersDeviceId, device.internalDeviceId),
    ))
    .orderBy(desc(wwMeterRegisterEntries.jobCompletionDate), desc(wwMeterRegisterEntries.sourceRow));

  const fieldForms = inventoryRow?.meterId && inventoryRow.meterInstallationId
    ? await db.select({
        id: ihFormSubmissions.id,
        formType: ihFormSubmissions.formType,
        status: ihFormSubmissions.status,
        completedAt: ihFormSubmissions.completedAt,
      }).from(ihFormSubmissions).where(and(
        eq(ihFormSubmissions.installationId, inventoryRow.meterInstallationId),
        eq(ihFormSubmissions.meterId, inventoryRow.meterId),
        isNull(ihFormSubmissions.deletedAt),
      )).orderBy(desc(ihFormSubmissions.createdAt), asc(ihFormSubmissions.id))
    : [];
  const meterHistory = inventoryRow?.meterId && inventoryRow.meterInstallationId
    ? await db.select({
        id: ihMeterHistoryEvents.id,
        operation: ihMeterHistoryEvents.operation,
        fromRecordVersionNumber: ihMeterHistoryEvents.fromRecordVersionNumber,
        toRecordVersionNumber: ihMeterHistoryEvents.toRecordVersionNumber,
        restoredFromRecordVersionNumber: ihMeterHistoryEvents.restoredFromRecordVersionNumber,
        createdAt: ihMeterHistoryEvents.createdAt,
      }).from(ihMeterHistoryEvents).where(and(
        eq(ihMeterHistoryEvents.installationId, inventoryRow.meterInstallationId),
        eq(ihMeterHistoryEvents.meterId, inventoryRow.meterId),
      )).orderBy(desc(ihMeterHistoryEvents.createdAt), asc(ihMeterHistoryEvents.id))
    : [];

  return {
    inventory: inventoryRow ? {
      id: inventoryRow.inventoryId,
      deviceId: inventoryRow.inventoryDeviceId,
      deviceModel: inventoryRow.inventoryModel,
      customManufacturerName: inventoryRow.customManufacturerName,
      customModelName: inventoryRow.customModelName,
      status: inventoryRow.inventoryStatus,
      installedInstallationId: inventoryRow.installedInstallationId,
      installedMeterId: inventoryRow.installedMeterId,
      businessClientId: inventoryRow.businessClientId,
      businessSiteId: inventoryRow.businessSiteId,
      businessJobId: inventoryRow.businessJobId,
      revision: inventoryRow.revision,
      movements,
    } : null,
    fieldMeter: inventoryRow?.meterId && inventoryRow.meterInstallationId
      && inventoryRow.installedOnBoardId && inventoryRow.meterCustomName
      && inventoryRow.deviceFamily && inventoryRow.deviceModel && inventoryRow.serialNumber
      ? {
          id: inventoryRow.meterId,
          installationId: inventoryRow.meterInstallationId,
          installedOnBoardId: inventoryRow.installedOnBoardId,
          zoneId: inventoryRow.zoneId,
          zoneName: inventoryRow.zoneName,
          boardName: inventoryRow.boardName,
          customName: inventoryRow.meterCustomName,
          deviceFamily: inventoryRow.deviceFamily,
          deviceModel: inventoryRow.deviceModel,
          deviceNumber: inventoryRow.deviceNumber,
          serialNumber: inventoryRow.serialNumber,
          displayCode: inventoryRow.displayCode,
        }
      : null,
    fieldInstallation: inventoryRow?.installationId && inventoryRow.installationSiteName
      && inventoryRow.installationStatus
      ? {
          id: inventoryRow.installationId,
          jobId: inventoryRow.businessJobId,
          siteId: inventoryRow.businessSiteId,
          siteCode: inventoryRow.installationSiteCode,
          siteName: inventoryRow.installationSiteName,
          status: inventoryRow.installationStatus,
          completedAt: inventoryRow.installationCompletedAt,
          electricalMapLayoutConfigured: inventoryRow.electricalMapLayout !== null,
          paths: installationPaths({
            id: inventoryRow.installationId,
            meterId: inventoryRow.meterId,
            boardId: inventoryRow.installedOnBoardId,
            zoneId: inventoryRow.zoneId,
          }),
        }
      : null,
    registerEvidence: registerRows.map((row) => ({
      id: row.id,
      sourceKey: row.sourceKey,
      sourceWorkbook: row.sourceWorkbook,
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      status: row.status,
      customerName: row.customerName,
      fleetAccountName: row.fleetAccountName,
      siteAddress: row.siteAddress,
      jobNumber: row.jobNumber,
      jobCompletionDate: row.jobCompletionDate,
      jobCompletedBy: row.jobCompletedBy,
      existingDeviceIdentifier: row.existingDeviceIdentifier,
      newDeviceIdentifier: row.newDeviceIdentifier,
      currentDeviceIdentifier: row.currentDeviceIdentifier,
      maas: row.maas,
      dataEnabled: row.dataEnabled,
      productName: row.productName,
      matchedRoles: matchedRegisterRoles(row, device.internalDeviceId),
    })),
    fieldForms: fieldForms.map((form) => ({
      ...form,
      path: fieldFormPath(inventoryRow!.meterInstallationId!, form.id),
    })),
    meterHistory,
  };
}

async function deviceReferencesForScope(input: { clientId?: string; siteId?: string }) {
  const assignmentConditions = input.siteId
    ? eq(wwDeviceInstallationAssignments.businessSiteId, input.siteId)
    : eq(wwDeviceInstallationAssignments.businessClientId, input.clientId!);
  const inventoryConditions = input.siteId
    ? eq(ihInventoryMeters.businessSiteId, input.siteId)
    : eq(ihInventoryMeters.businessClientId, input.clientId!);
  const [assigned, installed] = await Promise.all([
    db.select({
      internalDeviceId: wwDevices.id,
      deviceId: wwDevices.deviceId,
      label: wwDevices.label,
      model: wwDevices.model,
    }).from(wwDeviceInstallationAssignments)
      .innerJoin(wwDevices, eq(wwDevices.id, wwDeviceInstallationAssignments.currentDeviceId))
      .where(assignmentConditions),
    db.select({
      internalDeviceId: wwDevices.id,
      deviceId: wwDevices.deviceId,
      label: wwDevices.label,
      model: wwDevices.model,
    }).from(ihInventoryMeters)
      .innerJoin(wwDevices, sql`upper(${wwDevices.deviceId}) = upper(${ihInventoryMeters.deviceId})`)
      .where(and(
        inventoryConditions,
        eq(ihInventoryMeters.status, 'installed'),
        isNull(ihInventoryMeters.deletedAt),
      )),
  ]);
  return [...new Map([...assigned, ...installed].map((row) => [row.internalDeviceId, row])).values()];
}

async function jobsForSites(siteIds: string[]) {
  if (siteIds.length === 0) return [];
  return db.select({
    id: businessJobs.id,
    siteId: businessJobs.siteId,
    jobType: businessJobs.jobType,
    title: businessJobs.title,
    status: businessJobs.status,
    sourceApp: businessJobs.sourceApp,
    sourceType: businessJobs.sourceType,
    sourceId: businessJobs.sourceId,
    createdAt: businessJobs.createdAt,
    updatedAt: businessJobs.updatedAt,
  }).from(businessJobs)
    .where(inArray(businessJobs.siteId, siteIds))
    .orderBy(desc(businessJobs.updatedAt), asc(businessJobs.id));
}

async function installationsForSites(siteIds: string[], jobs: Awaited<ReturnType<typeof jobsForSites>>) {
  if (siteIds.length === 0) return [];
  const jobByInstallation = new Map(
    jobs.filter((job) => job.sourceApp === 'installhub' && job.sourceType === 'installation')
      .map((job) => [job.sourceId, job]),
  );
  const rows = await db.select({
    id: ihInstallations.id,
    siteId: ihInstallations.businessSiteId,
    siteCode: ihInstallations.siteCode,
    siteName: ihInstallations.siteName,
    status: ihInstallations.status,
    completedAt: ihInstallations.completedAt,
    electricalMapLayout: ihInstallations.electricalMapLayout,
  }).from(ihInstallations)
    .where(and(
      inArray(ihInstallations.businessSiteId, siteIds),
      isNull(ihInstallations.deletedAt),
    ))
    .orderBy(desc(ihInstallations.updatedAt), asc(ihInstallations.id));
  return rows.map((row) => ({
    id: row.id,
    jobId: jobByInstallation.get(row.id)?.id ?? null,
    siteId: row.siteId,
    siteCode: row.siteCode,
    siteName: row.siteName,
    status: row.status,
    completedAt: row.completedAt,
    electricalMapLayoutConfigured: row.electricalMapLayout !== null,
    paths: installationPaths({ id: row.id }),
  }));
}

export async function loadBusinessClientGraph(clientId: string) {
  const [client] = await db.select({
    id: businessClients.id,
    name: businessClients.name,
    contactName: businessClients.contactName,
    contactPhone: businessClients.contactPhone,
    contactEmail: businessClients.contactEmail,
    updatedAt: businessClients.updatedAt,
  }).from(businessClients).where(and(
    eq(businessClients.id, clientId),
    eq(businessClients.companyKey, config.businessDirectory.companyKey),
    isNull(businessClients.mergedIntoClientId),
  )).limit(1);
  if (!client) return null;
  const sites = await db.select({
    id: businessSites.id,
    clientId: businessSites.clientId,
    name: businessSites.name,
    address: businessSites.address,
    locality: businessSites.locality,
    state: businessSites.state,
    postcode: businessSites.postcode,
    countryCode: businessSites.countryCode,
    timezone: businessSites.timezone,
    contactName: businessSites.contactName,
    contactPhone: businessSites.contactPhone,
    contactEmail: businessSites.contactEmail,
    accessInformation: businessSites.accessInformation,
    updatedAt: businessSites.updatedAt,
  }).from(businessSites)
    .where(eq(businessSites.clientId, clientId))
    .orderBy(asc(businessSites.name), asc(businessSites.id));
  const siteIds = sites.map((site) => site.id);
  const jobs = await jobsForSites(siteIds);
  const [installations, devices] = await Promise.all([
    installationsForSites(siteIds, jobs),
    deviceReferencesForScope({ clientId }),
  ]);
  return { client, sites, jobs, installations, devices };
}

export async function searchBusinessSites(query: string, limit: number) {
  const partial = query.trim();
  const pattern = `%${partial}%`;
  return db.select({
    id: businessSites.id,
    name: businessSites.name,
    address: businessSites.address,
    locality: businessSites.locality,
    state: businessSites.state,
    postcode: businessSites.postcode,
    clientId: businessClients.id,
    clientName: businessClients.name,
  }).from(businessSites)
    .innerJoin(businessClients, eq(businessClients.id, businessSites.clientId))
    .where(and(
      eq(businessClients.companyKey, config.businessDirectory.companyKey),
      isNull(businessClients.mergedIntoClientId),
      partial ? or(
        ilike(businessSites.name, pattern),
        ilike(businessSites.address, pattern),
        ilike(businessSites.locality, pattern),
        ilike(businessSites.state, pattern),
        ilike(businessSites.postcode, pattern),
        ilike(businessClients.name, pattern),
      ) : undefined,
    ))
    .orderBy(
      asc(businessSites.name),
      asc(businessClients.name),
      asc(businessSites.address),
      asc(businessSites.id),
    )
    .limit(limit);
}

export async function loadBusinessSiteGraph(siteId: string) {
  const [row] = await db.select({
    siteId: businessSites.id,
    siteClientId: businessSites.clientId,
    siteName: businessSites.name,
    siteAddress: businessSites.address,
    siteLocality: businessSites.locality,
    siteState: businessSites.state,
    sitePostcode: businessSites.postcode,
    siteCountryCode: businessSites.countryCode,
    siteTimezone: businessSites.timezone,
    siteContactName: businessSites.contactName,
    siteContactPhone: businessSites.contactPhone,
    siteContactEmail: businessSites.contactEmail,
    siteAccessInformation: businessSites.accessInformation,
    siteUpdatedAt: businessSites.updatedAt,
    clientId: businessClients.id,
    clientName: businessClients.name,
    clientContactName: businessClients.contactName,
    clientContactPhone: businessClients.contactPhone,
    clientContactEmail: businessClients.contactEmail,
  }).from(businessSites)
    .innerJoin(businessClients, eq(businessClients.id, businessSites.clientId))
    .where(and(
      eq(businessSites.id, siteId),
      eq(businessClients.companyKey, config.businessDirectory.companyKey),
      isNull(businessClients.mergedIntoClientId),
    )).limit(1);
  if (!row) return null;
  const jobs = await jobsForSites([siteId]);
  const [installations, devices] = await Promise.all([
    installationsForSites([siteId], jobs),
    deviceReferencesForScope({ siteId }),
  ]);
  return {
    site: {
      id: row.siteId,
      clientId: row.siteClientId,
      name: row.siteName,
      address: row.siteAddress,
      locality: row.siteLocality,
      state: row.siteState,
      postcode: row.sitePostcode,
      countryCode: row.siteCountryCode,
      timezone: row.siteTimezone,
      contactName: row.siteContactName,
      contactPhone: row.siteContactPhone,
      contactEmail: row.siteContactEmail,
      accessInformation: row.siteAccessInformation,
      updatedAt: row.siteUpdatedAt,
    },
    client: {
      id: row.clientId,
      name: row.clientName,
      contactName: row.clientContactName,
      contactPhone: row.clientContactPhone,
      contactEmail: row.clientContactEmail,
    },
    jobs,
    installations,
    devices,
  };
}
