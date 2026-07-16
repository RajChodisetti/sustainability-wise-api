export type FieldKind = 'text' | 'textarea' | 'number' | 'photo' | 'photos';

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
};

export type EquipmentTypeConfig = {
  slug: string;
  label: string;
  icon: string;
  entityType: string;
  nameField: string;
  nameLabel: string;
  fields: FieldDef[];
};

const sharedTail: FieldDef[] = [
  { key: 'extraNotes', label: 'Extra notes', kind: 'textarea' },
  { key: 'extraPhotos', label: 'Extra photos', kind: 'photos' },
];

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

export function getEquipmentConfig(slug: string): EquipmentTypeConfig | undefined {
  return EQUIPMENT_TYPES.find((t) => t.slug === slug);
}

export function equipmentDisplayName(item: Record<string, unknown>, config: EquipmentTypeConfig): string {
  const val = item[config.nameField];
  if (typeof val === 'string' && val.trim()) return val;
  return config.label;
}
