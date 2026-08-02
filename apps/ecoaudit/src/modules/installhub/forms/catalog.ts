import type {
  FormSubmission,
  FormType,
  Installation,
  InstallHubUser,
  Meter,
} from '@/modules/installhub/types/domain';
import { createInstallHubId } from '@/modules/installhub/lib/id';

export type FormFieldKind =
  | 'text'
  | 'multiline'
  | 'number'
  | 'yesno'
  | 'select'
  | 'photo';
export type ScanMode = 'barcode' | 'qr';
export type Visibility = {
  key: string;
  equals: string | readonly string[];
};

export type FormFieldDefinition = {
  key: string;
  label: string;
  kind: FormFieldKind;
  required?: boolean;
  options?: readonly string[];
  placeholder?: string;
  multiple?: boolean;
  showWhen?: Visibility | readonly Visibility[];
  optionsWhen?: {
    key: string;
    values: Readonly<Record<string, readonly string[]>>;
  };
  scanModes?: readonly ScanMode[];
  allowNotApplicable?: boolean;
};

export type FormSectionDefinition = {
  title: string;
  fields: readonly FormFieldDefinition[];
  showWhen?: Visibility | readonly Visibility[];
};

export type FormDefinition = {
  type: FormType;
  title: string;
  shortTitle: string;
  description: string;
  schemaVersion: number;
  availableForNew?: boolean;
  sections: readonly FormSectionDefinition[];
};

const text = (
  key: string,
  label: string,
  required = false,
): FormFieldDefinition => ({ key, label, kind: 'text', required });
const multiline = (
  key: string,
  label: string,
  required = false,
): FormFieldDefinition => ({ key, label, kind: 'multiline', required });
const number = (
  key: string,
  label: string,
  required = false,
): FormFieldDefinition => ({ key, label, kind: 'number', required });
const yes = (
  key: string,
  label: string,
  required = true,
): FormFieldDefinition => ({ key, label, kind: 'yesno', required });
const photo = (
  key: string,
  label: string,
  required = true,
  showWhen?: Visibility | readonly Visibility[],
): FormFieldDefinition => ({
  key,
  label,
  kind: 'photo',
  required,
  multiple: true,
  ...(showWhen ? { showWhen } : {}),
});
const scan = (
  key: string,
  label: string,
  modes: readonly ScanMode[] = ['barcode'],
  required = true,
): FormFieldDefinition => ({
  ...text(key, label, required),
  scanModes: modes,
});

export const DEVICE_TYPES = ['A3RM', 'A6M'] as const;
export const SENSOR_OPTIONS_BY_DEVICE: Readonly<
  Record<(typeof DEVICE_TYPES)[number], readonly string[]>
> = {
  A3RM: ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm'],
  A6M: ['60A', '120A', '200A', '400A', '600A'],
};
const LOADS = [
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
  'Not Used',
] as const;
const SUB_CIRCUIT_LOADS = LOADS.filter(
  (load) => load !== 'Mains Supply' && load !== 'Not Used',
);
const LOADS_BY_PURPOSE: Readonly<Record<string, readonly string[]>> = {
  'Main board supply': ['Mains Supply'],
  'Sub-circuit / asset': SUB_CIRCUIT_LOADS,
};
const USED_LOADS = LOADS.filter((load) => load !== 'Not Used');
const SIGNALS = [
  'Excellent',
  'Good',
  'Fair',
  'Poor',
  'No signal',
  'N/A',
] as const;
const ANTENNAS = [
  'Internal',
  'CSM550 - External High Gain',
  'Other',
  'N/A',
] as const;

function deviceType(
  key: string,
  label = 'Meter / Device Type',
  showWhen?: Visibility | readonly Visibility[],
): FormFieldDefinition {
  return {
    key,
    label,
    kind: 'select',
    options: DEVICE_TYPES,
    required: true,
    ...(showWhen ? { showWhen } : {}),
  };
}

function sensor(
  key: string,
  deviceTypeKey: string,
  label: string,
  showWhen?: Visibility | readonly Visibility[],
): FormFieldDefinition {
  return {
    key,
    label,
    kind: 'select',
    required: true,
    optionsWhen: {
      key: deviceTypeKey,
      values: SENSOR_OPTIONS_BY_DEVICE,
    },
    ...(showWhen ? { showWhen } : {}),
  };
}

const siteFields: readonly FormFieldDefinition[] = [
  text('site.date_time', 'Date and time', true),
  text('site.customer_name', 'Customer / site name', true),
  multiline('site.address', 'Address', true),
  number('site.latitude', 'Latitude'),
  number('site.longitude', 'Longitude'),
];

