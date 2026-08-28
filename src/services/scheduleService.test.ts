import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertScheduleInterval,
  assertPortalSchedulerApp,
  createScheduleEvent,
  deriveScheduledEndAt,
  dispatchSiteSelection,
  fieldScopeNumber,
  generatedFieldJobTitle,
  installHubSchedulerAuditDate,
  MAX_ESTIMATED_DURATION_MINUTES,
  parseDispatchJob,
  parseEstimatedDurationMinutes,
  randomFieldJobTitleSuffix,
  schedulerSitePrefillOption,
  scheduleUpdateRequiresAvailabilityCheck,
  scheduleUpdateRequiresActiveProduct,
  sortByDeadlineUrgency,
  validateDispatchJob,
} from './scheduleService.js';
import { AppError } from '../utils/errors.js';

const ecoAdmin = {
  app: 'ecoaudit',
  role: 'admin',
  userId: 'eco-admin-1',
} as never;

test('Eco Audit administrators retain Scheduler access', () => {
  assert.doesNotThrow(() => assertPortalSchedulerApp(ecoAdmin));
});

test('job creation distinguishes new addresses from saved-site prefill', () => {
  assert.deepEqual(dispatchSiteSelection({}), { mode: 'new', existingSiteId: null });
  assert.deepEqual(
    dispatchSiteSelection({ siteMode: 'existing', existingSiteId: 'site-1' }),
    { mode: 'existing', existingSiteId: 'site-1' },
  );
  assert.throws(
    () => dispatchSiteSelection({ siteMode: 'existing' }),
    (error: unknown) => error instanceof AppError
      && error.detail === 'job.existingSiteId is required for an existing site',
  );
  assert.throws(
    () => dispatchSiteSelection({ siteMode: 'new', existingSiteId: 'site-1' }),
    (error: unknown) => error instanceof AppError
      && error.detail === 'job.existingSiteId is allowed only for an existing site',
  );
});

test('saved-site prefill suppresses prior job and revision metadata for rolling portals', () => {
  const option = schedulerSitePrefillOption({
    id: 'site-1',
    name: 'Sydney warehouse',
    latestWorkType: 'old work',
    latestSourceId: 'old-installation',
    latestRevisionNumber: 2,
  });
  assert.deepEqual(option, {
    id: 'site-1',
    name: 'Sydney warehouse',
    latestWorkType: null,
    latestMeteringSolutionType: null,
    latestCustomJobNumber: null,
    latestJobComments: null,
    latestMaas: null,
    latestElectricityNmi: null,
    latestJobId: null,
    latestSourceId: null,
    latestRevisionNumber: null,
  });
});

test('Field job titles retain a three-character A-Z/0-9 suffix', () => {
  assert.equal(fieldScopeNumber('M2 - Faults / COMMS fault'), 'M2');
  assert.equal(fieldScopeNumber('legacy custom scope'), 'M5');
  const randomIndexes = [0, 25, 35];
  assert.equal(randomFieldJobTitleSuffix(() => randomIndexes.shift() ?? 0), 'AZ9');
  assert.equal(
    generatedFieldJobTitle('M3 - Inspection', 'Client Co', 'North Site', 'A7Z'),
    'M3 - Client Co - North Site - A7Z',
  );
  const longTitle = generatedFieldJobTitle(
    'M3 - Inspection',
    'C'.repeat(250),
    'S'.repeat(250),
    'Q9X',
  );
  assert.equal(longTitle.length, 300);
  assert.match(longTitle, / - Q9X$/);
});

test('sortByDeadlineUrgency puts overdue and soonest first; done last', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const sorted = sortByDeadlineUrgency(
    [
      { id: 'future', deadlineAt: '2026-08-20T00:00:00.000Z', status: 'planned' },
      { id: 'overdue', deadlineAt: '2026-08-01T00:00:00.000Z', status: 'planned' },
      { id: 'soon', deadlineAt: '2026-08-11T00:00:00.000Z', status: 'in_progress' },
      { id: 'done', deadlineAt: '2026-08-05T00:00:00.000Z', status: 'done' },
    ],
    now,
  );
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['overdue', 'soon', 'future', 'done'],
  );
});

