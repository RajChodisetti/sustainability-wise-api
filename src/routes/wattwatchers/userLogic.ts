export type AdminRemovalGuard = 'self' | 'last_admin' | null;

export function adminRemovalGuard(input: {
  actorId: string;
  targetId: string;
  currentRole: string;
  currentIsActive: boolean;
  nextRole: string;
  nextIsActive: boolean;
  activeAdminCount: number;
}): AdminRemovalGuard {
  const removesActiveAdmin = input.currentRole === 'admin'
    && input.currentIsActive
    && (input.nextRole !== 'admin' || !input.nextIsActive);
  if (!removesActiveAdmin) return null;
  if (input.actorId === input.targetId) return 'self';
  return input.activeAdminCount <= 1 ? 'last_admin' : null;
}