const installerFields: readonly FormFieldDefinition[] = [
  text('installer.name', 'Installer name', true),
  text('installer.electrical_license', 'Electrical licence number'),
];

const prestartFields: readonly FormFieldDefinition[] = [
  yes(
    'prestart.site_inspection',
    'Initial site inspection / checklist completed?',
    false,
  ),
  yes('prestart.site_induction', 'Is a site induction required?'),
  yes('prestart.safe_access', 'Do you have safe access?'),
  yes('prestart.correct_ppe', 'Do you have the correct PPE?'),
  yes('prestart.live_points', 'Are you aware of all LIVE points?'),
  yes('prestart.can_isolate', 'Can the power source be safely isolated?'),
  yes('prestart.additional_hazards', 'Additional hazards identified?'),
  {
    ...multiline(
      'prestart.hazard_comments',
      'Additional hazard comments',
    ),
    showWhen: { key: 'prestart.additional_hazards', equals: 'yes' },
  },
  yes('prestart.safe_to_proceed', 'Can you safely proceed?'),
];

function commonSections(): FormSectionDefinition[] {
  return [
    { title: 'Site details', fields: siteFields },
    { title: 'Installer details', fields: installerFields },
    { title: 'Pre-start information', fields: prestartFields },
  ];
}

function wwChannelSections(): FormSectionDefinition[] {
  return Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const prefix = `channel.${channel}`;
    return {
      title: `Channel ${channel}`,
      showWhen: {
        key: 'device.type',
        equals: channel <= 3 ? DEVICE_TYPES : 'A6M',
      },
      fields: [
        {
          key: `${prefix}.purpose`,
          label: 'Channel purpose',
          kind: 'select' as const,
          options: ['Main board supply', 'Sub-circuit / asset', 'Spare / unused'],
          required: true,
        },
        {
          key: `${prefix}.load`,
          label: 'Load',
          kind: 'select' as const,
          optionsWhen: {
            key: `${prefix}.purpose`,
            values: LOADS_BY_PURPOSE,
          },
          required: true,
          showWhen: {
            key: `${prefix}.purpose`,
            equals: ['Main board supply', 'Sub-circuit / asset'],
          },
        },
        {
          ...text(`${prefix}.custom_load_type`, 'Custom load type', true),
          showWhen: { key: `${prefix}.load`, equals: 'Other' },
        },
        sensor(
          `${prefix}.rating`,
          'device.type',
          'CT / Rogowski coil rating',
          { key: `${prefix}.load`, equals: USED_LOADS },
        ),
        {
          ...text(`${prefix}.description`, 'Load description'),
          showWhen: { key: `${prefix}.load`, equals: USED_LOADS },
        },
        photo(
          `${prefix}.nameplate_photos`,
          'Load / nameplate photos',
          false,
          { key: `${prefix}.load`, equals: USED_LOADS },
        ),
      ],
    };
  });
}

function wwCommissioningFields(): FormFieldDefinition[] {
  const channelFields = Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const channelUsed: Visibility = {
      key: `channel.${channel}.load`,
      equals: USED_LOADS,
    };
    return [
      {
        ...yes(
          `commissioning.channel_${channel}_polarity`,
          `Channel ${channel} polarity correct?`,
          false,
        ),
        showWhen: channelUsed,
      },
      {
        ...number(
          `commissioning.channel_${channel}_current`,
          `Channel ${channel} current - AC clamp tester`,
        ),
        showWhen: channelUsed,
      },
    ];
  }).flat();
  return [
    yes('commissioning.energised', 'Is the Auditor energised?'),
    yes('commissioning.leds_visible', 'Are all three LEDs visible?'),
    yes(
      'commissioning.online',
      'Is the Auditor online in the WW Onboarding App?',
    ),
    {
      key: 'commissioning.signal_strength',
      label: '4G signal strength',
      kind: 'select',
      options: SIGNALS,
      required: true,
    },
    {
      key: 'commissioning.antenna_type',
      label: 'Antenna type',
      kind: 'select',
      options: ANTENNAS,
      required: true,
    },
    yes('commissioning.start_complete', 'Start page completed?'),
    photo('commissioning.start_screenshot', 'Start page screenshot'),
    yes('commissioning.channels_complete', 'Channels page completed?'),
    photo('commissioning.channels_screenshot', 'Channels page screenshot'),
    number(
      'commissioning.phase_a_voltage',
      'Phase A voltage - multi meter',
      true,
    ),
    number(
      'commissioning.phase_b_voltage',
      'Phase B voltage - multi meter',
      true,
    ),
    number(
      'commissioning.phase_c_voltage',
      'Phase C voltage - multi meter',
      true,
    ),
    ...channelFields,
    photo('commissioning.energy_screenshot', 'Energy page screenshot'),
    photo(
      'commissioning.completed_photos',
      'Completed installation photos',
    ),
    multiline('commissioning.final_comments', 'Final comments'),
  ];
}

