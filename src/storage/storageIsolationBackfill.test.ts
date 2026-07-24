import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runBackfill(
  root: string,
  args: string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/storage-isolation-backfill.ts', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        JWT_SECRET: 'storage-backfill-test',
        JWT_REFRESH_SECRET: 'storage-backfill-refresh-test',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        STORAGE_PROVIDER: 'local',
        STORAGE_WRITE_MODE: 'dual',
        LOCAL_FILE_STORAGE_ROOT: join(root, 'legacy'),
        ECOAUDIT_STORAGE_PROVIDER: 'local',
        ECOAUDIT_LOCAL_FILE_STORAGE_ROOT: join(root, 'ecoaudit'),
        SOLARSENSE_STORAGE_PROVIDER: 'local',
        SOLARSENSE_LOCAL_FILE_STORAGE_ROOT: join(root, 'solarsense'),
        INSTALLHUB_STORAGE_PROVIDER: 'local',
        INSTALLHUB_LOCAL_FILE_STORAGE_ROOT: join(root, 'installhub'),
      },
    },
  );
}

test('storage backfill copies forward and reverses without deleting its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sw-storage-backfill-'));
  const storageKey = 'installhub/installation-1/evidence.jpg';
  const legacyFile = join(root, 'legacy', storageKey);
  const isolatedFile = join(root, 'installhub', storageKey);
  const bytes = Buffer.from('immutable original bytes');

  try {
    await mkdir(join(root, 'legacy', 'installhub', 'installation-1'), {
      recursive: true,
    });
    await writeFile(legacyFile, bytes);

    const forward = runBackfill(root, ['--app=installhub', '--apply']);
    assert.equal(forward.status, 0, String(forward.stderr));
    assert.deepEqual(await readFile(isolatedFile), bytes);
    assert.deepEqual(await readFile(legacyFile), bytes);
    assert.match(String(forward.stdout), /"copied":1/);

    await unlink(legacyFile);
    const reverse = runBackfill(root, [
      '--app=installhub',
      '--direction=isolated-to-legacy',
      '--apply',
    ]);
    assert.equal(reverse.status, 0, String(reverse.stderr));
    assert.deepEqual(await readFile(legacyFile), bytes);
    assert.deepEqual(await readFile(isolatedFile), bytes);
    assert.match(String(reverse.stdout), /"copied":1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
