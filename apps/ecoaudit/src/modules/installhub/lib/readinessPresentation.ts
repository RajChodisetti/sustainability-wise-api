import type { ReadinessIssue } from '@/modules/installhub/types/domain';

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
        details: [...messages.entries()].map(([message, count]) => ({ message, count })),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}