const wwInstallation: FormDefinition = {
  type: 'ww-installation',
  title: 'SW MaaS - 4G Auditor Installation Form',
  shortTitle: 'Installation Form (WW)',
  description:
    'A3RM/A6M installation, channel setup, evidence and commissioning.',
  schemaVersion: 2,
  sections: [
    ...commonSections(),
    {
      title: '4G Auditor installation details',
      fields: [
        text('auditor.switchboard_name', 'Switchboard name', true),
        text('auditor.switchboard_location', 'Switchboard location', true),
        text('auditor.switchboard_type', 'Type of switchboard', true),
        text('auditor.site_nmi', 'Site NMI'),
        photo('auditor.location_before', 'Auditor location photos'),
        photo(
          'auditor.sensor_before',
          'CT / Rogowski coil location photos',
        ),
        photo(
          'auditor.cb_before',
          'Circuit breaker location photos',
        ),
        deviceType('device.type'),
        scan('device.number', 'Device Number'),
        scan('device.id', 'Device ID / serial'),
      ],
    },
    ...wwChannelSections(),
    {
      title: 'Installed evidence',
      fields: [
        photo(
          'auditor.installed_location',
          'Installed Auditor location photos',
        ),
        photo('auditor.serial_photo', 'Auditor serial-number photos'),
        photo(
          'auditor.sensor_installed',
          'Installed CT / Rogowski coil location photos',
        ),
        photo(
          'auditor.cb_installed',
          'Installed circuit-breaker location photos',
        ),
      ],
    },
    { title: 'Commissioning', fields: wwCommissioningFields() },
  ],
};

const replacementVisible: Visibility = {
  key: 'works.replace_device',
  equals: 'yes',
};

const commsFault: FormDefinition = {
  type: 'comms-fault',
  title: 'SW MaaS - Comms Fault',
  shortTitle: 'Comms Fault',
  description:
    'Diagnose, replace and recommission an existing 4G Auditor.',
  schemaVersion: 2,
  sections: [
    { title: 'Customer details', fields: siteFields },
    { title: 'Installer details', fields: installerFields },
    { title: 'Pre-start information', fields: prestartFields },
    {
      title: 'Existing installation',
      fields: [
        text(
          'existing.switchboard_location',
          'Switchboard location',
          true,
        ),
        text('existing.switchboard_type', 'Type of switchboard', true),
        text('existing.site_nmi', 'Site NMI'),
        photo('existing.switchboard_photos', 'Whole switchboard photos'),
        deviceType(
          'existing.device_type',
          'Existing Meter / Device Type',
        ),
        scan('existing.device_number', 'Existing Device Number'),
        scan('existing.device_id', 'Existing Device ID / serial'),
        sensor(
          'existing.sensor_rating',
          'existing.device_type',
          'Existing CT / Rogowski coil rating',
          { key: 'existing.device_type', equals: DEVICE_TYPES },
        ),
        yes('existing.energised', 'Is the Auditor energised?'),
        yes('existing.leds_visible', 'Are LEDs visible?'),
        yes('existing.online', 'Is the Auditor online in the WW app?'),
        {
          key: 'existing.signal',
          label: 'Existing signal strength',
          kind: 'select',
          options: SIGNALS,
        },
        {
          key: 'existing.antenna',
          label: 'Existing antenna type',
          kind: 'select',
          options: ANTENNAS,
        },
      ],
    },
    {
      title: 'On-site works',
      fields: [
        yes('works.rebooted', 'Device rebooted?'),
        yes(
          'works.leds_visible',
          'Relevant LEDs visible after reboot?',
        ),
        yes('works.replace_device', 'Does the device need replacement?'),
        deviceType(
          'works.new_device_type',
          'New Meter / Device Type',
          replacementVisible,
        ),
        {
          ...scan('works.new_device_number', 'New Device Number'),
          showWhen: replacementVisible,
        },
        {
          ...scan('works.new_device_id', 'New Device ID / serial'),
          showWhen: replacementVisible,
        },
        sensor(
          'works.new_sensor_rating',
          'works.new_device_type',
          'New CT / Rogowski coil rating',
          { key: 'works.new_device_type', equals: DEVICE_TYPES },
        ),
        {
          ...yes('works.new_online', 'Is the new device online?'),
          showWhen: replacementVisible,
        },
        {
          key: 'works.new_signal',
          label: 'New device signal strength',
          kind: 'select',
          options: SIGNALS,
          showWhen: replacementVisible,
        },
        yes(
          'works.external_antenna',
          'Install an external antenna?',
        ),
        {
          key: 'works.external_signal',
          label: 'Signal after external antenna',
          kind: 'select',
          options: SIGNALS,
          showWhen: {
            key: 'works.external_antenna',
            equals: 'yes',
          },
        },
        yes('works.extend_antenna', 'Extend the external antenna?'),
        {
          key: 'works.extended_signal',
          label: 'Signal after antenna extension',
          kind: 'select',
          options: SIGNALS,
          showWhen: {
            key: 'works.extend_antenna',
            equals: 'yes',
          },
        },
      ],
    },
    {
      title: 'Commissioning details',
      fields: [
        {
          ...yes(
            'commissioning.onboarding_complete',
            'WW Onboarding App completed for the new device?',
          ),
          showWhen: replacementVisible,
        },
        {
          ...yes(
            'commissioning.details_same',
            'New device details match the old device?',
          ),
          showWhen: replacementVisible,
        },
        photo(
          'commissioning.start_screenshot',
          'Start page screenshot',
          true,
          replacementVisible,
        ),
        photo(
          'commissioning.energy_screenshot',
          'Energy page screenshot',
          true,
          replacementVisible,
        ),
        photo(
          'commissioning.completed_photos',
          'Final completed-work photos',
        ),
        multiline('commissioning.final_comments', 'Final comments'),
      ],
    },
  ],
};

