import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoard, createInstallationTree, createZone } from '@/modules/installhub/lib/model';
import { applyBoardElectricalSource, ensureCanonicalTree } from '@/modules/installhub/lib/workflow';
import type { FormSubmission } from '@/modules/installhub/types/domain';
import {
  canonicalWwBoardAnswers,
  isWwCanonicalBoardAnswer,
} from './canonicalContext';

test('WW duplicate switchboard answers are canonical, stable, and not editable fields', () => {
  const tree = createInstallationTree({
    clientName: 'Client',
    siteName: 'Site',
    siteAddress: '1 Test Street',
    inspectorName: 'Installer',
    auditDate: '2026-08-02',
    siteCode: 'SITE',
    timezone: 'Australia/Sydney',
  }, { id: 'user-1', email: 'installer@example.com', fullName: 'Installer', role: 'admin' });
  const zone = createZone(tree.installation.id, { zoneName: 'Plant room', zoneDescription: '' });
  zone.id = 'zone-1';
  const board = createBoard(tree.installation.id, zone.id);
  board.id = 'board-1';
  board.assetName = 'Canonical main board';
  board.assetType = 'MSB';
  board.typeCode = 'MSB';
  board.locationDescription = 'North wall';
  board.siteNmi = 'NMI-CANONICAL';
  applyBoardElectricalSource(board, { kind: 'GRID', gridSupplyId: tree.gridSupplies![0].id });
  tree.zones = [zone];
  tree.electricalAssets = [board];
  ensureCanonicalTree(tree);
  const form: FormSubmission = {
    id: 'form-1',
    installationId: tree.installation.id,
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Draft',
    zoneId: zone.id,
    boardId: board.id,
    answers: {},
    attachments: [],
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
  const normalized = canonicalWwBoardAnswers(tree, form, {
    'auditor.switchboard_name': 'Stale duplicate',
    'auditor.switchboard_location': 'Wrong place',
    'auditor.switchboard_type': 'Wrong type',
    'auditor.site_nmi': 'Wrong NMI',
    'unrelated.answer': 'preserved',
  });
  assert.deepEqual(normalized, {
    'auditor.switchboard_name': 'Canonical main board',
    'auditor.switchboard_location': 'North wall',
    'auditor.switchboard_type': 'Main switchboard',
    'auditor.site_nmi': 'NMI-CANONICAL',
    'unrelated.answer': 'preserved',
  });
  assert.equal(isWwCanonicalBoardAnswer(form, 'auditor.switchboard_name'), true);
  assert.equal(isWwCanonicalBoardAnswer(form, 'auditor.switchboard_location'), true);
  assert.equal(isWwCanonicalBoardAnswer(form, 'auditor.switchboard_type'), true);
  assert.equal(isWwCanonicalBoardAnswer(form, 'auditor.site_nmi'), true);
  assert.equal(isWwCanonicalBoardAnswer(form, 'notes'), false);
});
