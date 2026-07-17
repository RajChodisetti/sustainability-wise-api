import type { EntityConfig, EntityContext, EntityField, EntityRecord } from '../components/EntityCrudPanel';

function enc(value: string | undefined): string {
  return encodeURIComponent((value ?? '').trim());
}

function id(record: EntityRecord): string {
  return String(record.id ?? '');
}

function sourceId(record: EntityRecord): string {
  return String(record.__copySourceId ?? record.id ?? '');
}

function withContext(record: EntityRecord, context: EntityContext): EntityRecord {
  return { ...record, ...context };
}

function stripEmptyAssignedInspector(record: EntityRecord): EntityRecord {
  const next = { ...record };
  if (next.assignedInspectorUserId === null || next.assignedInspectorUserId === '') {
    delete next.assignedInspectorUserId;
  }
  return next;
}

const statusField: EntityField = {
  key: 'status',
  label: 'Status',
  kind: 'select',
  createOnly: true,
  options: [
    { label: 'Draft', value: 'Draft' },
    { label: 'Completed', value: 'Completed' },
  ],
};

const syncDisplayFields: EntityField[] = [
  { key: 'id', label: 'Server ID', readOnly: true },
  { key: 'syncStatus', label: 'Sync Status', readOnly: true },
  { key: 'updatedAt', label: 'Updated At', readOnly: true },
];