const aceSwitchboard: FormDefinition = {
  type: 'ace-switchboard',
  title:
    'ACE Switchboards - Installation, Testing and Commissioning Form',
  shortTitle: 'ACE Switchboard',
  description:
    'CT chamber, meter panel, wiring, testing and final checks.',
  schemaVersion: 2,
  sections: [
    {
      title: 'Switchboard details',
      fields: [
        text('site.date_time', 'Date', true),
        text('job.name', 'Job name', true),
        scan('job.number', 'Job number'),
        scan(
          'job.qr_link',
          'Switchboard QR / document link',
          ['qr'],
          false,
        ),
      ],
    },
    {
      title: 'Installer details',
      fields: [
        ...installerFields,
        text('installer.rec_number', 'REC number'),
      ],
    },
    {
      title: 'Installation information',
      fields: [
        yes('install.ct_installed', 'Have the CTs been installed?'),
        yes(
          'install.ct_orientation',
          'Are CTs installed with P1 facing the grid?',
        ),
        text('install.ct_ratio', 'CT ratio', true),
        scan('install.ct_serial_a', 'Phase A CT serial number'),
        scan('install.ct_serial_b', 'Phase B CT serial number'),
        scan('install.ct_serial_c', 'Phase C CT serial number'),
        photo('install.ct_chamber_photo', 'CT chamber photos'),
        yes('install.test_block', 'Has a test block been installed?'),
        yes(
          'install.remove_star_point',
          'Does the star point need removal?',
        ),
        yes(
          'install.star_point_removed',
          'Has the star point been removed?',
        ),
        yes('install.ct_fuses', 'Fuses installed in CT chamber?'),
        text('install.ct_fuse_rating', 'CT chamber fuse rating'),
        yes(
          'install.secondary_fuses',
          'Secondary fuses installed on meter panel?',
        ),
        text(
          'install.secondary_fuse_rating',
          'Meter panel fuse rating',
        ),
        photo('install.meter_panel_photo', 'Meter panel photos'),
        yes('install.loom_installed', 'Has the loom cable been installed?'),
        text('install.loom_type', 'Loom cable type'),
        text('install.loom_size', 'Loom cable size'),
        yes(
          'install.wiring_complete',
          'CT chamber and meter panel wiring complete?',
        ),
        photo(
          'install.ct_wiring_photo',
          'Completed CT chamber wiring photos',
        ),
        photo(
          'install.panel_wiring_photo',
          'Completed meter panel wiring photos',
        ),
      ],
    },
    {
      title: 'Pre-commissioning',
      fields: [
        yes('precommission.test_meter', 'Test meter connected?'),
        yes(
          'precommission.point_to_point',
          'Point-to-point testing completed?',
        ),
        yes('precommission.load_box', '100A load box connected?'),
        yes(
          'precommission.safe_energise',
          'Safe to energise for testing?',
        ),
        yes('precommission.correct_ppe', 'Correct PPE worn?'),
        yes(
          'precommission.energised',
          'Installation energised and live points understood?',
        ),
        yes(
          'precommission.ct_ratio_set',
          'Correct CT ratio set in test meter?',
        ),
      ],
    },
    {
      title: 'Commissioning / testing',
      fields: [
        ...['a', 'b', 'c'].flatMap((phase) => [
          number(
            `testing.phase_${phase}_voltage`,
            `Phase ${phase.toUpperCase()} voltage`,
            true,
          ),
          number(
            `testing.phase_${phase}_primary_current`,
            `Phase ${phase.toUpperCase()} primary current`,
            true,
          ),
          number(
            `testing.phase_${phase}_secondary_current`,
            `Phase ${phase.toUpperCase()} secondary current`,
            true,
          ),
        ]),
        photo(
          'testing.status_screen',
          'EziView status-screen photos',
        ),
        photo(
          'testing.phasor_diagram',
          'EziView phasor-diagram photos',
        ),
      ],
    },
    {
      title: 'Final checks',
      fields: [
        yes('final.deenergised', 'Installation de-energised?'),
        yes('final.load_box_removed', 'Load box removed?'),
        yes('final.test_meter_removed', 'Test meter removed?'),
        yes(
          'final.connectors_installed',
          'Single-screw connectors installed?',
        ),
        yes('final.connections_checked', 'All connections checked?'),
        yes(
          'final.completed',
          'Installation, testing and commissioning completed?',
        ),
        photo(
          'final.completed_photo',
          'Completed installation photos',
        ),
      ],
    },
  ],
};