test('estimated duration accepts only optional positive whole minutes within seven days', () => {
  assert.equal(parseEstimatedDurationMinutes(undefined), null);
  assert.equal(parseEstimatedDurationMinutes(null), null);
  assert.equal(parseEstimatedDurationMinutes(''), null);
  assert.equal(parseEstimatedDurationMinutes(1), 1);
  assert.equal(
    parseEstimatedDurationMinutes(MAX_ESTIMATED_DURATION_MINUTES),
    MAX_ESTIMATED_DURATION_MINUTES,
  );

  for (const invalid of [0, -1, 1.5, '60', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => parseEstimatedDurationMinutes(invalid),
      (error: unknown) => error instanceof AppError
        && error.detail?.startsWith('estimatedDurationMinutes must be a whole number') === true,
    );
  }
  assert.throws(
    () => parseEstimatedDurationMinutes(MAX_ESTIMATED_DURATION_MINUTES + 1),
    (error: unknown) => error instanceof AppError
      && error.detail?.startsWith('estimatedDurationMinutes must be a whole number') === true,
  );
});

test('calendar end is derived only when an estimate exists', () => {
  const start = new Date('2026-08-20T09:00:00.000Z');
  assert.equal(deriveScheduledEndAt(start, null), null);
  assert.equal(
    deriveScheduledEndAt(start, 90)?.toISOString(),
    '2026-08-20T10:30:00.000Z',
  );
});

test('client-provided end time is rejected before persistence', async () => {
  await assert.rejects(
    () => createScheduleEvent(ecoAdmin, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: 'installation-id',
      assigneeFieldUserId: 'field-user',
      scheduledStartAt: '2026-08-20T09:00:00.000Z',
      scheduledEndAt: '2026-08-20T10:00:00.000Z',
      deadlineAt: '2026-08-22T17:00:00.000Z',
    }),
    (error: unknown) => error instanceof AppError
      && error.detail === (
        'scheduledEndAt is derived; refresh and provide estimatedDurationMinutes instead'
      ),
  );
});

test('reactivating done or cancelled work requires the linked product to be active', () => {
  assert.equal(scheduleUpdateRequiresActiveProduct({
    existingStatus: 'done', nextStatus: 'planned', explicitAssignee: false,
  }), true);
  assert.equal(scheduleUpdateRequiresActiveProduct({
    existingStatus: 'cancelled', nextStatus: 'in_progress', explicitAssignee: false,
  }), true);
  assert.equal(scheduleUpdateRequiresActiveProduct({
    existingStatus: 'planned', nextStatus: 'in_progress', explicitAssignee: false,
  }), false);
  assert.equal(scheduleUpdateRequiresActiveProduct({
    existingStatus: 'planned', nextStatus: 'planned', explicitAssignee: true,
  }), true);
  assert.equal(scheduleUpdateRequiresActiveProduct({
    existingStatus: 'done', nextStatus: 'done', explicitAssignee: true,
  }), false);
});

test('active Scheduler intervals must have positive duration when an end is supplied', () => {
  const start = new Date('2026-08-21T09:00:00.000Z');
  assert.doesNotThrow(() => assertScheduleInterval(start, null));
  assert.doesNotThrow(() => assertScheduleInterval(
    start,
    new Date('2026-08-21T09:00:00.001Z'),
  ));
  for (const end of [
    new Date('2026-08-21T09:00:00.000Z'),
    new Date('2026-08-21T08:59:59.999Z'),
  ]) {
    assert.throws(
      () => assertScheduleInterval(start, end),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === 'scheduledEndAt must be after scheduledStartAt',
    );
  }
});

