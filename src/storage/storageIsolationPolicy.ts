export type StorageBoundaryDestination = {
  provider: 'local' | 'spaces';
  identity: string;
  accessKeyId?: string;
};

export type StorageBoundaryApp = 'ecoaudit' | 'solarsense' | 'installhub';

type StorageIsolationPolicyInput = {
  writeMode: 'legacy' | 'dual' | 'isolated';
  isProduction: boolean;
  legacy: StorageBoundaryDestination;
  apps: Record<StorageBoundaryApp, StorageBoundaryDestination | null>;
};

export function assertStorageIsolationPolicy(
  input: StorageIsolationPolicyInput,
): void {
  if (input.writeMode === 'legacy') return;

  const configuredApps = Object.entries(input.apps) as Array<
    [StorageBoundaryApp, StorageBoundaryDestination | null]
  >;

  for (const [app, destination] of configuredApps) {
    if (!destination) {
      throw new Error(
        `${app} app storage must be configured before STORAGE_WRITE_MODE=${input.writeMode}`,
      );
    }
    if (input.isProduction && destination.provider !== 'spaces') {
      throw new Error(
        `${app} app storage must use a dedicated object-storage bucket in production`,
      );
    }
  }

  const destinations = configuredApps.map(([, destination]) => {
    if (!destination) throw new Error('Unreachable missing app storage destination');
    return destination;
  });
  const identities = [input.legacy.identity, ...destinations.map((item) => item.identity)];
  if (new Set(identities).size !== identities.length) {
    throw new Error(
      'Legacy storage and every application must use distinct storage roots or buckets',
    );
  }

  const spacesDestinations = [
    input.legacy,
    ...destinations,
  ].filter((item) => item.provider === 'spaces');
  const accessKeyIds = spacesDestinations.map((item) => item.accessKeyId);
  if (
    accessKeyIds.some((accessKeyId) => !accessKeyId)
    || new Set(accessKeyIds).size !== accessKeyIds.length
  ) {
    throw new Error(
      'Legacy storage and every object-storage application must use distinct IAM access keys',
    );
  }
}