export const solarSenseSiteConfig: EntityConfig = {
  id: 'solarsense-sites',
  title: 'SolarSense Sites',
  description: 'Create, copy, edit, complete, and delete SolarSense site records.',
  entityLabel: 'site',
  listPath: () => '/v1/solarsense/sites',
  createPath: () => '/v1/solarsense/sites',
  copyPath: (record) => `/v1/solarsense/sites/${enc(sourceId(record))}/copy`,
  updatePath: (record) => `/v1/solarsense/sites/${enc(id(record))}`,
  deletePath: (record) => `/v1/solarsense/sites/${enc(id(record))}`,
  completePath: (record) => `/v1/solarsense/sites/${enc(id(record))}/complete`,
  displayName: (record) => String(record.siteName ?? record.id ?? 'Site'),
  defaultValues: () => ({
    siteName: '',
    status: 'Draft',
    appendixItems: [],
  }),
  fields: [
    { key: 'siteName', label: 'Site Name', required: true },
    { key: 'location', label: 'Location' },
    { key: 'dateOfAssessment', label: 'Date of Assessment', kind: 'date' },
    { key: 'documentClassification', label: 'Document Classification' },
    statusField,
    { key: 'electricalInfrastructureSummary', label: 'Electrical Infrastructure Summary', kind: 'multiline', section: 'Report Inputs' },
    { key: 'knownConstraints', label: 'Known Constraints', kind: 'multiline', section: 'Report Inputs' },
    { key: 'loadProfileMeteringSummary', label: 'Load Profile / Metering Summary', kind: 'multiline', section: 'Report Inputs' },
    { key: 'ppaAssetDemarcation', label: 'PPA / Asset Demarcation', kind: 'multiline', section: 'Report Inputs' },
    { key: 'appendixNotes', label: 'Appendix Notes', kind: 'multiline', section: 'Appendix' },
    { key: 'appendixItems', label: 'Appendix Items JSON', kind: 'json', section: 'Appendix', hint: 'Array of appendix image/document items.' },
    { key: 'reportPdfRemoteUrl', label: 'Report PDF URL', readOnly: true, section: 'System' },
    ...syncDisplayFields.map((field) => ({ ...field, section: 'System' })),
  ],
  listColumns: [
    { key: 'siteName', label: 'Site' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status' },
    { key: 'dateOfAssessment', label: 'Date' },
  ],
};

export const solarSenseAssessmentConfig: EntityConfig = {
  id: 'solarsense-assessments',
  title: 'SolarSense Rooftop Assessments',
  description: 'Manage rooftop assessments for a selected SolarSense site.',
  entityLabel: 'assessment',
  contextFields: [{ key: 'siteId', label: 'Site ID', required: true, placeholder: 'Paste the SolarSense site ID' }],
  listPath: (context) => context.siteId ? `/v1/solarsense/sites/${enc(context.siteId)}/assessments` : null,
  createPath: (context) => context.siteId ? `/v1/solarsense/sites/${enc(context.siteId)}/assessments` : null,
  updatePath: (record, context) => context.siteId ? `/v1/solarsense/sites/${enc(context.siteId)}/assessments/${enc(id(record))}` : null,
  deletePath: (record, context) => context.siteId ? `/v1/solarsense/sites/${enc(context.siteId)}/assessments/${enc(id(record))}` : null,
  completePath: (record, context) => context.siteId ? `/v1/solarsense/sites/${enc(context.siteId)}/assessments/${enc(id(record))}/complete` : null,
  displayName: (record) => String(record.buildingIdName ?? record.id ?? 'Assessment'),
  defaultValues: (context) => ({
    siteId: context.siteId,
    buildingIdName: '',
    status: 'Draft',
    heritageDealBreaker: false,
    asbestosFlag: false,
    structuralRiskFlag: false,
    switchboards: [],
    otherConsiderations: [],
    additionalPhotos: [],
    photoMetadata: {},
  }),
  beforeCreate: (record, context) => withContext(record, context),
  beforeUpdate: (record, context) => withContext(record, context),
  fields: [
    { key: 'buildingIdName', label: 'Building ID / Name', required: true },
    statusField,
    { key: 'heritageStatus', label: 'Heritage Status', section: 'Roof and Structure' },
    { key: 'heritageDealBreaker', label: 'Heritage Deal Breaker', kind: 'boolean', section: 'Roof and Structure' },
    { key: 'aerialPhotoUri', label: 'Aerial Photo URI', section: 'Photos' },
    { key: 'roofAreaTotalM2', label: 'Total Roof Area m2', kind: 'number', section: 'Roof and Structure' },
    { key: 'roofMaterial', label: 'Roof Material', section: 'Roof and Structure' },
    { key: 'roofFramingType', label: 'Roof Framing Type', section: 'Roof and Structure' },
    { key: 'roofPitchAngle', label: 'Roof Pitch Angle', section: 'Roof and Structure' },
    { key: 'roofConstructionMaterial', label: 'Roof Construction Material', section: 'Roof and Structure' },
    { key: 'asbestosFlag', label: 'Asbestos Flag', kind: 'boolean', section: 'Roof and Structure' },
    { key: 'roofCondition', label: 'Roof Condition', section: 'Roof and Structure' },
    { key: 'roofEstimatedAge', label: 'Roof Estimated Age', section: 'Roof and Structure' },
    { key: 'roofOrientationPrimary', label: 'Primary Roof Orientation', section: 'Orientation and Shading' },
    { key: 'roofShadingSources', label: 'Roof Shading Sources', kind: 'multiline', section: 'Orientation and Shading' },
    { key: 'roofShadingUsablePct', label: 'Roof Shading Usable Percent', section: 'Orientation and Shading' },
    { key: 'roofOrientationShading', label: 'Roof Orientation / Shading Notes', kind: 'multiline', section: 'Orientation and Shading' },
    { key: 'structuralFeasibility', label: 'Structural Feasibility', section: 'Roof and Structure' },
    { key: 'structuralRiskFlag', label: 'Structural Risk Flag', kind: 'boolean', section: 'Roof and Structure' },
    { key: 'roofAreaUsableM2', label: 'Usable Roof Area m2', kind: 'number', section: 'Solar Potential' },
    { key: 'pvSizeKwDc', label: 'PV Size kW DC', kind: 'number', section: 'Solar Potential' },
    { key: 'acExportKw', label: 'AC Export kW', kind: 'number', section: 'Solar Potential' },
    { key: 'accessSafetyConstraints', label: 'Access / Safety Constraints', kind: 'multiline', section: 'Solar Potential' },
    { key: 'switchboards', label: 'Switchboards JSON', kind: 'json', section: 'Electrical', hint: 'Array of switchboard objects.' },
    { key: 'msbDetails', label: 'MSB Details', kind: 'multiline', section: 'Electrical' },
    { key: 'msbPhotoUri', label: 'MSB Photo URI', section: 'Photos' },
    { key: 'existingGeneration', label: 'Existing Generation', section: 'Electrical' },
    { key: 'distanceToConnectionM', label: 'Distance to Connection m', kind: 'number', section: 'Electrical' },
    { key: 'electricalPitsEntry', label: 'Electrical Pits Entry', section: 'Electrical' },
    { key: 'inverterSiting', label: 'Inverter Siting', section: 'Electrical' },
    { key: 'transformerSupplyCapacity', label: 'Transformer / Supply Capacity', kind: 'multiline', section: 'Electrical' },
    { key: 'dnspConstraints', label: 'DNSP Constraints', kind: 'multiline', section: 'Electrical' },
    { key: 'loadProfileMetering', label: 'Load Profile / Metering', kind: 'multiline', section: 'Electrical' },
    { key: 'otherConsiderations', label: 'Other Considerations JSON', kind: 'json', section: 'Notes', hint: 'Array of issue/details/photoUris objects.' },
    { key: 'siteRepFeedback', label: 'Site Representative Feedback', kind: 'multiline', section: 'Notes' },
    { key: 'viabilityStatus', label: 'Viability Status', section: 'Decision' },
    { key: 'dealBreakerReason', label: 'Deal Breaker Reason', kind: 'multiline', section: 'Decision' },
    { key: 'ragPriority', label: 'RAG Priority', section: 'Decision' },
    { key: 'keyAssumptionsGaps', label: 'Key Assumptions / Gaps', kind: 'multiline', section: 'Decision' },
    { key: 'additionalPhotos', label: 'Additional Photos JSON', kind: 'json', section: 'Photos' },
    { key: 'photoMetadata', label: 'Photo Metadata JSON', kind: 'json', section: 'Photos' },
    ...syncDisplayFields.map((field) => ({ ...field, section: 'System' })),
  ],
  listColumns: [
    { key: 'buildingIdName', label: 'Assessment' },
    { key: 'status', label: 'Status' },
    { key: 'viabilityStatus', label: 'Viability' },
    { key: 'ragPriority', label: 'RAG' },
  ],
};

export const ecoAuditAuditConfig: EntityConfig = {
  id: 'ecoaudit-audits',
  title: 'EcoAudit Pro Audits',
  description: 'Create, copy, edit, complete, and delete EcoAudit Pro audit records.',
  entityLabel: 'audit',
  listPath: () => '/v1/ecoaudit/audits',
  createPath: () => '/v1/ecoaudit/audits',
  copyPath: (record) => `/v1/ecoaudit/audits/${enc(sourceId(record))}/copy`,
  updatePath: (record) => `/v1/ecoaudit/audits/${enc(id(record))}`,
  deletePath: (record) => `/v1/ecoaudit/audits/${enc(id(record))}`,
  completePath: (record) => `/v1/ecoaudit/audits/${enc(id(record))}/complete`,
  displayName: (record) => String(record.siteName ?? record.id ?? 'Audit'),
  defaultValues: () => ({
    siteName: '',
    siteAddress: '',
    inspectorName: '',
    auditDate: new Date().toISOString().slice(0, 10),
    status: 'Draft',
  }),
  beforeCreate: stripEmptyAssignedInspector,
  beforeUpdate: stripEmptyAssignedInspector,
  fields: [
    { key: 'siteName', label: 'Site Name', required: true },
    { key: 'siteAddress', label: 'Site Address', required: true },
    { key: 'inspectorName', label: 'Inspector Name', required: true },
    { key: 'auditDate', label: 'Audit Date', kind: 'date' },
    statusField,
    { key: 'assignedInspectorUserId', label: 'Assigned Inspector User ID', section: 'Access' },
    { key: 'reportPdfRemoteUrl', label: 'Report PDF URL', readOnly: true, section: 'System' },
    ...syncDisplayFields.map((field) => ({ ...field, section: 'System' })),
  ],
  listColumns: [
    { key: 'siteName', label: 'Audit' },
    { key: 'siteAddress', label: 'Address' },
    { key: 'status', label: 'Status' },
    { key: 'auditDate', label: 'Date' },
  ],
};

export const ecoAuditZoneConfig: EntityConfig = {
  id: 'ecoaudit-zones',
  title: 'EcoAudit Pro Zones',
  description: 'Manage zones and zone photo references for a selected audit.',
  entityLabel: 'zone',
  contextFields: [{ key: 'auditId', label: 'Audit ID', required: true, placeholder: 'Paste the EcoAudit audit ID' }],
  listPath: (context) => context.auditId ? `/v1/ecoaudit/audits/${enc(context.auditId)}/zones` : null,
  createPath: (context) => context.auditId ? `/v1/ecoaudit/audits/${enc(context.auditId)}/zones` : null,
  updatePath: (record) => `/v1/ecoaudit/zones/${enc(id(record))}`,
  deletePath: (record) => `/v1/ecoaudit/zones/${enc(id(record))}`,
  displayName: (record) => String(record.zoneName ?? record.id ?? 'Zone'),
  defaultValues: (context) => ({
    auditId: context.auditId,
    zoneName: '',
    photos: [],
  }),
  beforeCreate: (record, context) => withContext(record, context),
  fields: [
    { key: 'zoneName', label: 'Zone Name', required: true },
    { key: 'zoneDescription', label: 'Zone Description', kind: 'multiline' },
    { key: 'photos', label: 'Zone Photos', kind: 'array', hint: 'One photo URI per line.' },
    ...syncDisplayFields.map((field) => ({ ...field, section: 'System' })),
  ],
  listColumns: [
    { key: 'zoneName', label: 'Zone' },
    { key: 'zoneDescription', label: 'Description' },
    { key: 'photos', label: 'Photos' },
  ],
};

const commonEquipmentTail: EntityField[] = [
  { key: 'energyImprovementObservations', label: 'Energy Improvement Observations', kind: 'multiline', section: 'Notes' },
  { key: 'extraNotes', label: 'Extra Notes', kind: 'multiline', section: 'Notes' },
  { key: 'extraPhotos', label: 'Extra Photos', kind: 'array', section: 'Photos', hint: 'One photo URI per line.' },
  { key: 'photoDescs', label: 'Photo Descriptions JSON', kind: 'json', section: 'Photos' },
  ...syncDisplayFields.map((field) => ({ ...field, section: 'System' })),
];

export const equipmentTypes = [
  { label: 'Main Switchboards', value: 'main-switchboards' },
  { label: 'Additional Switchboards', value: 'additional-switchboards' },
  { label: 'HVAC Units', value: 'hvac-units' },
  { label: 'Lighting Systems', value: 'lighting-systems' },
  { label: 'Solar PV', value: 'solar-pv' },
  { label: 'Forklift Chargers', value: 'forklift-chargers' },
  { label: 'Hot Water Systems', value: 'hot-water-systems' },
  { label: 'General Water', value: 'general-water' },
  { label: 'General Electricity', value: 'general-electricity' },
];

const equipmentFieldMap: Record<string, EntityField[]> = {
  'main-switchboards': [
    { key: 'name', label: 'Name', required: true },
    { key: 'location', label: 'Location' },
    { key: 'mapLocator', label: 'Map Locator' },
    { key: 'siteNmi', label: 'Site NMI' },
    { key: 'photo', label: 'Photo URI', section: 'Photos' },
    { key: 'subCircuitsDescription', label: 'Sub-circuits Description', kind: 'multiline', section: 'Details' },
    { key: 'comments', label: 'Comments', kind: 'multiline', section: 'Details' },
    ...commonEquipmentTail,
  ],
  'additional-switchboards': [
    { key: 'name', label: 'Name', required: true },
    { key: 'location', label: 'Location' },
    { key: 'mapLocator', label: 'Map Locator' },
    { key: 'type', label: 'Type' },
    { key: 'photo', label: 'Photo URI', section: 'Photos' },
    { key: 'subCircuitsDescription', label: 'Sub-circuits Description', kind: 'multiline', section: 'Details' },
    { key: 'comments', label: 'Comments', kind: 'multiline', section: 'Details' },
    ...commonEquipmentTail,
  ],
  'hvac-units': [
    { key: 'unitName', label: 'Unit Name', required: true },
    { key: 'make', label: 'Make' },
    { key: 'photo', label: 'Photo URI', section: 'Photos' },
    { key: 'location', label: 'Location' },
    { key: 'type', label: 'Type' },
    { key: 'model', label: 'Model' },
    { key: 'serialNumber', label: 'Serial Number' },
    { key: 'heatingCapacityKw', label: 'Heating Capacity kW', kind: 'number' },
    { key: 'coolingCapacityKw', label: 'Cooling Capacity kW', kind: 'number' },
    { key: 'powerSupplyPhase', label: 'Power Supply Phase' },
    { key: 'nameplatePhotos', label: 'Nameplate Photo URI', section: 'Photos' },
    { key: 'indoorUnitModel', label: 'Indoor Unit Model' },
    { key: 'indoorUnitSerial', label: 'Indoor Unit Serial' },
    { key: 'indoorUnitNameplatePhoto', label: 'Indoor Unit Nameplate Photo URI', section: 'Photos' },
    { key: 'controllerType', label: 'Controller Type' },
    { key: 'controllerModel', label: 'Controller Model' },
    { key: 'controllerPhoto', label: 'Controller Photo URI', section: 'Photos' },
    { key: 'temperatureSensorType', label: 'Temperature Sensor Type' },
    { key: 'systemCoverage', label: 'System Coverage', kind: 'multiline' },
    ...commonEquipmentTail,
  ],
  'lighting-systems': [
    { key: 'lightType', label: 'Light Type', required: true },
    { key: 'brandModel', label: 'Brand / Model' },
    { key: 'photo', label: 'Photo URI', section: 'Photos' },
    { key: 'ratedWattage', label: 'Rated Wattage', kind: 'number' },
    { key: 'quantity', label: 'Quantity', kind: 'number' },
    { key: 'fixturesInstalled', label: 'Fixtures Installed' },
    { key: 'fixturesPhoto', label: 'Fixtures Photo URI', section: 'Photos' },
    { key: 'areaLocation', label: 'Area / Location' },
    { key: 'controlsType', label: 'Controls Type' },
    { key: 'operatingHours', label: 'Operating Hours' },
    { key: 'mountingHeight', label: 'Mounting Height' },
    { key: 'mountingConstraintsPhoto', label: 'Mounting Constraints Photo URI', section: 'Photos' },
    { key: 'circuitGrouping', label: 'Circuit Grouping' },
    { key: 'sensorsPhoto', label: 'Sensors Photo URI', section: 'Photos' },
    { key: 'accessLimitations', label: 'Access Limitations', kind: 'multiline' },
    { key: 'switchboardPhotoNotes', label: 'Switchboard / Controls Photo Notes', kind: 'multiline' },
    ...commonEquipmentTail,
  ],
  'solar-pv': [
    { key: 'systemSizeKw', label: 'System Size kW', kind: 'number' },
    { key: 'roofPhoto', label: 'Roof Photo URI', section: 'Photos' },
    { key: 'inverterBrandModel', label: 'Inverter Brand / Model' },
    { key: 'inverterLocation', label: 'Inverter Location' },
    { key: 'inverterLabelPhoto', label: 'Inverter Label Photo URI', section: 'Photos' },
    { key: 'powerSupplyToPv', label: 'Power Supply to PV' },
    { key: 'electricityMeterPhoto', label: 'Electricity Meter Photo URI', section: 'Photos' },
    { key: 'availableRoofSpace', label: 'Available Roof Space' },
    { key: 'roofSpaceAmount', label: 'Roof Space Amount' },
    { key: 'additionalSolarSpacePhoto', label: 'Additional Solar Space Photo URI', section: 'Photos' },
    { key: 'suitableSwitchboard', label: 'Suitable Switchboard' },
    { key: 'switchboardPhoto', label: 'Switchboard Photo URI', section: 'Photos' },
    { key: 'switchboardLocation', label: 'Switchboard Location' },
    { key: 'cableDistance', label: 'Cable Distance' },
    { key: 'cableRouteDescription', label: 'Cable Route Description', kind: 'multiline' },
    ...commonEquipmentTail,
  ],
  'forklift-chargers': [
    { key: 'chargerType', label: 'Charger Type', required: true },
    { key: 'chargerPhoto', label: 'Charger Photo URI', section: 'Photos' },
    { key: 'brandModel', label: 'Brand / Model' },
    { key: 'rating', label: 'Rating' },
    { key: 'chargerLabelPhoto', label: 'Charger Label Photo URI', section: 'Photos' },
    { key: 'powerSupply', label: 'Power Supply' },
    { key: 'electricConnectionPhoto', label: 'Electric Connection Photo URI', section: 'Photos' },
    { key: 'location', label: 'Location' },
    { key: 'quantity', label: 'Quantity', kind: 'number' },
    { key: 'chargerSpacePhoto', label: 'Charger Space Photo URI', section: 'Photos' },
    { key: 'connectionDescription', label: 'Connection Description', kind: 'multiline' },
    { key: 'socketConnectionPhoto', label: 'Socket Connection Photo URI', section: 'Photos' },
    { key: 'localIsolator', label: 'Local Isolator' },
    { key: 'circuitIdentifiable', label: 'Circuit Identifiable' },
    { key: 'distanceToSwitchboard', label: 'Distance to Switchboard' },
    { key: 'spaceForAdditional', label: 'Space for Additional' },
    { key: 'hardwiredSocket', label: 'Hardwired / Socket' },
    { key: 'schedulingOpportunity', label: 'Scheduling Opportunity' },
    ...commonEquipmentTail,
  ],
  'hot-water-systems': [
    { key: 'dhwDetailsType', label: 'DHW Details / Type', required: true },
    { key: 'photo', label: 'Photo URI', section: 'Photos' },
    { key: 'serialNumber', label: 'Serial Number' },
    { key: 'sizeLiters', label: 'Size Litres', kind: 'number' },
    { key: 'fuelType', label: 'Fuel Type' },
    { key: 'location', label: 'Location' },
    { key: 'pipeInsulation', label: 'Pipe Insulation' },
    { key: 'pipeInsulationThickness', label: 'Pipe Insulation Thickness' },
    { key: 'temperingValve', label: 'Tempering Valve' },
    { key: 'additionalPhoto', label: 'Additional Photo URI', section: 'Photos' },
    { key: 'moreDhwSystems', label: 'More DHW Systems' },
    { key: 'additionalComments', label: 'Additional Comments', kind: 'multiline' },
    ...commonEquipmentTail,
  ],
  'general-water': [
    { key: 'question', label: 'Question', kind: 'multiline' },
    { key: 'answer', label: 'Answer', kind: 'multiline' },
    { key: 'photos', label: 'Photos', kind: 'array', section: 'Photos' },
    ...commonEquipmentTail,
  ],
  'general-electricity': [
    { key: 'question', label: 'Question', kind: 'multiline' },
    { key: 'answer', label: 'Answer', kind: 'multiline' },
    { key: 'photos', label: 'Photos', kind: 'array', section: 'Photos' },
    ...commonEquipmentTail,
  ],
};

function equipmentDisplayName(record: EntityRecord, type: string): string {
  return String(
    record.name
      ?? record.unitName
      ?? record.lightType
      ?? record.chargerType
      ?? record.dhwDetailsType
      ?? record.inverterBrandModel
      ?? record.question
      ?? record.id
      ?? type,
  );
}

export function ecoAuditEquipmentConfig(type: string): EntityConfig {
  const typeLabel = equipmentTypes.find((item) => item.value === type)?.label ?? 'Equipment';
  const fields = equipmentFieldMap[type] ?? equipmentFieldMap['main-switchboards'];
  return {
    id: `ecoaudit-equipment-${type}`,
    title: `EcoAudit Pro ${typeLabel}`,
    description: 'Manage equipment records for a selected audit and zone.',
    entityLabel: 'equipment item',
    contextFields: [
      { key: 'auditId', label: 'Audit ID', required: true, placeholder: 'Paste the EcoAudit audit ID' },
      { key: 'zoneId', label: 'Zone ID', required: true, placeholder: 'Paste the EcoAudit zone ID' },
    ],
    listPath: (context) => context.auditId ? `/v1/ecoaudit/audits/${enc(context.auditId)}/${enc(type)}` : null,
    createPath: (context) => context.auditId ? `/v1/ecoaudit/audits/${enc(context.auditId)}/${enc(type)}` : null,
    updatePath: (record) => `/v1/ecoaudit/${enc(type)}/${enc(id(record))}`,
    deletePath: (record) => `/v1/ecoaudit/${enc(type)}/${enc(id(record))}`,
    filterRecords: (records, context) => records.filter((record) => String(record.zoneId ?? '') === context.zoneId),
    displayName: (record) => equipmentDisplayName(record, type),
    defaultValues: (context) => ({
      auditId: context.auditId,
      zoneId: context.zoneId,
      extraPhotos: [],
      photos: [],
      photoDescs: {},
    }),
    beforeCreate: (record, context) => ({ ...record, auditId: context.auditId, zoneId: context.zoneId }),
    fields,
    listColumns: [
      { key: 'name', label: 'Name', fallback: 'unitName' },
      { key: 'zoneId', label: 'Zone' },
      { key: 'updatedAt', label: 'Updated' },
    ],
  };
}
