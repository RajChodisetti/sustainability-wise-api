import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { closeDb, db, sql } from '../src/db/client.js';
import { apiKeys } from '../src/db/schema/shared.js';
import { generateKey } from '../src/auth/apiKey.js';
import { signAccessToken } from '../src/auth/jwt.js';

type Method = 'GET' | 'POST' | 'PUT';

async function main(): Promise<void> {
  if (process.env.ALLOW_WATTWATCHERS_SMOKE_WRITES !== 'true') {
    throw new Error('Set ALLOW_WATTWATCHERS_SMOKE_WRITES=true to run the temporary database-backed smoke test');
  }

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const sourcePrefix = `smoke:${suffix}:`;
  const clientA = `smoke-a-${suffix}`;
  const clientB = `smoke-b-${suffix}`;
  const device = (name: string) => `SMOKE-${suffix}-${name}`;
  const keyId = randomUUID();
  const generated = generateKey('wattwatchers');
  const rawKey = generated.raw;
  const app = await buildApp();

  async function request(method: Method, url: string, payload?: unknown, token = rawKey) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const body = response.body ? JSON.parse(response.body) : null;
    assert.ok(
      response.statusCode >= 200 && response.statusCode < 300,
      `${method} ${url} returned ${response.statusCode}: ${response.body}`,
    );
    return { response, body };
  }

  async function startRun(sequence: number, reportingDate: string) {
    const { body } = await request('POST', '/v1/wattwatchers/ingest/runs', {
      sourceRunKey: `${sourcePrefix}${sequence}`,
      collectorVersion: 'smoke',
      trigger: 'manual',
      inventoryScope: 'full',
      reportingDate,
      timezone: 'Australia/Melbourne',
      delayedThresholdMinutes: 15,
      offlineThresholdMinutes: 60,
      reportOfflineThresholdHours: 24,
      clients: [
        { clientCode: clientA, name: 'Smoke MaaS', isMaas: true },
        { clientCode: clientB, name: 'Smoke Standard', isMaas: false },
      ],
    });
    return body.id as string;
  }

  async function clientResult(runId: string, clientCode: string, status: string) {
    const requestedDeviceCount = clientCode === clientA ? 2 : 3;
    await request('PUT', `/v1/wattwatchers/ingest/runs/${runId}/clients/${clientCode}`, {
      name: clientCode === clientA ? 'Smoke MaaS' : 'Smoke Standard',
      isMaas: clientCode === clientA,
      status,
      requestedDeviceCount,
      fetchedDeviceCount: status === 'success' ? requestedDeviceCount : 0,
      requestCount: 5,
      retryCount: status === 'success' ? 0 : 2,
      rateLimitCount: 0,
      errorCount: status === 'success' ? 0 : 1,
      error: status === 'success' ? null : 'synthetic client failure',
    });
  }

  async function observations(runId: string, rows: Array<Record<string, unknown>>) {
    await request('POST', `/v1/wattwatchers/ingest/runs/${runId}/observations/batch`, { observations: rows });
  }

  async function finalize(runId: string, finishedAt: string) {
    const { body } = await request('POST', `/v1/wattwatchers/ingest/runs/${runId}/finalize`, {
      finishedAt,
      rawDeviceCount: 5,
      requestCount: 20,
      retryCount: 0,
      rateLimitCount: 0,
      errorCount: 0,
    });
    return body.run as Record<string, unknown>;
  }

  try {
    await db.insert(apiKeys).values({
      id: keyId,
      name: `Wattwatchers smoke ${suffix}`,
      hashedKey: await generated.hashed,
      prefix: generated.prefix,
      app: 'wattwatchers',
      role: 'service_account',
    });

    const memberships = {
      shared: [
        { clientCode: clientA, name: 'Smoke MaaS', isMaas: true },
        { clientCode: clientB, name: 'Smoke Standard', isMaas: false },
      ],
      a: [{ clientCode: clientA, name: 'Smoke MaaS', isMaas: true }],
      b: [{ clientCode: clientB, name: 'Smoke Standard', isMaas: false }],
    };
    const at1 = new Date('2026-07-13T21:00:00.000Z');
    const isoBefore = (minutes: number) => new Date(at1.getTime() - minutes * 60_000).toISOString();
    const run1 = await startRun(1, '2026-07-14');
    await clientResult(run1, clientA, 'success');
    await clientResult(run1, clientB, 'success');
    await observations(run1, [
      {
        deviceId: device('SHARED'), clientCode: clientA, clientMemberships: memberships.shared,
        observedAt: at1.toISOString(), lastHeardAt: isoBefore(5), latestStatusAt: isoBefore(10),
        fetchStatus: 'ok', label: 'Shared meter', model: '6M', firmwareVersion: '1.0',
        metrics: { shortEnergy: { timestamp: 1_768_000_000, pRealKw: [1.2], powerFactor: [0.98] } },
      },
      {
        deviceId: device('OFFLINE'), clientCode: clientA, clientMemberships: memberships.a,
        observedAt: at1.toISOString(), lastHeardAt: isoBefore(30 * 60), fetchStatus: 'ok',
        label: '=SUM(1,1)', model: '3RM4', rawStatus: { simId: 'must-not-survive', comms: { apn: 'private', mode: '4g' } },
      },
      {
        deviceId: device('INACTIVE'), clientCode: clientB, clientMemberships: memberships.b,
        observedAt: at1.toISOString(), lastHeardAt: null, uninitialised: true, fetchStatus: 'ok', label: 'Inactive meter',
      },
      {
        deviceId: device('DELAYED'), clientCode: clientB, clientMemberships: memberships.b,
        observedAt: at1.toISOString(), lastHeardAt: isoBefore(30), fetchStatus: 'ok', label: 'Delayed meter',
      },
    ]);
    const first = await finalize(run1, at1.toISOString());
    assert.equal(first.status, 'published');
    assert.deepEqual(
      [first.totalDevices, first.communicating, first.delayed, first.offline, first.inactive, first.unknown, first.reportOffline],
      [4, 1, 1, 1, 1, 0, 1],
    );

    const summary1 = (await request('GET', '/v1/wattwatchers/dashboard/summary')).body;
    assert.equal(summary1.run.id, run1);
    assert.equal(summary1.summary.totalDevices, 4);
    assert.equal(summary1.summary.maasTotal, 2);
    const clients1 = (await request('GET', '/v1/wattwatchers/clients')).body.data;
    assert.deepEqual(clients1.map((row: { totalDevices: number }) => row.totalDevices).sort(), [2, 3]);

    const ecoToken = signAccessToken({ userId: 'smoke', app: 'ecoaudit', role: 'admin' });
    const forbidden = await app.inject({
      method: 'GET', url: '/v1/wattwatchers/dashboard/summary',
      headers: { authorization: `Bearer ${ecoToken}` },
    });
    assert.equal(forbidden.statusCode, 403);

    const [report1] = (await request('GET', '/v1/wattwatchers/reports')).body.data
      .filter((row: { runId: string }) => row.runId === run1);
    const csv = await app.inject({
      method: 'GET', url: `/v1/wattwatchers/reports/${report1.id}.csv`,
      headers: { authorization: `Bearer ${rawKey}` },
    });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.body, new RegExp(device('OFFLINE')));
    assert.doesNotMatch(csv.body, new RegExp(device('SHARED')));
    assert.match(csv.body, /"'=SUM\(1,1\)"/);

    const rawRows = await sql<Array<{ payload: string }>>`
      SELECT o.raw_status::text AS payload
      FROM ww_device_observations o
      JOIN ww_devices d ON d.id = o.device_id
      WHERE o.run_id = ${run1} AND d.device_id = ${device('OFFLINE')}
    `;
    assert.ok(!rawRows[0]?.payload.includes('must-not-survive'));
    assert.ok(!rawRows[0]?.payload.includes('private'));

    const at2 = new Date('2026-07-14T21:00:00.000Z');
    const run2 = await startRun(2, '2026-07-15');
    await clientResult(run2, clientA, 'partial');
    await clientResult(run2, clientB, 'failed');
    await observations(run2, [{
      deviceId: device('OFFLINE'), clientCode: clientA, clientMemberships: memberships.a,
      observedAt: at2.toISOString(), lastHeardAt: null, fetchStatus: 'error', fetchError: 'synthetic timeout',
    }]);
    const second = await finalize(run2, at2.toISOString());
    assert.equal(second.status, 'partial');
    const stillFirst = (await request('GET', '/v1/wattwatchers/dashboard/summary')).body;
    assert.equal(stillFirst.run.id, run1);

    const at3 = new Date('2026-07-15T21:00:00.000Z');
    const before3 = (minutes: number) => new Date(at3.getTime() - minutes * 60_000).toISOString();
    const run3 = await startRun(3, '2026-07-16');
    await clientResult(run3, clientA, 'success');
    await clientResult(run3, clientB, 'success');
    await observations(run3, [
      { deviceId: device('SHARED'), clientCode: clientA, clientMemberships: memberships.shared, observedAt: at3.toISOString(), lastHeardAt: before3(5), fetchStatus: 'ok' },
      { deviceId: device('OFFLINE'), clientCode: clientA, clientMemberships: memberships.a, observedAt: at3.toISOString(), lastHeardAt: before3(5), fetchStatus: 'ok' },
      { deviceId: device('INACTIVE'), clientCode: clientB, clientMemberships: memberships.b, observedAt: at3.toISOString(), lastHeardAt: before3(30 * 60), fetchStatus: 'ok', uninitialised: false },
      { deviceId: device('DELAYED'), clientCode: clientB, clientMemberships: memberships.b, observedAt: at3.toISOString(), lastHeardAt: before3(30), fetchStatus: 'ok' },
    ]);
    const third = await finalize(run3, at3.toISOString());
    assert.equal(third.status, 'published');
    // The database does not claim that an inactive device newly failed: there
    // was no prior usable heartbeat. The collector's emailed cohort below can
    // still call it newly offline relative to its retained email state.
    assert.equal(third.reportNewlyOffline, 0);
    assert.equal(third.reportRecovered, 1);

    await request('POST', `/v1/wattwatchers/ingest/runs/${run3}/report-deliveries`, {
      idempotencyKey: `${sourcePrefix}3:email`,
      channel: 'gmail_api',
      status: 'sent',
      attemptedAt: at3.toISOString(),
      sentAt: at3.toISOString(),
      recipientCount: 1,
      subject: 'Smoke Fleet email',
      csvFilename: 'smoke-fleet.csv',
      emailDelta: {
        offlineDeviceIds: [device('INACTIVE')],
        newlyOfflineDeviceIds: [device('INACTIVE')],
        recoveredDeviceIds: [device('OFFLINE')],
        previousOfflineDeviceIds: [device('OFFLINE')],
        stateOfflineDeviceIds: [device('INACTIVE')],
        collectionComplete: true,
      },
    });
    const report3 = (await request('GET', '/v1/wattwatchers/reports')).body.data
      .find((row: { runId: string }) => row.runId === run3);
    assert.equal(report3.latestDelivery.emailDelta.newlyOfflineCount, 1);
    assert.equal(report3.latestDelivery.emailDelta.recoveredCount, 1);
    assert.equal(report3.databaseTransitions.newlyOffline, 0);
    assert.equal(report3.databaseTransitions.recovered, 1);

    const detail = (await request('GET', `/v1/wattwatchers/devices/${device('OFFLINE')}`)).body;
    assert.equal(detail.outages.length, 1);
    assert.equal(detail.outages[0].open, false);
    assert.equal(detail.current.status, 'communicating');

    console.log('[wattwatchers-smoke] migration, auth, ingestion, partial safety, transitions, CSV, and reads ok');
  } finally {
    await app.close().catch(() => {});
    await sql`DELETE FROM ww_report_deliveries WHERE report_id IN (
      SELECT id FROM ww_reports WHERE run_id IN (
        SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
      )
    )`;
    await sql`DELETE FROM ww_reports WHERE run_id IN (
      SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
    )`;
    await sql`DELETE FROM ww_outages WHERE opened_run_id IN (
      SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
    ) OR closed_run_id IN (
      SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
    )`;
    await sql`DELETE FROM ww_observation_clients WHERE run_id IN (
      SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
    )`;
    await sql`DELETE FROM ww_device_observations WHERE run_id IN (
      SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
    )`;
    await sql`DELETE FROM ww_client_run_results WHERE run_id IN (
      SELECT id FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}
    )`;
    await sql`DELETE FROM ww_collection_runs WHERE source_run_key LIKE ${`${sourcePrefix}%`}`;
    await sql`DELETE FROM ww_device_clients WHERE device_id IN (
      SELECT id FROM ww_devices WHERE device_id LIKE ${`SMOKE-${suffix}-%`}
    )`;
    await sql`DELETE FROM ww_devices WHERE device_id LIKE ${`SMOKE-${suffix}-%`}`;
    await sql`DELETE FROM ww_clients WHERE code IN (${clientA}, ${clientB})`;
    await sql`DELETE FROM api_keys WHERE id = ${keyId}`;
    await closeDb().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[wattwatchers-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