const honeywell: FormDefinition = {
  type: 'honeywell-q400',
  title: 'SW MaaS - Honeywell Q400 Water Meter Installation Form',
  shortTitle: 'Honeywell Q400',
  description:
    'Water-meter activation, registration and installation evidence.',
  schemaVersion: 2,
  sections: [
    {
      title: 'Installation details',
      fields: [
        ...siteFields,
        text(
          'water.physical_location',
          'Physical meter location',
          true,
        ),
      ],
    },
    { title: 'Installer details', fields: installerFields.slice(0, 1) },
    {
      title: 'Water meter information',
      fields: [
        scan('water.serial_number', 'Water meter serial number'),
        yes(
          'water.activated',
          'Activated per SW work instructions?',
        ),
        yes(
          'water.network_registered',
          'Registered to the network?',
        ),
        photo('water.lcd_photo', 'LCD screen showing 4 0 2'),
        photo(
          'water.completed_photo',
          'Completed water-meter installation',
        ),
      ],
    },
  ],
};

function loggerDefinition(
  type: 'captis-logger' | 'sums-logger',
): FormDefinition {
  const isSums = type === 'sums-logger';
  return {
    type,
    title: `SW MaaS - ${isSums ? 'SUMS' : 'Captis'} Logger Installation Form`,
    shortTitle: `${isSums ? 'SUMS' : 'Captis'} Logger`,
    description: `Water meter, pulse sensor and ${isSums ? 'SUMS' : 'Captis'}/Cumulocity commissioning.`,
    schemaVersion: 2,
    sections: [
      {
        title: 'Installation details',
        fields: [
          ...siteFields,
          text(
            'captis.physical_location',
            `Physical ${isSums ? 'SUMS' : 'Captis'} Logger location`,
            true,
          ),
          text(
            'captis.supply_description',
            'Meter supply description',
            true,
          ),
        ],
      },
      {
        title: 'Installer details',
        fields: installerFields.slice(0, 1),
      },
      {
        title: 'Meter information',
        fields: [
          text('meter.type', 'Meter type', true),
          text('meter.make', 'Meter make', true),
          text('meter.model', 'Meter model', true),
          scan(
            'meter.serial_number',
            'Meter serial number',
            isSums ? ['barcode', 'qr'] : ['barcode'],
          ),
          text('meter.sensor_type', 'Pulse / sensor type', true),
          text('meter.flow_rate', 'Pulse / flow rate', true),
          text(
            'meter.current_read',
            'Current meter read (offset value)',
            true,
          ),
          photo('meter.face_photo', 'Meter face close-up'),
        ],
      },
      {
        title: `${isSums ? 'SUMS' : 'Captis'} Logger information`,
        fields: [
          scan(
            'logger.serial_number',
            `${isSums ? 'SUMS' : 'Captis'} Logger serial number`,
            isSums ? ['barcode', 'qr'] : ['barcode'],
          ),
          number(
            'logger.rsrp',
            'RSRP value / signal strength',
            true,
          ),
          yes(
            'logger.external_antenna',
            'External antenna installed?',
          ),
          yes(
            'logger.cumulocity_configured',
            'Cumulocity configured?',
          ),
          yes(
            'logger.screenshot_taken',
            'Cumulocity screenshot taken?',
          ),
          photo(
            'logger.cumulocity_screenshot',
            'Cumulocity screenshot',
          ),
        ],
      },
    ],
  };
}

