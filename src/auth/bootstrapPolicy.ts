import { conflict, forbidden } from '../utils/errors.js';

type ExistingBootstrapUser = {
  email: string;
  role: string;
  isActive: boolean;
};

export type BootstrapPlan =
  | { mode: 'create'; role: 'inspector' }
  | { mode: 'legacy-update'; role: string };

export function planLocalBootstrap(input: {
  existing: ExistingBootstrapUser | null | undefined;
  requestedEmail: string;
  allowLegacyUpsert: boolean;
}): BootstrapPlan {
  if (!input.existing) return { mode: 'create', role: 'inspector' };
  if (!input.existing.isActive) {
    throw forbidden('This cloud account is inactive. Contact an administrator.');
  }
  if (input.existing.email !== input.requestedEmail) {
    throw conflict('Local identity is already linked to another cloud email');
  }
  if (!input.allowLegacyUpsert) {
    throw conflict(
      'Cloud account already exists. Sign in normally or ask an administrator to reset it.',
    );
  }
  return { mode: 'legacy-update', role: input.existing.role };
}
