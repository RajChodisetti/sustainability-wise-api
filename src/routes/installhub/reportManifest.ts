export const INSTALLHUB_REPORT_MANIFEST_VERSION = 1;

export type InstallHubReportFormType =
  | 'ww-installation'
  | 'comms-fault'
  | 'ace-switchboard'
  | 'honeywell-q400'
  | 'captis-logger'
  | 'sums-logger'
  | 'a3rm-installation'
  | 'a6m-installation';

export type ReportVisibility = {
  key: string;
  equals: string | string[];
};

export type InstallHubReportField = {
  key: string;
  label: string;
  kind: 'value' | 'photo';
  showWhen?: ReportVisibility;
};

export type InstallHubReportSection = {
  title: string;
  fields: InstallHubReportField[];
  showWhen?: ReportVisibility;
};

export type InstallHubReportDefinition = {
  type: InstallHubReportFormType;
  title: string;
  shortTitle: string;
  schemaVersion: number;
  sections: InstallHubReportSection[];
};

const value = (
  key: string,
  label: string,
  showWhen?: ReportVisibility,
): InstallHubReportField => ({
  key,
  label,
  kind: 'value',
  ...(showWhen ? { showWhen } : {}),
});

const photo = (
  key: string,
  label: string,
  showWhen?: ReportVisibility,
): InstallHubReportField => ({
  key,
  label,
  kind: 'photo',
  ...(showWhen ? { showWhen } : {}),
});

const yesNo = value;
const usedLoads = [
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
];

const siteFields = [
  value('site.date_time', 'Date and time'),
  value('site.customer_name', 'Customer / site name'),
  value('site.address', 'Address'),
  value('site.latitude', 'Latitude'),
  value('site.longitude', 'Longitude'),
];

const installerFields = [
  value('installer.name', 'Installer name'),
  value('installer.electrical_license', 'Electrical licence number'),
];

const prestartFields = [
  yesNo('prestart.site_inspection', 'Initial site inspection / checklist completed?'),
  yesNo('prestart.site_induction', 'Is a site induction required?'),
  yesNo('prestart.safe_access', 'Do you have safe access?'),
  yesNo('prestart.correct_ppe', 'Do you have the correct PPE?'),
  yesNo('prestart.live_points', 'Are you aware of all LIVE points?'),
  yesNo('prestart.can_isolate', 'Can the power source be safely isolated?'),
  yesNo('prestart.additional_hazards', 'Additional hazards identified?'),
  value('prestart.hazard_comments', 'Additional hazard comments', {
    key: 'prestart.additional_hazards',
    equals: 'yes',
  }),
  yesNo('prestart.safe_to_proceed', 'Can you safely proceed?'),
];

function channelSections(
  deviceType: 'A3RM' | 'A6M' | 'dynamic',
): InstallHubReportSection[] {
  const count = deviceType === 'A3RM' ? 3 : 6;
  return Array.from({ length: count }, (_, index) => {
    const channel = index + 1;
    const prefix = `channel.${channel}`;
    const sectionVisibility: ReportVisibility | undefined =
      deviceType === 'dynamic'
        ? {
            key: 'device.type',
            equals: channel <= 3 ? ['A3RM', 'A6M'] : 'A6M',
          }
        : undefined;
    const ratingVisibility: ReportVisibility | undefined =
      deviceType === 'dynamic'
        ? { key: `${prefix}.load`, equals: usedLoads }
        : undefined;
    return {
      title: `Channel ${channel}`,
      ...(sectionVisibility ? { showWhen: sectionVisibility } : {}),
      fields:
        deviceType === 'dynamic'
          ? [
              value(`${prefix}.load`, 'Load'),
              value(`${prefix}.rating`, 'CT / Rogowski coil rating', ratingVisibility),
              value(`${prefix}.description`, 'Load description', ratingVisibility),
              photo(`${prefix}.nameplate_photos`, 'Load / nameplate photos', ratingVisibility),
            ]
          : [
              value(
                `${prefix}.rating`,
                deviceType === 'A3RM' ? 'Rogowski coil size' : 'CT rating',
              ),
              value(`${prefix}.load`, 'Load'),
              value(`${prefix}.description`, 'Load description'),
              photo(`${prefix}.nameplate_photos`, 'Load / nameplate photos'),
            ],
    };
  });
}

