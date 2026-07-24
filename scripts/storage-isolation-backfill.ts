import {
  copyStoredFileBetweenLocations,
  hasIsolatedStorageDestination,
  listStoredFilesAt,
  type StorageApp,
  type StorageLocation,
} from '../src/storage/localFiles.js';

type Direction = 'legacy-to-isolated' | 'isolated-to-legacy';

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseApps(): StorageApp[] {
  const selected = option('app') ?? 'all';
  if (selected === 'all') return ['ecoaudit', 'solarsense', 'installhub'];
  if (
    selected === 'ecoaudit'
    || selected === 'solarsense'
    || selected === 'installhub'
  ) {
    return [selected];
  }
  throw new Error('--app must be ecoaudit, solarsense, installhub, or all');
}

function parseDirection(): Direction {
  const direction = option('direction') ?? 'legacy-to-isolated';
  if (direction === 'legacy-to-isolated' || direction === 'isolated-to-legacy') {
    return direction;
  }
  throw new Error(
    '--direction must be legacy-to-isolated or isolated-to-legacy',
  );
}

function locations(direction: Direction): {
  from: StorageLocation;
  to: StorageLocation;
} {
  return direction === 'legacy-to-isolated'
    ? { from: 'legacy', to: 'isolated' }
    : { from: 'isolated', to: 'legacy' };
}

async function main(): Promise<void> {
  const apps = parseApps();
  const direction = parseDirection();
  const apply = hasFlag('apply');
  const overwrite = hasFlag('overwrite');
  const requestedLimit = Number(option('limit') ?? Number.POSITIVE_INFINITY);
  if (!(requestedLimit > 0)) throw new Error('--limit must be a positive number');
  const { from, to } = locations(direction);
  const totals = {
    discovered: 0,
    copied: 0,
    alreadyPresent: 0,
    missingSource: 0,
    bytes: 0,
  };

  for (const app of apps) {
    if (!hasIsolatedStorageDestination(app)) {
      throw new Error(
        `${app} has no isolated destination; configure its *_STORAGE_PROVIDER variables first`,
      );
    }
    const files = await listStoredFilesAt(`${app}/`, from);
    const selectedFiles = files.slice(0, requestedLimit);
    totals.discovered += selectedFiles.length;
    console.log(JSON.stringify({
      event: 'inventory',
      app,
      direction,
      count: selectedFiles.length,
      dryRun: !apply,
    }));

    if (!apply) continue;
    for (const file of selectedFiles) {
      const result = await copyStoredFileBetweenLocations(
        file.storageKey,
        from,
        to,
        { overwrite },
      );
      if (result.status === 'copied') totals.copied += 1;
      if (result.status === 'already-present') totals.alreadyPresent += 1;
      if (result.status === 'missing-source') totals.missingSource += 1;
      totals.bytes += result.sizeBytes ?? 0;
      console.log(JSON.stringify({
        event: 'copy',
        app,
        storageKey: file.storageKey,
        ...result,
      }));
    }
  }

  console.log(JSON.stringify({
    event: 'summary',
    direction,
    dryRun: !apply,
    overwrite,
    ...totals,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