function legacyDefinition(
  type: 'a3rm-installation' | 'a6m-installation',
): FormDefinition {
  const kind = type.startsWith('a3rm') ? 'A3RM' : 'A6M';
  const channelCount = kind === 'A3RM' ? 3 : 6;
  const sensorOptions = SENSOR_OPTIONS_BY_DEVICE[kind];
  const sensorName = kind === 'A3RM' ? 'Rogowski coil' : 'CT';
  const channelSections: FormSectionDefinition[] = Array.from(
    { length: channelCount },
    (_, index) => {
      const channel = index + 1;
      return {
        title: `Channel ${channel}`,
        fields: [
          {
            key: `channel.${channel}.rating`,
            label: `${sensorName} ${kind === 'A3RM' ? 'size' : 'rating'}`,
            kind: 'select',
            options: [...sensorOptions, 'Not Used'],
            required: true,
          },
          {
            key: `channel.${channel}.load`,
            label: 'Load',
            kind: 'select',
            options: LOADS,
            required: true,
          },
          text(`channel.${channel}.description`, 'Load description'),
          photo(
            `channel.${channel}.nameplate_photos`,
            'Load / nameplate photos',
            false,
          ),
        ],
      };
    },
  );
  const channelCommissioning = Array.from(
    { length: channelCount },
    (_, index) => {
      const channel = index + 1;
      const visible: Visibility = {
        key: `channel.${channel}.rating`,
        equals: sensorOptions,
      };
      return [
        {
          ...yes(
            `commissioning.channel_${channel}_polarity`,
            `Channel ${channel} polarity correct?`,
            false,
          ),
          showWhen: visible,
        },
        {
          ...number(
            `commissioning.channel_${channel}_current`,
            `Channel ${channel} current - AC clamp tester`,
          ),
          showWhen: visible,
        },
      ];
    },
  ).flat();
  return {
    type,
    title: `SW MaaS - ${kind} Auditor Installation Form`,
    shortTitle: `${kind} Installation`,
    description:
      `${kind} installation, channel setup, evidence and commissioning.`,
    schemaVersion: 1,
    availableForNew: false,
    sections: [
      ...commonSections(),
      {
        title: `${kind} installation details`,
        fields: [
          text('auditor.switchboard_name', 'Switchboard name', true),
          text(
            'auditor.switchboard_location',
            'Switchboard location',
            true,
          ),
          text('auditor.switchboard_type', 'Type of switchboard', true),
          text('auditor.site_nmi', 'Site NMI'),
          photo('auditor.location_before', 'Auditor location photos'),
          photo(
            'auditor.sensor_before',
            `${sensorName} location photos`,
          ),
          photo(
            'auditor.cb_before',
            'Circuit breaker location photos',
          ),
          text(
            'auditor.serial_number',
            `${kind} 4G Auditor serial number`,
            true,
          ),
        ],
      },
      ...channelSections,
      {
        title: 'Installed evidence',
        fields: [
          photo(
            'auditor.installed_location',
            'Installed Auditor location photos',
          ),
          photo(
            'auditor.serial_photo',
            'Auditor serial-number photos',
          ),
          photo(
            'auditor.sensor_installed',
            `Installed ${sensorName} location photos`,
          ),
          photo(
            'auditor.cb_installed',
            'Installed circuit-breaker location photos',
          ),
        ],
      },
      {
        title: 'Commissioning',
        fields: [
          yes('commissioning.energised', 'Is the Auditor energised?'),
          yes(
            'commissioning.leds_visible',
            'Are all three LEDs visible?',
          ),
          yes(
            'commissioning.online',
            'Is the Auditor online in the WW Onboarding App?',
          ),
          {
            key: 'commissioning.signal_strength',
            label: '4G signal strength',
            kind: 'select',
            options: SIGNALS,
            required: true,
          },
          {
            key: 'commissioning.antenna_type',
            label: 'Antenna type',
            kind: 'select',
            options: ANTENNAS,
            required: true,
          },
          yes(
            'commissioning.start_complete',
            'Start page completed?',
          ),
          photo(
            'commissioning.start_screenshot',
            'Start page screenshot',
          ),
          yes(
            'commissioning.channels_complete',
            'Channels page completed?',
          ),
          photo(
            'commissioning.channels_screenshot',
            'Channels page screenshot',
          ),
          number(
            'commissioning.phase_a_voltage',
            'Phase A voltage - multi meter',
            true,
          ),
          number(
            'commissioning.phase_b_voltage',
            'Phase B voltage - multi meter',
            true,
          ),
          number(
            'commissioning.phase_c_voltage',
            'Phase C voltage - multi meter',
            true,
          ),
          ...channelCommissioning,
          photo(
            'commissioning.energy_screenshot',
            'Energy page screenshot',
          ),
          photo(
            'commissioning.completed_photos',
            'Completed installation photos',
          ),
          multiline(
            'commissioning.final_comments',
            'Final comments',
          ),
        ],
      },
    ],
  };
}