test('Field App compatibility date uses the installation timezone with a safe legacy fallback', () => {
  const morningInAustralia = new Date('2026-08-20T23:30:00.000Z');
  assert.equal(
    installHubSchedulerAuditDate(morningInAustralia, 'Australia/Sydney'),
    '2026-08-21',
  );
  assert.equal(
    installHubSchedulerAuditDate(morningInAustralia, 'Australia/Perth'),
    '2026-08-21',
  );
  assert.equal(
    installHubSchedulerAuditDate(morningInAustralia, 'legacy-invalid-timezone'),
    '2026-08-21',
  );
});

test('availability is rechecked for every non-cancelled assignment change', () => {
  assert.equal(scheduleUpdateRequiresAvailabilityCheck({
    existingStatus: 'done',
    nextStatus: 'done',
    assigneeChanged: false,
    scheduleChanged: true,
  }), true);
  assert.equal(scheduleUpdateRequiresAvailabilityCheck({
    existingStatus: 'done',
    nextStatus: 'done',
    assigneeChanged: false,
    scheduleChanged: false,
  }), false);
  assert.equal(scheduleUpdateRequiresAvailabilityCheck({
    existingStatus: 'planned',
    nextStatus: 'done',
    assigneeChanged: false,
    scheduleChanged: false,
  }), true);
  assert.equal(scheduleUpdateRequiresAvailabilityCheck({
    existingStatus: 'planned',
    nextStatus: 'cancelled',
    assigneeChanged: false,
    scheduleChanged: true,
  }), false);
});

test('InstallHub Scheduler dispatch accepts bounded setup and outcome metadata', () => {
  assert.doesNotThrow(() => validateDispatchJob('installhub', {
    customerName: 'Site owner',
    clientName: 'Retail client',
    maas: false,
    serviceType: 'Metering install',
    meteringSolutionType: 'Commercial',
    plannedMeterType: 'A6M',
    customJobNumber: 'CUSTOM-100',
    siteName: 'Sydney branch',
    siteAddress: '42 Example Road, Sydney NSW 2000',
    siteContactName: 'Site manager',
    siteContactPhone: '02 9000 0000',
    siteContactEmail: 'manager@example.test',
    fergusJobNumber: 'F-100',
    quoteNumber: 'Q-100',
    jobComments: 'Bring PPE',
    accessInformation: 'Sign in at reception',
    warrantyDevice: null,
    monitoringInstalled: false,
    hardwareInstalled: true,
    solarCapacityKw: 125.5,
    additionalMonitoringRequired: true,
    additionalMonitoringHardware: 'Two CTs',
    electricityNmi: '41020000000',
  }));
});

test('InstallHub Scheduler dispatch rejects invalid metadata without accepting lifecycle fields', () => {
  const baseJob = {
    clientName: 'Retail client',
    siteName: 'Sydney branch',
    siteAddress: '42 Example Road',
  };
  for (const [job, detail] of [
    [{ ...baseJob, maas: 'yes' }, 'job.maas must be a boolean'],
    [{ ...baseJob, solarCapacityKw: -1 }, 'job.solarCapacityKw must be a finite number between 0 and 1000000'],
    [{ ...baseJob, quoteNumber: 'q'.repeat(101) }, 'job.quoteNumber must contain at most 100 characters'],
    [{ ...baseJob, electricityNmi: 'n'.repeat(101) }, 'job.electricityNmi must contain at most 100 characters'],
    [{ ...baseJob, titleSuffix: 'AB-' }, 'job.titleSuffix must contain exactly 3 alphanumeric characters'],
  ] as const) {
    assert.throws(
      () => validateDispatchJob('installhub', job),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === detail,
    );
  }
  assert.throws(
    () => parseDispatchJob({ ...baseJob, completedAt: null }, 'installhub'),
      (error: unknown) => error instanceof AppError
      && error.statusCode === 400
      && error.detail === 'job.completedAt is server-owned',
  );
});
