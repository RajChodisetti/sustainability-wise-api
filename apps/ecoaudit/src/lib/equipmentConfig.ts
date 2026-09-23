export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'datetime'
  | 'calculated'
  | 'customFields'
  | 'photo'
  | 'photos';

export type FieldCondition = {
  key: string;
  values: string[];
};

export type FieldCalculation = {
  operation: 'divide' | 'multiply';
  operands: [string, string?];
  factor?: number;
  decimalPlaces?: number;
};

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  condition?: FieldCondition;
  calculation?: FieldCalculation;
  storage?: 'root' | 'data';
  placeholder?: string;
  step?: number;
  required?: boolean;
};

export type EquipmentTypeConfig = {
  slug: string;
  label: string;
  icon: string;
  entityType: string;
  apiSlug?: string;
  assetType?: 'water_meter' | 'water_submeter_logger' | 'water_fixture' | 'water_asset_system';
  nameField: string;
  nameLabel: string;
  fields: FieldDef[];
};

const sharedTail: FieldDef[] = [
  { key: 'extraNotes', label: 'Extra notes', kind: 'textarea' },
  { key: 'extraPhotos', label: 'Extra photos', kind: 'photos' },
];

const waterRoot = (key: string, label: string, kind: FieldKind, options?: string[]): FieldDef => ({
  key,
  label,
  kind,
  storage: 'root',
  required: key === 'name' || key === 'category',
  ...(options ? { options } : {}),
});

const waterData = (
  key: string,
  label: string,
  kind: FieldKind = 'text',
  options?: string[],
  condition?: FieldCondition,
): FieldDef => ({
  key,
  label,
  kind,
  storage: 'data',
  ...(options ? { options } : {}),
  ...(condition ? { condition } : {}),
});

const fixtureCategories = [
  'Toilets (Pans & Cisterns)',
  'Urinals',
  'Hand Basins & Taps',
  'Showers',
  'Sink / Wash Basin',
  'Dishwasher',
  'Combi Oven / Steamer',
  'Ice Machine',
  'Zip Tap / Boiling Unit',
  'Pre-Rinse Spray Valve',
];

const systemCategories = [
  'Cooling Tower & Condenser',
  'Stormwater Harvesting & Recycle',
  'Aquatic & Recovery Facility',
  'Process Cooling & Industrial Equipment',
  'Dust Suppression / Truck Standpipe',
  'Network Leak / Pipework Defect',
];

const whenCategory = (...values: string[]): FieldCondition => ({ key: 'category', values });
const yesNo = ['Yes', 'No'];