export const FORM_DEFINITIONS: readonly FormDefinition[] = [
  wwInstallation,
  legacyDefinition('a3rm-installation'),
  legacyDefinition('a6m-installation'),
  commsFault,
  aceSwitchboard,
  honeywell,
  loggerDefinition('captis-logger'),
  loggerDefinition('sums-logger'),
];

export const FORM_DEFINITION_BY_TYPE = Object.fromEntries(
  FORM_DEFINITIONS.map((definition) => [definition.type, definition]),
) as Record<FormType, FormDefinition>;

function conditionMatches(
  condition: Visibility | readonly Visibility[] | undefined,
  answers: Record<string, string>,
): boolean {
  if (!condition) return true;
  const list = Array.isArray(condition) ? condition : [condition];
  return list.every((item) => {
    const expected = Array.isArray(item.equals)
      ? item.equals
      : [item.equals];
    return expected.includes(String(answers[item.key] ?? ''));
  });
}

export function isSectionVisible(
  section: FormSectionDefinition,
  answers: Record<string, string>,
): boolean {
  return conditionMatches(section.showWhen, answers);
}

export function isFieldVisible(
  field: FormFieldDefinition,
  answers: Record<string, string>,
): boolean {
  return conditionMatches(field.showWhen, answers);
}

export function optionsForField(
  field: FormFieldDefinition,
  answers: Record<string, string>,
): readonly string[] {
  if (!field.optionsWhen) return field.options ?? [];
  return (
    field.optionsWhen.values[
      String(answers[field.optionsWhen.key] ?? '')
    ] ?? []
  );
}

export function answersAfterChange(
  definition: FormDefinition,
  answers: Record<string, string>,
  key: string,
  value: string,
): {
  answers: Record<string, string>;
  hiddenPhotoSlots: string[];
} {
  const next = { ...answers, [key]: value };
  const hiddenPhotoSlots: string[] = [];
  for (const section of definition.sections) {
    const sectionVisible = isSectionVisible(section, next);
    for (const field of section.fields) {
      const visible = sectionVisible && isFieldVisible(field, next);
      if (!visible) {
        if (field.kind === 'photo') hiddenPhotoSlots.push(field.key);
        else delete next[field.key];
        continue;
      }
      if (field.optionsWhen?.key !== key) continue;
      const selected = String(next[field.key] ?? '');
      if (
        selected &&
        !optionsForField(field, next).includes(selected)
      ) {
        delete next[field.key];
      }
    }
  }
  return { answers: next, hiddenPhotoSlots };
}

export type FormValidationIssue = {
  fieldKey: string;
  message: string;
};

export function formValidationIssues(
  form: Pick<FormSubmission, 'formType' | 'answers' | 'attachments'>,
): FormValidationIssue[] {
  const definition = FORM_DEFINITION_BY_TYPE[form.formType];
  if (!definition) return [];
  const errors: FormValidationIssue[] = [];
  for (const section of definition.sections) {
    if (!isSectionVisible(section, form.answers)) continue;
    for (const field of section.fields) {
      if (!isFieldVisible(field, form.answers)) continue;
      if (field.kind === 'photo') {
        if (
          field.required &&
          !form.attachments.some(
            (attachment) => attachment.slot === field.key,
          )
        ) {
          errors.push({
            fieldKey: field.key,
            message: `${section.title}: ${field.label}`,
          });
        }
        continue;
      }
      const value = String(form.answers[field.key] ?? '').trim();
      if (!value && field.required) {
        errors.push({
          fieldKey: field.key,
          message: `${section.title}: ${field.label}`,
        });
      } else if (
        value &&
        field.kind === 'yesno' &&
        ![
          'yes',
          'no',
          ...(field.allowNotApplicable ? ['not_applicable'] : []),
        ].includes(value)
      ) {
        errors.push({
          fieldKey: field.key,
          message: `${section.title}: ${field.label} has an invalid selection`,
        });
      } else if (
        value &&
        field.kind === 'number' &&
        !Number.isFinite(Number(value))
      ) {
        errors.push({
          fieldKey: field.key,
          message: `${section.title}: ${field.label} must be a number`,
        });
      } else if (
        value &&
        field.kind === 'select' &&
        !optionsForField(field, form.answers).includes(value)
      ) {
        errors.push({
          fieldKey: field.key,
          message: `${section.title}: ${field.label} has an invalid selection`,
        });
      }
    }
  }
  return errors;
}

