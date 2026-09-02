import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import type {
  ListWattwatchersMeterRegisterRecordsResult,
  UpdateWattwatchersMeterRegisterRecordRequest,
  UpdateWattwatchersMeterRegisterRecordInput,
  WattwatchersMeterRegisterRecordDto,
} from '../../services/wattwatchersMeterRegisterRecordService.js';
import { wattwatchersMeterRegisterRoutes } from './meterRegister.js';

function bearer(input: {
  app: 'ecoaudit' | 'wattwatchers';
  role: 'viewer' | 'admin';
}) {
  return {
    authorization: `Bearer ${signAccessToken({
      userId: `${input.app}-${input.role}`,
      app: input.app,
      role: input.role,
    })}`,
  };
}

const payload: UpdateWattwatchersMeterRegisterRecordInput = {
  revision: 2,
  clientName: 'Example Client',
  customerName: 'Example Customer',
  siteName: 'Example Site',
  siteAddress: 'NA',
  siteState: null,
  details: {
    status: 'Active',
    installationDetail: 'DB Showroom',
    maas: true,
    meterCostExGstCents: 123_45,
  },
};

const responseRecord: WattwatchersMeterRegisterRecordDto = {
  entryId: 'entry-1',
  businessClientId: 'client-1',
  businessSiteId: 'site-1',
  clientName: 'Example Client',
  customerName: 'Example Customer',
  siteName: 'Example Site',
  siteAddress: 'NA',
  siteState: null,
  details: {
    status: 'Active',
    serviceType: null,
    meteringSolutionType: null,
    installationDetail: 'DB Showroom',
    meterType: null,
    fergusJobNumber: null,
    quoteNumber: null,
    purchaseOrderNumber: null,
    jobCompletionDate: null,
    jobCompletedBy: null,
    hardwareInstalled: null,
    maas: true,
    maasStartDate: null,
    maasTerm: null,
    maasReportingRequired: null,
    dataEnabled: null,
    productName: null,
    xeroInvoiceNumber: null,
    meterCostExGstCents: 123_45,
    meteringRecurringFeeExGstCents: null,
    otherInvoiceCostsExGstCents: null,
    invoiceAmountExGstCents: null,
    recurringFeePo: null,
    invoicingClientContact: null,
    comments: null,
    recurringStartDate: null,
    recurringFrequency: null,
    recurringNextInvoiceIssueDate: null,
    invoiceIssuedDate: null,
    billingPeriod: null,
    issuedPeriodNextInvoiceIssueDate: null,
  },
  revision: 3,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

test('Meter Register list is admin-only and forwards pagination', async () => {
  let received: { search?: string; limit?: number; offset?: number } | null = null;
  const result: ListWattwatchersMeterRegisterRecordsResult = {
    data: [],
    meta: { total: 1_857, limit: 25, offset: 50 },
  };
  const app = Fastify();
  await app.register(wattwatchersMeterRegisterRoutes, {
    prefix: '/v1/wattwatchers/meter-register',
    listRecords: async (input: { search?: string; limit?: number; offset?: number }) => {
      received = input;
      return result;
    },
  });
  await app.ready();
  try {
    const url = '/v1/wattwatchers/meter-register/entries?search=salmon&limit=25&offset=50';
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    assert.equal((await app.inject({
      method: 'GET',
      url,
      headers: bearer({ app: 'wattwatchers', role: 'viewer' }),
    })).statusCode, 403);
    const response = await app.inject({
      method: 'GET',
      url,
      headers: bearer({ app: 'wattwatchers', role: 'admin' }),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), result);
    assert.deepEqual(
      { ...(received as { search?: string; limit?: number; offset?: number } | null) },
      { search: 'salmon', limit: 25, offset: 50 },
    );
  } finally {
    await app.close();
  }
});

test('Meter Register corrections require a Wattwatchers administrator', async () => {
  let calls = 0;
  const app = Fastify();
  await app.register(wattwatchersMeterRegisterRoutes, {
    prefix: '/v1/wattwatchers/meter-register',
    updateRecord: async () => {
      calls += 1;
      return responseRecord;
    },
  });
  await app.ready();
  try {
    const url = '/v1/wattwatchers/meter-register/entries/entry-1';
    assert.equal((await app.inject({ method: 'PATCH', url, payload })).statusCode, 401);
    assert.equal((await app.inject({
      method: 'PATCH',
      url,
      headers: bearer({ app: 'ecoaudit', role: 'admin' }),
      payload,
    })).statusCode, 403);
    assert.equal((await app.inject({
      method: 'PATCH',
      url,
      headers: bearer({ app: 'wattwatchers', role: 'viewer' }),
      payload,
    })).statusCode, 403);
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test('Meter Register correction forwards validated data and actor identity', async () => {
  let received: UpdateWattwatchersMeterRegisterRecordRequest | null = null;
  const app = Fastify();
  await app.register(wattwatchersMeterRegisterRoutes, {
    prefix: '/v1/wattwatchers/meter-register',
    updateRecord: async (input: UpdateWattwatchersMeterRegisterRecordRequest) => {
      received = input;
      return responseRecord;
    },
  });
  await app.ready();
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/wattwatchers/meter-register/entries/entry-1',
      headers: bearer({ app: 'wattwatchers', role: 'admin' }),
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), responseRecord);
    assert.deepEqual(received, {
      entryId: 'entry-1',
      actorUserId: 'wattwatchers-admin',
      input: payload,
    });
  } finally {
    await app.close();
  }
});

test('Meter Register correction strips unknown fields before the service', async () => {
  let received: UpdateWattwatchersMeterRegisterRecordRequest | null = null;
  const app = Fastify();
  await app.register(wattwatchersMeterRegisterRoutes, {
    prefix: '/v1/wattwatchers/meter-register',
    updateRecord: async (input: UpdateWattwatchersMeterRegisterRecordRequest) => {
      received = input;
      return responseRecord;
    },
  });
  await app.ready();
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/wattwatchers/meter-register/entries/entry-1',
      headers: bearer({ app: 'wattwatchers', role: 'admin' }),
      payload: { ...payload, unexpected: true },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      (received as UpdateWattwatchersMeterRegisterRecordRequest | null)?.input,
      payload,
    );
  } finally {
    await app.close();
  }
});
