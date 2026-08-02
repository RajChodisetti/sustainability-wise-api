import type { FormSubmission, InstallationTree } from '@/modules/installhub/types/domain';
import {
  boardElectricalSource,
  boardTypeLabel,
} from '@/modules/installhub/lib/workflow';

export const WW_CANONICAL_BOARD_ANSWER_KEYS = new Set([
  'auditor.switchboard_name',
  'auditor.switchboard_location',
  'auditor.switchboard_type',
  'auditor.site_nmi',
]);

export function isWwCanonicalBoardAnswer(form: FormSubmission, key: string): boolean {
  return form.formType === 'ww-installation' && WW_CANONICAL_BOARD_ANSWER_KEYS.has(key);
}

/**
 * Keeps legacy WW answer keys wire-compatible while making their source of
 * truth the canonical board record rather than duplicate editable inputs.
 */
export function canonicalWwBoardAnswers(
  tree: InstallationTree,
  form: FormSubmission,
  answers: Record<string, string>,
): Record<string, string> {
  if (form.formType !== 'ww-installation' || !form.boardId) return { ...answers };
  const board = tree.electricalAssets.find((item) => item.id === form.boardId);
  if (!board) return { ...answers };
  const zone = tree.zones.find((item) => item.id === board.zoneId);
  const source = boardElectricalSource(board);
  const sourceGrid = source.kind === 'GRID'
    ? tree.gridSupplies?.find((item) => item.id === source.gridSupplyId)
    : null;
  const defaultGrid = tree.gridSupplies?.find((item) => item.isDefault);
  return {
    ...answers,
    'auditor.switchboard_name': board.assetName,
    'auditor.switchboard_location': board.locationDescription?.trim() || zone?.zoneName || '',
    'auditor.switchboard_type': boardTypeLabel(board),
    'auditor.site_nmi': board.siteNmi?.trim() || sourceGrid?.nmi?.trim() || defaultGrid?.nmi?.trim() || '',
  };
}