export function validateForm(
  form: Pick<FormSubmission, 'formType' | 'answers' | 'attachments'>,
): string[] {
  return formValidationIssues(form).map((issue) => issue.message);
}

export function requiredProgress(
  definition: FormDefinition,
  answers: Record<string, string>,
  attachments: FormSubmission['attachments'],
): { done: number; total: number } {
  const required = definition.sections
    .filter((section) => isSectionVisible(section, answers))
    .flatMap((section) =>
      section.fields.filter(
        (field) => field.required && isFieldVisible(field, answers),
      ),
    );
  return {
    total: required.length,
    done: required.filter((field) =>
      field.kind === 'photo'
        ? attachments.some((item) => item.slot === field.key)
        : Boolean(String(answers[field.key] ?? '').trim()),
    ).length,
  };
}

export function createInitialFormAnswers(
  installation: Installation,
  user: InstallHubUser,
): Record<string, string> {
  return {
    'site.date_time': new Date().toISOString(),
    'site.customer_name':
      installation.clientName || installation.siteName,
    'site.address': installation.siteAddress,
    'installer.name': user.fullName || user.email,
  };
}

export function meterAfterCommsReplacement(
  meter: Meter,
  answers: Record<string, string>,
): Meter {
  const deviceType = String(answers['works.new_device_type'] ?? '');
  if (!DEVICE_TYPES.includes(deviceType as (typeof DEVICE_TYPES)[number])) {
    return meter;
  }
  const typedDevice = deviceType as 'A3RM' | 'A6M';
  const sensorRating = String(
    answers['works.new_sensor_rating'] ?? '',
  );
  const channelCount = typedDevice === 'A3RM' ? 3 : 6;
  return {
    ...meter,
    deviceName: `${typedDevice} Auditor`,
    deviceType: typedDevice,
    deviceId: String(answers['works.new_device_id'] ?? ''),
    deviceNumber: String(answers['works.new_device_number'] ?? ''),
    wwChannels: Array.from({ length: channelCount }, (_, index) => {
      const current = meter.wwChannels?.[index] ?? {};
      return {
        ...current,
        ...(typedDevice === 'A3RM'
          ? { rogowskiSize: sensorRating, ctRatio: undefined }
          : { ctRatio: sensorRating, rogowskiSize: undefined }),
      };
    }),
  };
}

export function operationalMeterForCompletedForm(
  form: FormSubmission,
): Meter | null {
  if (form.formType !== 'ww-installation') return null;
  const deviceType = form.answers['device.type'] as 'A3RM' | 'A6M';
  if (!DEVICE_TYPES.includes(deviceType)) return null;
  const channelCount = deviceType === 'A3RM' ? 3 : 6;
  return {
    id: form.meterId || createInstallHubId('meter'),
    deviceName: `${deviceType} Auditor`,
    deviceType,
    deviceId: form.answers['device.id'] || '',
    deviceNumber: form.answers['device.number'] || '',
    deviceFamily: 'WATTWATCHERS',
    deviceNameOverridden: false,
    wwChannels: Array.from({ length: channelCount }, (_, index) => {
      const prefix = `channel.${index + 1}`;
      const loadType = form.answers[`${prefix}.load`] || '';
      const purpose = ({
        'Main board supply': 'MAIN_SUPPLY',
        'Sub-circuit / asset': 'SUB_CIRCUIT',
        'Spare / unused': 'SPARE',
      } as Record<string, string>)[form.answers[`${prefix}.purpose`] || '']
        || (loadType === 'Not Used' ? 'SPARE' : loadType === 'Mains Supply' ? 'MAIN_SUPPLY' : 'SUB_CIRCUIT');
      const channel: NonNullable<Meter['wwChannels']>[number] = {
        ordinal: index + 1,
        purpose,
      };
      if (purpose === 'SPARE') return channel;
      const customLoadType = loadType === 'Other'
        ? form.answers[`${prefix}.custom_load_type`]?.trim() || ''
        : '';
      channel.loadType = customLoadType || loadType;
      channel.description = form.answers[`${prefix}.description`] || '';
      if (customLoadType) channel.customLoadTypeName = customLoadType;
      if (deviceType === 'A3RM') {
        channel.rogowskiSize = form.answers[`${prefix}.rating`] || '';
      } else {
        channel.ctRatio = form.answers[`${prefix}.rating`] || '';
      }
      return channel;
    }),
  };
}
