import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entrypointSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

test('periodic recovery reaps only lease-expired exports before bounded artifact cleanup', () => {
  const startupEnd = entrypointSource.indexOf('const app = await buildApp()');
  const periodicStart = entrypointSource.indexOf('const storageCleanupTimer = setInterval');
  const periodicEnd = entrypointSource.indexOf('storageCleanupTimer.unref()', periodicStart);

  assert.notEqual(startupEnd, -1);
  assert.notEqual(periodicStart, -1);
  assert.notEqual(periodicEnd, -1);
  assert.match(entrypointSource.slice(0, startupEnd), /await failInterruptedExportJobs\(\)/);

  const periodicSweep = entrypointSource.slice(periodicStart, periodicEnd);
  assert.match(periodicSweep, /if \(storageCleanupRunning\) return/);
  assert.match(periodicSweep, /storageCleanupRunning = true/);
  assert.match(
    periodicSweep,
    /failInterruptedExportJobs\(\)[\s\S]*\.then\(\(\) => drainStorageDeletionTasks\(\{ limit: 100, maxTasks: 500 \}\)\)/,
  );
  assert.match(periodicSweep, /\.finally\(\(\) => \{ storageCleanupRunning = false; \}\)/);
});