function commissioningFields(
  deviceType: 'A3RM' | 'A6M' | 'dynamic',
): InstallHubReportField[] {
  const channelCount = deviceType === 'A3RM' ? 3 : 6;
  const channelVerification = Array.from({ length: channelCount }, (_, index) => {
    const channel = index + 1;
    const visibility: ReportVisibility =
      deviceType === 'dynamic'
        ? { key: `channel.${channel}.load`, equals: usedLoads }
        : {
            key: `channel.${channel}.rating`,
            equals:
              deviceType === 'A3RM'
                ? ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm']
                : ['60A', '120A', '200A', '400A', '600A'],
          };
    return [
      yesNo(
        `commissioning.channel_${channel}_polarity`,
        `Channel ${channel} polarity correct?`,
        visibility,
      ),
      value(
        `commissioning.channel_${channel}_current`,
        `Channel ${channel} current - AC clamp tester`,
        visibility,
      ),
    ];
  }).flat();

  return [
    yesNo('commissioning.energised', 'Is the Auditor energised?'),
    yesNo('commissioning.leds_visible', 'Are all three LEDs visible?'),
    yesNo('commissioning.online', 'Is the Auditor online in the WW Onboarding App?'),
    value('commissioning.signal_strength', '4G signal strength'),
    value('commissioning.antenna_type', 'Antenna type'),
    yesNo('commissioning.start_complete', 'Start page completed?'),
    photo('commissioning.start_screenshot', 'Start page screenshot'),
    yesNo('commissioning.channels_complete', 'Channels page completed?'),
    photo('commissioning.channels_screenshot', 'Channels page screenshot'),
    value('commissioning.phase_a_voltage', 'Phase A voltage - multi meter'),
    value('commissioning.phase_b_voltage', 'Phase B voltage - multi meter'),
    value('commissioning.phase_c_voltage', 'Phase C voltage - multi meter'),
    ...channelVerification,
    photo('commissioning.energy_screenshot', 'Energy page screenshot'),
    photo('commissioning.completed_photos', 'Completed installation photos (include the antenna)'),
    value('commissioning.final_comments', 'Final comments'),
  ];
}

function installationDefinition(
  deviceType: 'A3RM' | 'A6M' | 'dynamic',
): InstallHubReportDefinition {
  const dynamic = deviceType === 'dynamic';
  const formType: InstallHubReportFormType =
    deviceType === 'dynamic'
      ? 'ww-installation'
      : deviceType === 'A3RM'
        ? 'a3rm-installation'
        : 'a6m-installation';
  const titleDevice = dynamic ? '4G' : deviceType;
  const sensor =
    deviceType === 'A3RM'
      ? 'Rogowski coil'
      : deviceType === 'A6M'
        ? 'CT'
        : 'CT / Rogowski coil';
  return {
    type: formType,
    title: `SW MaaS - ${titleDevice} Auditor Installation Form`,
    shortTitle: dynamic ? 'Installation Form (WW)' : `${deviceType} Installation`,
    schemaVersion: dynamic ? 2 : 1,
    sections: [
      { title: 'Site details', fields: siteFields },
      { title: 'Installer details', fields: installerFields },
      { title: 'Pre-start information', fields: prestartFields },
      {
        title: dynamic
          ? '4G Auditor installation details'
          : `${deviceType} installation details`,
        fields: [
          value('auditor.switchboard_name', 'Switchboard name'),
          value('auditor.switchboard_location', 'Switchboard location'),
          value('auditor.switchboard_type', 'Type of switchboard'),
          value('auditor.site_nmi', 'Site NMI'),
          photo('auditor.location_before', 'Auditor location photos'),
          photo('auditor.sensor_before', `${sensor} location photos`),
          photo('auditor.cb_before', 'Circuit breaker location photos'),
          ...(dynamic
            ? [
                value('device.type', 'Meter / Device Type'),
                value('device.id', 'Device ID / serial'),
              ]
            : [
                value(
                  'auditor.serial_number',
                  `${deviceType} 4G Auditor serial number`,
                ),
              ]),
        ],
      },
      ...channelSections(deviceType),
      {
        title: 'Installed evidence',
        fields: [
          photo('auditor.installed_location', 'Installed Auditor location photos'),
          photo('auditor.serial_photo', 'Auditor serial-number photos'),
          photo('auditor.sensor_installed', `Installed ${sensor} location photos`),
          photo('auditor.cb_installed', 'Installed circuit-breaker location photos'),
        ],
      },
      {
        title: 'Commissioning',
        fields: commissioningFields(deviceType),
      },
    ],
  };
}

