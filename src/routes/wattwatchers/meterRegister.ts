import type { FastifyInstance } from 'fastify';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  listWattwatchersMeterRegisterRecords,
  updateWattwatchersMeterRegisterRecord,
  type ListWattwatchersMeterRegisterRecordsResult,
  type UpdateWattwatchersMeterRegisterRecordInput,
} from '../../services/wattwatchersMeterRegisterRecordService.js';

type UpdateRecord = typeof updateWattwatchersMeterRegisterRecord;
type ListRecords = typeof listWattwatchersMeterRegisterRecords;

export type WattwatchersMeterRegisterRouteOptions = {
  updateRecord?: UpdateRecord;
  listRecords?: ListRecords;
};

const nullableText = (maxLength: number) => ({
  anyOf: [
    { type: 'string', maxLength },
    { type: 'null' },
  ],
});

const nullableDate = {
  anyOf: [
    { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    { type: 'null' },
  ],
};

const nullableBoolean = {
  anyOf: [
    { type: 'boolean' },
    { type: 'null' },
  ],
};

const nullableCents = {
  anyOf: [
    { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    { type: 'null' },
  ],
};

export async function wattwatchersMeterRegisterRoutes(
  app: FastifyInstance,
  options: WattwatchersMeterRegisterRouteOptions = {},
): Promise<void> {
  const updateRecord = options.updateRecord ?? updateWattwatchersMeterRegisterRecord;
  const listRecords = options.listRecords ?? listWattwatchersMeterRegisterRecords;
  const fleetAdmin = [authenticate, requireApp('wattwatchers'), requireRole('admin')];

  app.get('/entries', {
    schema: {
      tags: ['Wattwatchers Meter Register'],
      summary: 'List editable Meter Register rows across all imported hardware',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const query = request.query as { search?: string; limit?: number; offset?: number };
    const result: ListWattwatchersMeterRegisterRecordsResult = await listRecords(query);
    return reply.send(result);
  });

  app.patch('/entries/:entryId', {
    schema: {
      tags: ['Wattwatchers Meter Register'],
      summary: 'Correct the editable projection of an imported Meter Register row',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['entryId'],
        additionalProperties: false,
        properties: {
          entryId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
      body: {
        type: 'object',
        required: [
          'revision',
          'clientName',
          'customerName',
          'siteName',
          'siteAddress',
          'siteState',
          'details',
        ],
        additionalProperties: false,
        properties: {
          revision: {
            anyOf: [
              { type: 'integer', minimum: 0 },
              { type: 'null' },
            ],
          },
          clientName: { type: 'string', minLength: 1, maxLength: 300 },
          customerName: { type: 'string', minLength: 1, maxLength: 300 },
          siteName: { type: 'string', minLength: 1, maxLength: 300 },
          siteAddress: { type: 'string', minLength: 1, maxLength: 1000 },
          siteState: {
            anyOf: [
              { type: 'string', enum: ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] },
              { type: 'null' },
            ],
          },
          details: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: nullableText(300),
              serviceType: nullableText(300),
              meteringSolutionType: nullableText(300),
              installationDetail: nullableText(300),
              meterType: nullableText(300),
              fergusJobNumber: nullableText(300),
              quoteNumber: nullableText(300),
              purchaseOrderNumber: nullableText(300),
              jobCompletionDate: nullableDate,
              jobCompletedBy: nullableText(300),
              hardwareInstalled: nullableText(300),
              maas: nullableBoolean,
              maasStartDate: nullableDate,
              maasTerm: nullableText(300),
              maasReportingRequired: nullableBoolean,
              dataEnabled: nullableBoolean,
              productName: nullableText(300),
              xeroInvoiceNumber: nullableText(300),
              meterCostExGstCents: nullableCents,
              meteringRecurringFeeExGstCents: nullableCents,
              otherInvoiceCostsExGstCents: nullableCents,
              invoiceAmountExGstCents: nullableCents,
              recurringFeePo: nullableText(300),
              invoicingClientContact: nullableText(500),
              comments: nullableText(2000),
              recurringStartDate: nullableDate,
              recurringFrequency: nullableText(300),
              recurringNextInvoiceIssueDate: nullableDate,
              invoiceIssuedDate: nullableDate,
              billingPeriod: nullableText(300),
              issuedPeriodNextInvoiceIssueDate: nullableDate,
            },
          },
        },
      },
    },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const input = request.body as UpdateWattwatchersMeterRegisterRecordInput;
    const record = await updateRecord({
      entryId,
      actorUserId: request.user.userId,
      input,
    });
    return reply.send(record);
  });
}
