import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthUser } from '../../auth/middleware.js';
import type { Role } from '../../auth/jwt.js';
import { assertAssessmentAccess, canAccessAssessment } from './helpers.js';

const site = { createdByUserId: 'site-owner', status: 'Draft' };
const assessment = { assignedInspectorUserId: 'assigned-inspector' };

function user(userId: string, role: Role = 'inspector'): AuthUser {
  return { userId, app: 'solarsense', role, authType: 'jwt' };
}

test('Solar assessment access permits site owner, assessment assignee, and elevated users', () => {
  assert.equal(canAccessAssessment(site, assessment, user('site-owner')), true);
  assert.equal(canAccessAssessment(site, assessment, user('assigned-inspector')), true);
  assert.equal(canAccessAssessment(site, assessment, user('admin', 'admin')), true);
  assert.equal(canAccessAssessment(site, assessment, user('other-inspector')), false);
  assert.equal(
    canAccessAssessment({ ...site, status: 'Completed' }, assessment, user('assigned-inspector')),
    false,
  );
  assert.equal(
    canAccessAssessment({ ...site, deletedAt: new Date() }, assessment, user('assigned-inspector')),
    false,
  );
  assert.doesNotThrow(() => assertAssessmentAccess(site, assessment, user('assigned-inspector')));
  assert.throws(
    () => assertAssessmentAccess(site, assessment, user('other-inspector')),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'statusCode' in error
      && error.statusCode === 403,
    ),
  );
});