const communicationsFault: InstallHubReportDefinition = {
  type: 'comms-fault',
  title: 'SW MaaS - Comms Fault',
  shortTitle: 'Comms Fault',
  schemaVersion: 2,
  sections: [
    { title: 'Customer details', fields: siteFields },
    { title: 'Installer details', fields: installerFields },
    { title: 'Pre-start information', fields: prestartFields },
    {
      title: 'Existing installation',
      fields: [
        value('existing.switchboard_location', 'Switchboard location'),
        value('existing.switchboard_type', 'Type of switchboard'),
        value('existing.site_nmi', 'Site NMI'),
        photo('existing.switchboard_photos', 'Whole switchboard photos'),
        value('existing.device_type', 'Existing Meter / Device Type'),
        value('existing.device_id', 'Existing Device ID / serial'),
        value('existing.sensor_rating', 'Existing CT / Rogowski coil rating', {
          key: 'existing.device_type',
          equals: ['A3RM', 'A6M'],
        }),
        yesNo('existing.energised', 'Is the Auditor energised?'),
        yesNo('existing.leds_visible', 'Are LEDs visible?'),
        yesNo('existing.online', 'Is the Auditor online in the WW app?'),
        value('existing.signal', 'Existing signal strength'),
        value('existing.antenna', 'Existing antenna type'),
      ],
    },
    {
      title: 'On-site works',
      fields: [
        yesNo('works.rebooted', 'Device rebooted?'),
        yesNo('works.leds_visible', 'Relevant LEDs visible after reboot?'),
        yesNo('works.replace_device', 'Does the device need replacement?'),
        value('works.new_device_type', 'New Meter / Device Type', {
          key: 'works.replace_device',
          equals: 'yes',
        }),
        value('works.new_device_id', 'New Device ID / serial', {
          key: 'works.replace_device',
          equals: 'yes',
        }),
        value('works.new_sensor_rating', 'New CT / Rogowski coil rating', {
          key: 'works.new_device_type',
          equals: ['A3RM', 'A6M'],
        }),
        yesNo('works.new_online', 'Is the new device online?', {
          key: 'works.replace_device',
          equals: 'yes',
        }),
        value('works.new_signal', 'New device signal strength', {
          key: 'works.replace_device',
          equals: 'yes',
        }),
        yesNo('works.external_antenna', 'Install an external antenna?'),
        value('works.external_signal', 'Signal after external antenna', {
          key: 'works.external_antenna',
          equals: 'yes',
        }),
        yesNo('works.extend_antenna', 'Extend the external antenna?'),
        value('works.extended_signal', 'Signal after antenna extension', {
          key: 'works.extend_antenna',
          equals: 'yes',
        }),
      ],
    },
    {
      title: 'Commissioning details',
      fields: [
        yesNo(
          'commissioning.onboarding_complete',
          'WW Onboarding App completed for the new device?',
          {
            key: 'works.replace_device',
            equals: 'yes',
          },
        ),
        yesNo(
          'commissioning.details_same',
          'New device details match the old device?',
          {
            key: 'works.replace_device',
            equals: 'yes',
          },
        ),
        photo('commissioning.start_screenshot', 'Start page screenshot', {
          key: 'works.replace_device',
          equals: 'yes',
        }),
        photo('commissioning.energy_screenshot', 'Energy page screenshot', {
          key: 'works.replace_device',
          equals: 'yes',
        }),
        photo('commissioning.completed_photos', 'Final completed-work photos'),
        value('commissioning.final_comments', 'Final comments'),
      ],
    },
  ],
};

