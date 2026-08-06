import assert from 'node:assert/strict';
import test from 'node:test';
import type { InstallationReadiness, ReadinessIssue } from './canonical.js';
import {
  isUserDeferredReadinessIssue,
  paginateReadiness,
} from './canonicalPagination.js';

function issue(
  code: ReadinessIssue['code'],
  entityType: ReadinessIssue['entityType'],
  field?: string,
): ReadinessIssue {
  return {
    code,
    severity: 'ERROR',
    entityType,
    entityId: `${code}-${entityType}`,
    ...(field ? { field } : {}),
    message: code,
  };
}

const issues = [
  issue('SUPPLY_TBC', 'board', 'electricalSource'),
  issue('MEASUREMENT_TARGET_TBC', 'measurement_assignment', 'target'),
  issue('METERING_STATE_INVALID', 'site_asset', 'meteringState'),
  issue('METERING_STATE_INVALID', 'site_asset', 'meteringState.measurementAssignmentIds'),
  issue('FORM_INCOMPLETE', 'form'),
];

const readiness = {
  installationId: 'installation',
  treeRevision: 1,
  readyToComplete: false,
  issues,
  eligibility: {
    draftDiagnosticReport: true,
    mappingExport: false,
    authoritativeReport: false,
    dataDomeDelivery: false,
  },
} satisfies InstallationReadiness;

test('readiness pagination categorizes only explicit user deferrals as reconciliation', () => {
  assert.equal(isUserDeferredReadinessIssue(issues[2]), true);
  assert.equal(isUserDeferredReadinessIssue(issues[3]), false);

  const reconciliation = paginateReadiness(readiness, {
    category: 'RECONCILIATION',
  });
  assert.deepEqual(
    reconciliation.issues.map((item) => item.code),
    ['SUPPLY_TBC', 'MEASUREMENT_TARGET_TBC', 'METERING_STATE_INVALID'],
  );
  assert.equal(reconciliation.issuePage.total, 3);

  const completion = paginateReadiness(readiness, {
    category: 'COMPLETION',
  });
  assert.deepEqual(
    completion.issues.map((item) => item.field || item.code),
    ['meteringState.measurementAssignmentIds', 'FORM_INCOMPLETE'],
  );
  assert.equal(completion.issuePage.total, 2);
});
