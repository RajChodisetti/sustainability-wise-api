import type { ReadinessIssue } from '@/modules/installhub/types/domain';

export function isUserDeferredReadinessIssue(issue: ReadinessIssue): boolean {
  return issue.code === 'SUPPLY_TBC'
    || issue.code === 'MEASUREMENT_TARGET_TBC'
    || (
      issue.code === 'METERING_STATE_INVALID'
      && issue.entityType === 'site_asset'
      && issue.field === 'meteringState'
    );
}

export function partitionReadinessIssues(issues: ReadinessIssue[]): {
  reconciliation: ReadinessIssue[];
  completion: ReadinessIssue[];
} {
  const reconciliation: ReadinessIssue[] = [];
  const completion: ReadinessIssue[] = [];
  for (const issue of issues) {
    (isUserDeferredReadinessIssue(issue) ? reconciliation : completion).push(issue);
  }
  return { reconciliation, completion };
}

const READINESS_REASON_BY_CODE: Record<string, string> = {
  CHANNEL_DUPLICATE_ASSIGNMENT: 'The same device channel is included in more than one measurement group, so its reading would be counted twice.',
  CHANNEL_NOT_FOUND: 'A saved measurement group refers to a device channel that no longer exists.',
  CHANNEL_PURPOSE_CONFLICT: 'The channel purpose does not match the item that its measurement group is linked to.',
  CHANNEL_UNASSIGNED: 'An active non-spare channel has not been placed in a measurement group.',
  CUSTOM_TYPE_REQUIRED: 'Other was selected without recording the custom equipment type.',
  DISPLAY_CODE_DUPLICATE: 'Two records use the same display code, so the code cannot identify one item safely.',
  DISPLAY_CODE_INVALID: 'The saved display code is missing or does not follow the required format.',
  ELECTRICAL_CYCLE: 'The saved supply links form a loop instead of a valid upstream-to-downstream path.',
  FORM_CONTEXT_REQUIRED: 'This form is missing a required link to its zone, switchboard, or device.',
  FORM_INCOMPLETE: 'This form still has required answers or evidence that have not been completed.',
  GRID_SUPPLY_INVALID: 'The incoming connection is missing required details or conflicts with another saved connection.',
  METER_BOARD_MISMATCH: 'This device is linked to a switchboard that does not contain it.',
  METER_CAPABILITY_REQUIRED: 'Required channel or sensor capability details have not been recorded for this device.',
  METER_DEVICE_REQUIRED: 'Required device identity, model, or channel details have not been recorded.',
  METER_PRESENT_MISMATCH: 'The meter-present answer does not match the devices or measurement links saved for this item.',
  PHASE_GROUP_INVALID: 'The number of selected channels does not match the chosen phase grouping.',
  SENSOR_RATING_INVALID: 'The saved CT or Rogowski rating is missing or does not match this device type.',
  SUPPLY_SOURCE_INVALID: 'The saved incoming connection or parent switchboard link no longer points to a valid record.',
  VIRTUAL_METER_SOURCE_INCOMPLETE: 'There are not enough confirmed parent and child measurements to calculate this virtual reading safely.',
};

export function reconciliationIssueWhy(issue: ReadinessIssue): string {
  if (issue.code === 'SUPPLY_TBC') {
    if (issue.entityType === 'board') {
      return 'This switchboard was saved without a confirmed incoming connection or parent switchboard.';
    }
    if (issue.entityType === 'site_asset') {
      return 'This asset was saved without a confirmed incoming connection or supplying switchboard.';
    }
    return 'This record was saved without a confirmed electrical supply.';
  }
  if (issue.code === 'METERING_STATE_INVALID') {
    return issue.field === 'meteringState'
      ? 'This asset was saved without confirming whether it is metered or unmetered.'
      : 'The asset metering choice does not match its saved measurement group.';
  }
  if (issue.code === 'MEASUREMENT_TARGET_TBC') {
    return 'This channel group was saved without confirming what it measures.';
  }
  return READINESS_REASON_BY_CODE[issue.code]
    ?? 'The saved record does not meet the current installation rules. Open it to review the highlighted fields.';
}

const READINESS_LABELS: Record<string, string> = {
  CHANNEL_UNASSIGNED: 'Unassigned device channels',
  CHANNEL_DUPLICATE_ASSIGNMENT: 'Channels assigned more than once',
  CHANNEL_NOT_FOUND: 'Device channel details to fix',
  CHANNEL_PURPOSE_CONFLICT: 'Channel purpose conflicts',
  DISPLAY_CODE_DUPLICATE: 'Duplicate names',
  DISPLAY_CODE_INVALID: 'Names to fix',
  FORM_CONTEXT_REQUIRED: 'Forms missing a switchboard',
  FORM_INCOMPLETE: 'Incomplete field forms',
  GRID_SUPPLY_INVALID: 'Incoming connection details to fix',
  MEASUREMENT_TARGET_TBC: 'Measurement targets to confirm',
  METER_BOARD_MISMATCH: 'Devices mapped to the wrong switchboard',
  METER_DEVICE_REQUIRED: 'Missing device details',
  METERING_STATE_INVALID: 'Metering choices to confirm',
  SUPPLY_SOURCE_INVALID: 'Supply relationships to fix',
  SUPPLY_TBC: 'Electrical supplies to confirm',
};

function humanIssueTitle(code: string): string {
  const known = READINESS_LABELS[code];
  if (known) return known;
  const words = code.toLowerCase().replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export type ReadinessIssueGroup = {
  key: string;
  title: string;
  count: number;
  issues: ReadinessIssue[];
  details: Array<{ message: string; count: number }>;
};

export function groupReadinessIssues(issues: ReadinessIssue[]): ReadinessIssueGroup[] {
  const grouped = new Map<string, ReadinessIssue[]>();
  for (const issue of issues) {
    grouped.set(issue.code, [...(grouped.get(issue.code) || []), issue]);
  }
  return [...grouped.entries()]
    .map(([code, matching]) => {
      const messages = new Map<string, number>();
      for (const issue of matching) {
        messages.set(issue.message, (messages.get(issue.message) || 0) + 1);
      }
      return {
        key: code,
        title: humanIssueTitle(code),
        count: matching.length,
        issues: matching,
        details: [...messages.entries()].map(([message, count]) => ({ message, count })),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}