const aceSwitchboard: InstallHubReportDefinition = {
  type: 'ace-switchboard',
  title: 'ACE Switchboards - Installation, Testing and Commissioning Form',
  shortTitle: 'ACE Switchboard',
  schemaVersion: 2,
  sections: [
    {
      title: 'Switchboard details',
      fields: [
        value('site.date_time', 'Date'),
        value('job.name', 'Job name'),
        value('job.number', 'Job number'),
        value('job.qr_link', 'Switchboard QR / document link'),
      ],
    },
    {
      title: 'Installer details',
      fields: [...installerFields, value('installer.rec_number', 'REC number')],
    },
    {
      title: 'Installation information',
      fields: [
        yesNo('install.ct_installed', 'Have the CTs been installed?'),
        yesNo('install.ct_orientation', 'Are CTs installed with P1 facing the grid?'),
        value('install.ct_ratio', 'CT ratio'),
        value('install.ct_serial_a', 'Phase A CT serial number'),
        value('install.ct_serial_b', 'Phase B CT serial number'),
        value('install.ct_serial_c', 'Phase C CT serial number'),
        photo('install.ct_chamber_photo', 'CT chamber photos'),
        yesNo('install.test_block', 'Has a test block been installed?'),
        yesNo('install.remove_star_point', 'Does the star point need removal?'),
        yesNo('install.star_point_removed', 'Has the star point been removed?'),
        yesNo('install.ct_fuses', 'Fuses installed in CT chamber?'),
        value('install.ct_fuse_rating', 'CT chamber fuse rating'),
        yesNo(
          'install.secondary_fuses',
          'Secondary fuses installed on meter panel?',
        ),
        value('install.secondary_fuse_rating', 'Meter panel fuse rating'),
        photo('install.meter_panel_photo', 'Meter panel photos'),
        yesNo('install.loom_installed', 'Has the loom cable been installed?'),
        value('install.loom_type', 'Loom cable type'),
        value('install.loom_size', 'Loom cable size'),
        yesNo(
          'install.wiring_complete',
          'CT chamber and meter panel wiring complete?',
        ),
        photo('install.ct_wiring_photo', 'Completed CT chamber wiring photos'),
        photo('install.panel_wiring_photo', 'Completed meter panel wiring photos'),
      ],
    },
    {
      title: 'Pre-commissioning',
      fields: [
        yesNo('precommission.test_meter', 'Test meter connected?'),
        yesNo(
          'precommission.point_to_point',
          'Point-to-point testing completed?',
        ),
        yesNo('precommission.load_box', '100A load box connected?'),
        yesNo('precommission.safe_energise', 'Safe to energise for testing?'),
        yesNo('precommission.correct_ppe', 'Correct PPE worn?'),
        yesNo(
          'precommission.energised',
          'Installation energised and live points understood?',
        ),
        yesNo(
          'precommission.ct_ratio_set',
          'Correct CT ratio set in test meter?',
        ),
      ],
    },
    {
      title: 'Commissioning / testing',
      fields: [
        ...['a', 'b', 'c'].flatMap((phase) => [
          value(
            `testing.phase_${phase}_voltage`,
            `Phase ${phase.toUpperCase()} voltage`,
          ),
          value(
            `testing.phase_${phase}_primary_current`,
            `Phase ${phase.toUpperCase()} primary current`,
          ),
          value(
            `testing.phase_${phase}_secondary_current`,
            `Phase ${phase.toUpperCase()} secondary current`,
          ),
        ]),
        photo('testing.status_screen', 'EziView status-screen photos'),
        photo('testing.phasor_diagram', 'EziView phasor-diagram photos'),
      ],
    },
    {
      title: 'Final checks',
      fields: [
        yesNo('final.deenergised', 'Installation de-energised?'),
        yesNo('final.load_box_removed', 'Load box removed?'),
        yesNo('final.test_meter_removed', 'Test meter removed?'),
        yesNo(
          'final.connectors_installed',
          'Single-screw connectors installed?',
        ),
        yesNo('final.connections_checked', 'All connections checked?'),
        yesNo(
          'final.completed',
          'Installation, testing and commissioning completed?',
        ),
        photo('final.completed_photo', 'Completed installation photos'),
      ],
    },
  ],
};