export const EQUIPMENT_TYPES: EquipmentTypeConfig[] = [
  {
    slug: 'main-switchboards',
    label: 'Main Switchboards',
    icon: '⚡',
    entityType: 'main_switchboard',
    nameField: 'name',
    nameLabel: 'Name',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'mapLocator', label: 'Map locator', kind: 'text' },
      { key: 'siteNmi', label: 'Site NMI', kind: 'text' },
      { key: 'photo', label: 'Photo', kind: 'photo' },
      { key: 'subCircuitsDescription', label: 'Sub-circuits description', kind: 'textarea' },
      { key: 'comments', label: 'Comments', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'additional-switchboards',
    label: 'Additional Switchboards',
    icon: '🔌',
    entityType: 'additional_switchboard',
    nameField: 'name',
    nameLabel: 'Name',
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'mapLocator', label: 'Map locator', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'photo', label: 'Photo', kind: 'photo' },
      { key: 'subCircuitsDescription', label: 'Sub-circuits description', kind: 'textarea' },
      { key: 'comments', label: 'Comments', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'hvac-units',
    label: 'HVAC Units',
    icon: '❄️',
    entityType: 'hvac_unit',
    nameField: 'unitName',
    nameLabel: 'Unit name',
    fields: [
      { key: 'unitName', label: 'Unit name', kind: 'text' },
      { key: 'make', label: 'Make', kind: 'text' },
      { key: 'photo', label: 'Photo', kind: 'photo' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'model', label: 'Model', kind: 'text' },
      { key: 'serialNumber', label: 'Serial number', kind: 'text' },
      { key: 'heatingCapacityKw', label: 'Heating capacity (kW)', kind: 'number' },
      { key: 'coolingCapacityKw', label: 'Cooling capacity (kW)', kind: 'number' },
      { key: 'powerSupplyPhase', label: 'Power supply phase', kind: 'text' },
      { key: 'nameplatePhotos', label: 'Nameplate photo', kind: 'photo' },
      { key: 'indoorUnitModel', label: 'Indoor unit model', kind: 'text' },
      { key: 'indoorUnitSerial', label: 'Indoor unit serial', kind: 'text' },
      { key: 'indoorUnitNameplatePhoto', label: 'Indoor unit nameplate', kind: 'photo' },
      { key: 'controllerType', label: 'Controller type', kind: 'text' },
      { key: 'controllerModel', label: 'Controller model', kind: 'text' },
      { key: 'controllerPhoto', label: 'Controller photo', kind: 'photo' },
      { key: 'temperatureSensorType', label: 'Temperature sensor type', kind: 'text' },
      { key: 'systemCoverage', label: 'System coverage', kind: 'text' },
      { key: 'energyImprovementObservations', label: 'Energy improvement observations', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'lighting-systems',
    label: 'Lighting Systems',
    icon: '💡',
    entityType: 'lighting_system',
    nameField: 'lightType',
    nameLabel: 'Light type',
    fields: [
      { key: 'lightType', label: 'Light type', kind: 'text' },
      { key: 'brandModel', label: 'Brand / model', kind: 'text' },
      { key: 'photo', label: 'Photo', kind: 'photo' },
      { key: 'ratedWattage', label: 'Rated wattage', kind: 'number' },
      { key: 'quantity', label: 'Quantity', kind: 'number' },
      { key: 'fixturesInstalled', label: 'Fixtures installed', kind: 'text' },
      { key: 'fixturesPhoto', label: 'Fixtures photo', kind: 'photo' },
      { key: 'areaLocation', label: 'Area / location', kind: 'text' },
      { key: 'controlsType', label: 'Controls type', kind: 'text' },
      { key: 'operatingHours', label: 'Operating hours', kind: 'text' },
      { key: 'mountingHeight', label: 'Mounting height', kind: 'text' },
      { key: 'mountingConstraintsPhoto', label: 'Mounting constraints photo', kind: 'photo' },
      { key: 'circuitGrouping', label: 'Circuit grouping', kind: 'text' },
      { key: 'sensorsPhoto', label: 'Sensors photo', kind: 'photo' },
      { key: 'accessLimitations', label: 'Access limitations', kind: 'textarea' },
      { key: 'switchboardControlsPhoto', label: 'Switchboard / Lighting Controls Photo', kind: 'photo' },
      { key: 'energyImprovementObservations', label: 'Energy improvement observations', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'solar-pv',
    label: 'Solar PV',
    icon: '☀️',
    entityType: 'solar_pv',
    nameField: 'inverterBrandModel',
    nameLabel: 'Inverter brand/model',
    fields: [
      { key: 'systemSizeKw', label: 'System size (kW)', kind: 'number' },
      { key: 'roofPhoto', label: 'Roof photo', kind: 'photo' },
      { key: 'inverterBrandModel', label: 'Inverter brand/model', kind: 'text' },
      { key: 'inverterLocation', label: 'Inverter location', kind: 'text' },
      { key: 'inverterLabelPhoto', label: 'Inverter label photo', kind: 'photo' },
      { key: 'powerSupplyToPv', label: 'Power supply to PV', kind: 'text' },
      { key: 'electricityMeterPhoto', label: 'Electricity meter photo', kind: 'photo' },
      { key: 'availableRoofSpace', label: 'Available roof space', kind: 'text' },
      { key: 'roofSpaceAmount', label: 'Roof space amount', kind: 'text' },
      { key: 'additionalSolarSpacePhoto', label: 'Additional solar space photo', kind: 'photo' },
      { key: 'suitableSwitchboard', label: 'Suitable switchboard', kind: 'text' },
      { key: 'switchboardPhoto', label: 'Switchboard photo', kind: 'photo' },
      { key: 'switchboardLocation', label: 'Switchboard location', kind: 'text' },
      { key: 'cableDistance', label: 'Cable distance', kind: 'text' },
      { key: 'cableRouteDescription', label: 'Cable route description', kind: 'textarea' },
      { key: 'energyImprovementObservations', label: 'Energy improvement observations', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'forklift-chargers',
    label: 'Forklift Chargers',
    icon: '🔋',
    entityType: 'forklift_charger',
    nameField: 'chargerType',
    nameLabel: 'Charger type',
    fields: [
      { key: 'chargerType', label: 'Charger type', kind: 'text' },
      { key: 'chargerPhoto', label: 'Charger photo', kind: 'photo' },
      { key: 'brandModel', label: 'Brand / model', kind: 'text' },
      { key: 'rating', label: 'Rating', kind: 'text' },
      { key: 'chargerLabelPhoto', label: 'Charger label photo', kind: 'photo' },
      { key: 'powerSupply', label: 'Power supply', kind: 'text' },
      { key: 'electricConnectionPhoto', label: 'Electric connection photo', kind: 'photo' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'quantity', label: 'Quantity', kind: 'number' },
      { key: 'chargerSpacePhoto', label: 'Charger space photo', kind: 'photo' },
      { key: 'connectionDescription', label: 'Connection description', kind: 'textarea' },
      { key: 'socketConnectionPhoto', label: 'Socket connection photo', kind: 'photo' },
      { key: 'localIsolator', label: 'Local isolator', kind: 'text' },
      { key: 'circuitIdentifiable', label: 'Circuit identifiable', kind: 'text' },
      { key: 'distanceToSwitchboard', label: 'Distance to switchboard', kind: 'text' },
      { key: 'spaceForAdditional', label: 'Space for additional', kind: 'text' },
      { key: 'hardwiredSocket', label: 'Hardwired socket', kind: 'text' },
      { key: 'schedulingOpportunity', label: 'Scheduling opportunity', kind: 'text' },
      { key: 'energyImprovementObservations', label: 'Energy improvement observations', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'hot-water-systems',
    label: 'Hot Water Systems',
    icon: '🚿',
    entityType: 'hot_water_system',
    nameField: 'dhwDetailsType',
    nameLabel: 'DHW type',
    fields: [
      { key: 'dhwDetailsType', label: 'DHW details type', kind: 'text' },
      { key: 'photo', label: 'Photo', kind: 'photo' },
      { key: 'serialNumber', label: 'Serial number', kind: 'text' },
      { key: 'sizeLiters', label: 'Size (litres)', kind: 'number' },
      { key: 'fuelType', label: 'Fuel type', kind: 'text' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'pipeInsulation', label: 'Pipe insulation', kind: 'text' },
      { key: 'pipeInsulationThickness', label: 'Pipe insulation thickness', kind: 'text' },
      { key: 'temperingValve', label: 'Tempering valve', kind: 'text' },
      { key: 'additionalPhoto', label: 'Additional photo', kind: 'photo' },
      { key: 'moreDhwSystems', label: 'More DHW systems', kind: 'text' },
      { key: 'additionalComments', label: 'Additional comments', kind: 'textarea' },
      { key: 'energyImprovementObservations', label: 'Energy improvement observations', kind: 'textarea' },
      ...sharedTail,
    ],
  },
  {
    slug: 'water-meters',
    apiSlug: 'water-assets',
    assetType: 'water_meter',
    label: 'Water Meters',
    icon: '💧',
    entityType: 'water_asset',
    nameField: 'name',
    nameLabel: 'Meter Tag / ID',
    fields: [
      waterRoot('name', 'Meter Tag / ID', 'text'),
      waterData('meterType', 'Meter Type', 'select', ['Mechanical dial', 'Electromagnetic', 'Ultrasonic', 'Pulse-enabled']),
      waterData('waterSupplyType', 'Water Supply Type', 'select', ['Potable Main', 'Recycled Water', 'Harvested Stormwater', 'Bore/Groundwater']),
      waterData('meterSizeMm', 'Meter Size (mm)', 'number'),
      waterData('currentMeterReadingKl', 'Current Meter Reading (kL)', 'number'),
      waterData('readingDateTime', 'Reading Date / Time', 'datetime'),
      waterData('serialNumber', 'Serial Number'),
      waterData('makeModel', 'Make / Model'),
      waterData('operationalCondition', 'Operational Condition', 'select', ['Operating normally', 'Dial frosted', 'Flooded pit', 'Seized']),
      waterRoot('generalComments', 'General Comments', 'textarea'),
      waterRoot('customFields', 'Custom Questions', 'customFields'),
      waterRoot('photos', 'Photos', 'photos'),
    ],
  },
  {
    slug: 'water-submeters-loggers',
    apiSlug: 'water-assets',
    assetType: 'water_submeter_logger',
    label: 'Water Submeters / Loggers',
    icon: '📟',
    entityType: 'water_asset',
    nameField: 'name',
    nameLabel: 'Submeter / Logger Tag ID',
    fields: [
      waterRoot('name', 'Submeter / Logger Tag ID', 'text'),
      waterData('connectedToBms', 'Connected To BMS?', 'select', ['Yes', 'No', 'Dry-contact available']),
      waterData('dataLoggerFitted', 'Data Logger Fitted?', 'select', ['None', 'Wattwatchers', 'Kallipr', 'Outpost', 'EDMI', 'Other']),
      waterData('dataLoggerOther', 'Other Data Logger', 'text', undefined, { key: 'dataLoggerFitted', values: ['Other'] }),
      waterData('loggerSerial', 'Logger Serial'),
      waterData('pulseWeight', 'Pulse Weight', 'text'),
      waterData('areasEquipmentServed', 'Areas / Equipment Served', 'textarea'),
      waterData('currentMeterReadingKl', 'Current Meter Reading (kL)', 'number'),
      waterData('readingDateTime', 'Reading Date / Time', 'datetime'),
      waterData('submeteringImprovementOpportunity', 'Submetering Improvement Opportunity', 'textarea'),
      waterRoot('generalComments', 'General Comments', 'textarea'),
      waterRoot('customFields', 'Custom Questions', 'customFields'),
      waterRoot('photos', 'Photos', 'photos'),
    ],
  },
  {
    slug: 'water-fixtures',
    apiSlug: 'water-assets',
    assetType: 'water_fixture',
    label: 'Water Fixtures',
    icon: '🚰',
    entityType: 'water_asset',
    nameField: 'name',
    nameLabel: 'Fixture Location / Room ID',
    fields: [
      waterRoot('name', 'Fixture Location / Room ID', 'text'),
      waterData('waterSupplySource', 'Water Supply Source', 'select', ['Potable Main', 'Harvested Stormwater']),
      waterRoot('category', 'Fixture Category', 'select', fixtureCategories),

      waterData('totalToiletCount', 'Total Toilet Count', 'number', undefined, whenCategory('Toilets (Pans & Cisterns)')),
      waterData('flushMechanism', 'Flush Mechanism', 'select', ['Single', 'Dual', 'Pneumatic', 'Sensor'], whenCategory('Toilets (Pans & Cisterns)')),
      waterData('fullFlushVolumeL', 'Full Flush Volume (L)', 'number', undefined, whenCategory('Toilets (Pans & Cisterns)')),
      waterData('halfFlushVolumeL', 'Half Flush Volume (L)', 'number', undefined, whenCategory('Toilets (Pans & Cisterns)')),
      waterData('internalWeepLeakCount', 'Internal Weep / Leak Count', 'number', undefined, whenCategory('Toilets (Pans & Cisterns)')),

      waterData('totalUrinalCount', 'Total Urinal Count', 'number', undefined, whenCategory('Urinals')),
      waterData('systemType', 'System Type', 'select', ['Sensor-activated', 'Automated timer', 'Waterless', 'Manual Cistern Fed'], whenCategory('Urinals')),
      waterData('flushesPerHour', 'Flushes per Hour', 'number', undefined, whenCategory('Urinals')),
      waterData('volumePerFlushL', 'Volume per Flush (L)', 'number', undefined, whenCategory('Urinals')),

      waterData('totalBasinTapCount', 'Total Basin Tap Count', 'number', undefined, whenCategory('Hand Basins & Taps')),
      waterData('tapMechanism', 'Tap Mechanism', 'select', ['Push-timed', 'Infrared', 'Lever', 'Screw tap', 'Mixer Taps'], whenCategory('Hand Basins & Taps')),
      waterData('averageMeasuredFlowRateLMin', 'Average Measured Flow Rate (L/min)', 'number', undefined, whenCategory('Hand Basins & Taps')),
      waterData('averageRunTimeSeconds', 'Average Run Time (seconds)', 'number', undefined, whenCategory('Hand Basins & Taps')),
      waterData('faultyAeratorLeakCount', 'Faulty Aerator / Leak Count', 'number', undefined, whenCategory('Hand Basins & Taps')),

      waterData('totalShowerCount', 'Total Shower Count', 'number', undefined, whenCategory('Showers')),
      waterData('showerMechanism', 'Shower Mechanism', 'select', ['Aerated', 'Inefficient / fixed heads'], whenCategory('Showers')),
      waterData('averageMeasuredFlowRateLMin', 'Average Measured Flow Rate (L/min)', 'number', undefined, whenCategory('Showers')),
      waterData('showerheadWelsRating', 'Showerhead WELS Rating', 'text', undefined, whenCategory('Showers')),
      waterData('leakingShowerCount', 'Leaking Shower Count', 'number', undefined, whenCategory('Showers')),

      waterData('sinkPurpose', 'Sink Purpose', 'select', ['Food Prep', 'Hand Wash', 'Pot Wash', 'Cleaners Sink'], whenCategory('Sink / Wash Basin')),
      waterData('tapMechanism', 'Tap Mechanism', 'select', ['Lever', 'Quarter-turn', 'Sensor', 'Knee-operated', 'Push', 'Manual'], whenCategory('Sink / Wash Basin')),
      waterData('measuredFlowRateLMin', 'Measured Flow Rate (L/min)', 'number', undefined, whenCategory('Sink / Wash Basin')),
      waterData('welsStarRating', 'WELS Star Rating', 'text', undefined, whenCategory('Sink / Wash Basin')),

      waterData('waterConsumptionLPerCycle', 'Water Consumption (L/rack or cycle)', 'number', undefined, whenCategory('Dishwasher')),
      waterData('rinseCycleMode', 'Rinse Cycle Mode', 'select', ['Fresh potable', 'Recirculated'], whenCategory('Dishwasher')),

      waterData('steamGenerationType', 'Steam Generation Type', 'select', ['Boiler injection', 'Direct spray'], whenCategory('Combi Oven / Steamer')),
      waterData('drainQuenchFunctioning', 'Drain Quench Functioning?', 'select', ['Yes', 'No', 'Continuous to drain'], whenCategory('Combi Oven / Steamer')),

      waterData('coolingMechanism', 'Cooling Mechanism', 'select', ['Air-cooled', 'Water-cooled once-through'], whenCategory('Ice Machine')),
      waterData('iceYieldCapacityKgDay', 'Ice Yield Capacity (kg/day)', 'number', undefined, whenCategory('Ice Machine')),

      waterData('operationalStatus', 'Operational Status', 'select', ['Normal', 'Vent tube boiling over'], whenCategory('Zip Tap / Boiling Unit')),
      waterData('underBenchLeakCheck', 'Under-bench Leak Check', 'select', ['Dry', 'Pooling'], whenCategory('Zip Tap / Boiling Unit')),

      waterData('measuredFlowRateLMin', 'Measured Flow Rate (L/min)', 'number', undefined, whenCategory('Pre-Rinse Spray Valve')),
      waterData('welsStarRating', 'WELS Star Rating', 'text', undefined, whenCategory('Pre-Rinse Spray Valve')),
      waterData('shutOffValveCondition', 'Shut-off Valve Condition', 'select', ['Clean', 'Weeping', 'Continuous drip'], whenCategory('Pre-Rinse Spray Valve')),

      waterRoot('generalComments', 'General Comments', 'textarea'),
      waterRoot('customFields', 'Custom Questions and Supporting Photos', 'customFields'),
      waterRoot('photos', 'Photos', 'photos'),
    ],
  },
  {
    slug: 'water-assets-systems',
    apiSlug: 'water-assets',
    assetType: 'water_asset_system',
    label: 'Water Assets / Systems',
    icon: '🌊',
    entityType: 'water_asset',
    nameField: 'name',
    nameLabel: 'Asset Tag / System Name',
    fields: [
      waterRoot('name', 'Asset Tag / System Name', 'text'),
      waterRoot('category', 'Asset Category', 'select', systemCategories),

      waterData('makeModel', 'Make / Model', 'text', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('serialNumber', 'Serial Number', 'text', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('coolingCapacity', 'Cooling Capacity', 'number', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('coolingCapacityUnit', 'Cooling Capacity Unit', 'select', ['kW', 'TR'], whenCategory('Cooling Tower & Condenser')),
      waterData('associatedSystem', 'Associated System', 'select', ['Chilled water plant', 'EAF furnace cooling', 'Continuous caster'], whenCategory('Cooling Tower & Condenser')),
      waterData('waterSource', 'Water Source', 'text', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('makeUpMeterInstalled', 'Make-up Meter Installed?', 'select', yesNo, whenCategory('Cooling Tower & Condenser')),
      waterData('makeUpMeterCurrentReadingKl', 'Make-up Meter Current Reading (kL)', 'number', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('makeUpFloatValveType', 'Make-up Float Valve Type', 'text', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('makeUpFloatValveStatus', 'Make-up Float Valve Status', 'text', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('blowdownControlMethod', 'Blowdown Control Method', 'select', ['Automated conductivity', 'Timer', 'Continuous drain'], whenCategory('Cooling Tower & Condenser')),
      waterData('conductivityControllerMakeModel', 'Conductivity Controller Make / Model', 'text', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('conductivityControllerSetpointUsCm', 'Conductivity Controller Setpoint (µS/cm)', 'number', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('makeUpWaterTdsUsCm', 'Make-up Water TDS (µS/cm)', 'number', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('basinWaterTdsUsCm', 'Basin Water TDS (µS/cm)', 'number', undefined, whenCategory('Cooling Tower & Condenser')),
      {
        ...waterData('calculatedCyclesOfConcentration', 'Calculated Cycles of Concentration (CoC)', 'calculated', undefined, whenCategory('Cooling Tower & Condenser')),
        calculation: { operation: 'divide', operands: ['basinWaterTdsUsCm', 'makeUpWaterTdsUsCm'], decimalPlaces: 2 },
      },
      waterData('driftEliminatorCondition', 'Drift Eliminator Condition', 'textarea', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('basinIntegrityOverflowStatus', 'Basin Integrity & Overflow Status', 'textarea', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('chemicalDosingRegime', 'Chemical Dosing Regime', 'textarea', undefined, whenCategory('Cooling Tower & Condenser')),
      waterData('waterEfficiencyObservationsPaybackNotes', 'Water Efficiency Observations & Payback Notes', 'textarea', undefined, whenCategory('Cooling Tower & Condenser')),

      waterData('systemType', 'System Type', 'select', ['Stormwater harvesting', 'Heavy industrial scale pit', 'Oil-water separator'], whenCategory('Stormwater Harvesting & Recycle')),
      waterData('storageCapacityKl', 'Storage Capacity (kL)', 'number', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('collectionInflows', 'Collection Inflows', 'textarea', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('treatmentTrainAssets', 'Treatment Train Assets', 'textarea', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('systemStatus', 'System Status', 'textarea', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('supplyTargetEndUses', 'Supply Target End-Uses', 'textarea', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('supplyMeterReadingKl', 'Supply Meter Reading (kL)', 'number', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('backupPotableTopUpMechanism', 'Backup Potable Top-up Mechanism', 'textarea', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('backwashFrequency', 'Backwash Frequency', 'text', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('backwashDestination', 'Backwash Destination', 'text', undefined, whenCategory('Stormwater Harvesting & Recycle')),
      waterData('opportunitiesForExpansion', 'Opportunities for Expansion', 'textarea', undefined, whenCategory('Stormwater Harvesting & Recycle')),

      waterData('facilityType', 'Facility Type', 'select', ['Cold plunge bath', 'Heated spa', 'Hydrotherapy pool'], whenCategory('Aquatic & Recovery Facility')),
      waterData('poolVolumeKl', 'Pool Volume (kL)', 'number', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('operatingTemperatureC', 'Operating Temperature (°C)', 'number', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('autoTopUpMechanism', 'Auto Top-Up Mechanism', 'text', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('topUpDedicatedMeterPresent', 'Top-Up Dedicated Meter Present?', 'select', yesNo, whenCategory('Aquatic & Recovery Facility')),
      waterData('topUpDedicatedMeterReadingKl', 'Top-Up Dedicated Meter Reading (kL)', 'number', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('filtrationSystemType', 'Filtration System Type', 'text', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('backwashTriggerMethod', 'Backwash Trigger Method', 'text', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('backwashFrequency', 'Backwash Frequency', 'text', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('estimatedBackwashVolumeL', 'Estimated Backwash Volume (L)', 'number', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('backwashDischargeRoute', 'Backwash Discharge Route', 'text', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('balanceTankOverflowStatus', 'Balance Tank Overflow Status', 'text', undefined, whenCategory('Aquatic & Recovery Facility')),
      waterData('poolCoverAvailable', 'Pool Cover Available?', 'select', yesNo, whenCategory('Aquatic & Recovery Facility')),
      waterData('poolCoverUtilised', 'Pool Cover Utilised?', 'select', yesNo, whenCategory('Aquatic & Recovery Facility')),

      waterData('coolingCircuitType', 'Cooling Circuit Type', 'select', ['Closed-loop', 'Open evaporative', 'Once-through'], whenCategory('Process Cooling & Industrial Equipment')),
      waterData('waterSupplyType', 'Water Supply Type', 'text', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('operatingPressure', 'Operating Pressure', 'number', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('operatingPressureUnit', 'Operating Pressure Unit', 'select', ['kPa', 'bar'], whenCategory('Process Cooling & Industrial Equipment')),
      waterData('operatingFlowRate', 'Operating Flow Rate', 'number', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('operatingFlowRateUnit', 'Operating Flow Rate Unit', 'select', ['m³/hr', 'L/min'], whenCategory('Process Cooling & Industrial Equipment')),
      waterData('supplyTemperatureC', 'Supply Temperature (°C)', 'number', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('returnTemperatureC', 'Return Temperature (°C)', 'number', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('heatExchangerType', 'Heat Exchanger Type', 'text', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('heatExchangerCondition', 'Heat Exchanger Condition', 'textarea', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('billetCasterSprayNozzlesCondition', 'Billet Caster Spray Nozzles Condition', 'textarea', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('scalePitSettlementInterceptorStatus', 'Scale Pit Settlement & Interceptor Status', 'textarea', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('quenchTanksSlagCoolingWaterSource', 'Quench Tanks / Slag Cooling Water Source', 'textarea', undefined, whenCategory('Process Cooling & Industrial Equipment')),
      waterData('onceThroughPotableCoolingPresent', 'Once-Through Potable Cooling Present?', 'select', yesNo, whenCategory('Process Cooling & Industrial Equipment')),

      waterData('waterSupplySource', 'Water Supply Source', 'text', undefined, whenCategory('Dust Suppression / Truck Standpipe')),
      waterData('activationMethod', 'Activation Method', 'text', undefined, whenCategory('Dust Suppression / Truck Standpipe')),
      waterData('isolationValveIntegrity', 'Isolation Valve Integrity', 'textarea', undefined, whenCategory('Dust Suppression / Truck Standpipe')),
      waterData('controlStrategy', 'Control Strategy', 'select', ['Weather sensor', 'Manual operator'], whenCategory('Dust Suppression / Truck Standpipe')),

      waterData('specificLocationRoomLine', 'Specific Location / Room / Line', 'text', undefined, whenCategory('Network Leak / Pipework Defect')),
      waterData('pipeMaterial', 'Pipe Material', 'text', undefined, whenCategory('Network Leak / Pipework Defect')),
      waterData('pipeDiameter', 'Pipe Diameter', 'text', undefined, whenCategory('Network Leak / Pipework Defect')),
      waterData('defectClassification', 'Defect Classification', 'text', undefined, whenCategory('Network Leak / Pipework Defect')),
      waterData('estimatedLeakRateLHr', 'Estimated Leak Rate (L/hr)', 'number', undefined, whenCategory('Network Leak / Pipework Defect')),
      {
        ...waterData('associatedWaterLossKlYear', 'Associated Water Loss (kL/year)', 'calculated', undefined, whenCategory('Network Leak / Pipework Defect')),
        calculation: { operation: 'multiply', operands: ['estimatedLeakRateLHr'], factor: 8.76, decimalPlaces: 2 },
      },
      waterData('safetyHazardImplication', 'Safety Hazard Implication', 'textarea', undefined, whenCategory('Network Leak / Pipework Defect')),
      waterData('rectificationPriority', 'Rectification Priority', 'text', undefined, whenCategory('Network Leak / Pipework Defect')),
      waterData('estimatedRectificationCostAud', 'Estimated Rectification Cost ($)', 'number', undefined, whenCategory('Network Leak / Pipework Defect')),

      waterRoot('generalComments', 'General Comments', 'textarea'),
      waterRoot('customFields', 'Custom Questions and Supporting Photos', 'customFields'),
      waterRoot('photos', 'Photos', 'photos'),
    ],
  },
  {
    slug: 'general-water',
    label: 'General Water',
    icon: '💧',
    entityType: 'general_water',
    nameField: 'question',
    nameLabel: 'Question',
    fields: [
      { key: 'question', label: 'Question', kind: 'text' },
      { key: 'answer', label: 'Answer', kind: 'textarea' },
      { key: 'photos', label: 'Photos', kind: 'photos' },
      ...sharedTail,
    ],
  },
  {
    slug: 'general-electricity',
    label: 'General Electricity',
    icon: '🔆',
    entityType: 'general_electricity',
    nameField: 'question',
    nameLabel: 'Question',
    fields: [
      { key: 'question', label: 'Question', kind: 'text' },
      { key: 'answer', label: 'Answer', kind: 'textarea' },
      { key: 'photos', label: 'Photos', kind: 'photos' },
      ...sharedTail,
    ],
  },
];

const WATER_ASSET_AGGREGATE_CONFIG: EquipmentTypeConfig = {
  slug: 'water-assets',
  apiSlug: 'water-assets',
  label: 'Water Assets',
  icon: '💧',
  entityType: 'water_asset',
  nameField: 'name',
  nameLabel: 'Name',
  fields: [],
};

export function getEquipmentConfig(slug: string): EquipmentTypeConfig | undefined {
  return slug === WATER_ASSET_AGGREGATE_CONFIG.slug
    ? WATER_ASSET_AGGREGATE_CONFIG
    : EQUIPMENT_TYPES.find((t) => t.slug === slug);
}

export function getWaterAssetConfig(assetType: unknown): EquipmentTypeConfig | undefined {
  return typeof assetType === 'string'
    ? EQUIPMENT_TYPES.find((type) => type.assetType === assetType)
    : undefined;
}

export function equipmentDisplayName(item: Record<string, unknown>, config: EquipmentTypeConfig): string {
  const val = item[config.nameField];
  if (typeof val === 'string' && val.trim()) return val;
  return config.label;
}