const honeywellQ400: InstallHubReportDefinition = {
  type: 'honeywell-q400',
  title: 'SW MaaS - Honeywell Q400 Water Meter Installation Form',
  shortTitle: 'Honeywell Q400',
  schemaVersion: 2,
  sections: [
    {
      title: 'Installation details',
      fields: [
        ...siteFields,
        value('water.physical_location', 'Physical meter location'),
      ],
    },
    { title: 'Installer details', fields: installerFields.slice(0, 1) },
    {
      title: 'Water meter information',
      fields: [
        value('water.serial_number', 'Water meter serial number'),
        yesNo('water.activated', 'Activated per SW work instructions?'),
        yesNo('water.network_registered', 'Registered to the network?'),
        photo('water.lcd_photo', 'LCD screen showing 4 0 2'),
        photo('water.completed_photo', 'Completed water-meter installation'),
      ],
    },
  ],
};

function loggerDefinition(
  type: 'captis-logger' | 'sums-logger',
): InstallHubReportDefinition {
  const loggerName = type === 'captis-logger' ? 'Captis' : 'SUMS';
  return {
    type,
    title: `SW MaaS - ${loggerName} Logger Installation Form`,
    shortTitle: `${loggerName} Logger`,
    schemaVersion: 2,
    sections: [
      {
        title: 'Installation details',
        fields: [
          ...siteFields,
          value(
            'captis.physical_location',
            `Physical ${loggerName} Logger location`,
          ),
          value('captis.supply_description', 'Meter supply description'),
        ],
      },
      { title: 'Installer details', fields: installerFields.slice(0, 1) },
      {
        title: 'Meter information',
        fields: [
          value('meter.type', 'Meter type'),
          value('meter.make', 'Meter make'),
          value('meter.model', 'Meter model'),
          value('meter.serial_number', 'Meter serial number'),
          value('meter.sensor_type', 'Pulse / sensor type'),
          value('meter.flow_rate', 'Pulse / flow rate'),
          value('meter.current_read', 'Current meter read (offset value)'),
          photo('meter.face_photo', 'Meter face close-up'),
        ],
      },
      {
        title: `${loggerName} Logger information`,
        fields: [
          value('logger.serial_number', `${loggerName} Logger serial number`),
          value('logger.rsrp', 'RSRP value / signal strength'),
          yesNo('logger.external_antenna', 'External antenna installed?'),
          yesNo('logger.cumulocity_configured', 'Cumulocity configured?'),
          yesNo('logger.screenshot_taken', 'Cumulocity screenshot taken?'),
          photo('logger.cumulocity_screenshot', 'Cumulocity screenshot'),
        ],
      },
    ],
  };
}

export const INSTALLHUB_REPORT_DEFINITIONS: readonly InstallHubReportDefinition[] = [
  installationDefinition('dynamic'),
  installationDefinition('A3RM'),
  installationDefinition('A6M'),
  communicationsFault,
  aceSwitchboard,
  honeywellQ400,
  loggerDefinition('captis-logger'),
  loggerDefinition('sums-logger'),
];

export const INSTALLHUB_REPORT_DEFINITION_BY_TYPE = Object.fromEntries(
  INSTALLHUB_REPORT_DEFINITIONS.map((definition) => [
    definition.type,
    definition,
  ]),
) as Record<InstallHubReportFormType, InstallHubReportDefinition>;

export function isReportItemVisible(
  visibility: ReportVisibility | undefined,
  answers: Record<string, string>,
): boolean {
  if (!visibility) return true;
  const expected = Array.isArray(visibility.equals)
    ? visibility.equals
    : [visibility.equals];
  return expected.includes(String(answers[visibility.key] ?? ''));
}
