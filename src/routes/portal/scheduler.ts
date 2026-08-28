import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, requireRole } from '../../auth/middleware.js';
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { ihInventoryMeters, ihUsers } from '../../db/schema/installhub.js';
import { config } from '../../config.js';
import {
  assertPortalSchedulerApp,
  cancelScheduleEvent,
  completeSchedulerJob,
  createScheduleEvent,
  createSchedulerDispatch,
  getScheduleEvent,
  getScheduleSummary,
  isSchedulerAdmin,
  listScheduleEvents,
  listSchedulerSites,
  listUnscheduledJobs,
  MAX_ESTIMATED_DURATION_MINUTES,
  searchJobOptions,
  updateScheduleEvent,
  type ScheduleSourceApp,
  type ScheduleSourceType,
  type ScheduleStatus,
} from '../../services/scheduleService.js';
import { badRequest, forbidden } from '../../utils/errors.js';
import { queueManualSchedulerReminder } from '../../services/schedulerNotificationService.js';
import {
  createQuickSchedulerInvoice,
  createQuickSchedulerInvoiceByFinanceId,
  createConsolidatedSchedulerInvoice,
  createSchedulerExpense,
  createSchedulerExpenseByFinanceId,
  deleteSchedulerExpense,
  deleteSchedulerExpenseAttachment,
  deleteSchedulerExpenseByFinanceId,
  getSchedulerFinancialSummary,
  getSchedulerFinancialSummaryById,
  getSchedulerFinancePortfolioSummary,
  getConsolidatedInvoiceEligibility,
  getConsolidatedSchedulerInvoice,
  getSchedulerInvoice,
  getSchedulerInvoiceByFinanceId,
  issueSchedulerInvoice,
  issueSchedulerInvoiceByFinanceId,
  issueConsolidatedSchedulerInvoice,
  listSchedulerExpensePortfolio,
  listSchedulerFinanceOverview,
  listSchedulerInvoicePortfolio,
  listSchedulerInvoices,
  listSchedulerInvoicesByFinanceId,
  markSchedulerInvoicePaid,
  markSchedulerInvoicePaidByFinanceId,
  markConsolidatedSchedulerInvoicePaid,
  updateSchedulerDraftInvoice,
  updateSchedulerDraftInvoiceByFinanceId,
  updateConsolidatedSchedulerDraftInvoice,
  updateSchedulerInvoiceSeller,
  updateSchedulerExpense,
  updateSchedulerExpenseByFinanceId,
  updateSchedulerFinance,
  updateSchedulerFinanceById,
  updateSchedulerJobActorBillingRateByFinanceId,
  voidSchedulerInvoice,
  voidSchedulerInvoiceByFinanceId,
  voidConsolidatedSchedulerInvoice,
  uploadSchedulerExpenseAttachment,
  downloadSchedulerExpenseAttachment,
  type ConsolidatedInvoiceInput,
  type ExpenseInput,
  type FinanceUpdateInput,
  type QuickInvoiceInput,
  type SchedulerJobActorBillingRateUpdateInput,
  type UpdateDraftInvoiceInput,
  type UpdateSchedulerInvoiceSellerInput,
} from '../../services/schedulerFinanceService.js';
import { exportArtifactContentDisposition } from '../pdfJobs.js';
import {
  queueSchedulerInvoicePdfByInvoiceId,
  queueSchedulerInvoicePdfByEventId,
  queueSchedulerInvoicePdfByFinanceId,
} from '../../services/schedulerInvoicePdfExport.js';
import {
  listSchedulerInvoiceEmailDeliveries,
  MAX_SCHEDULER_INVOICE_EMAIL_RECIPIENT_LIST_LENGTH,
  queueSchedulerInvoiceEmail,
  type QueueSchedulerInvoiceEmailInput,
} from '../../services/schedulerInvoiceEmailService.js';
import {
  cancelSchedulerLeaveRequest,
  createSchedulerLeaveRequest,
  listSchedulerLeaveRequests,
  reviewSchedulerLeaveRequest,
} from '../../services/schedulerLeaveService.js';
import {
  listSchedulerInvoiceRefunds,
  postSchedulerInvoiceRefund,
  voidSchedulerInvoiceRefund,
  type PostSchedulerInvoiceRefundInput,
  type VoidSchedulerInvoiceRefundInput,
} from '../../services/schedulerRefundService.js';
import { getSchedulerAnalytics } from '../../services/schedulerAnalyticsService.js';
import { suggestSchedulerAddresses } from '../../services/schedulerMapProvider.js';
import { getSchedulerRouteSuggestion } from '../../services/schedulerRouteService.js';
import {
  listClientDirectory,
  mergeBusinessClients,
  suggestClientAndProviderAddresses,
} from '../../services/clientSiteMemoryService.js';
import {
  listNonInstalledInventoryMeters,
  parseInventoryMeterRegistration,
  registerInventoryMeter,
  toNonInstalledInventoryMeterItem,
  type InventoryMeterRegistration,
} from '../../services/inventoryMeterService.js';

function parseOptionalDate(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${name} must be an ISO datetime string`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} must be a valid ISO datetime`);
  return d;
}

async function portalSchedulerGate(request: Parameters<typeof authenticate>[0]): Promise<void> {
  assertPortalSchedulerApp(request.user);
}

const financeUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pricingMode: { type: 'string', enum: ['quoted', 'charge_up'] },
    quotedAmount: { type: ['number', 'null'], minimum: 0 },
    currency: { type: 'string', minLength: 1, maxLength: 8 },
    notes: { type: ['string', 'null'], maxLength: 5000 },
    billingName: { type: ['string', 'null'], maxLength: 300 },
    billingAbn: { type: ['string', 'null'], maxLength: 100 },
    billingAddress: { type: ['string', 'null'], maxLength: 1000 },
    billingEmail: { type: ['string', 'null'], maxLength: 320 },
    billingReference: { type: ['string', 'null'], maxLength: 200 },
    billableHoursOverride: { type: ['integer', 'null'], minimum: 0 },
    costHoursOverride: { type: ['number', 'null'], minimum: 0 },
    overrideReason: { type: ['string', 'null'], maxLength: 1000 },
    costRate: { type: 'number', minimum: 0 },
  },
} as const;

const jobActorBillingRateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['billingRateOverride'],
  properties: {
    billingRateOverride: { type: ['number', 'null'], minimum: 0 },
  },
} as const;

function parseJobActorBillingRateBody(
  body: unknown,
): SchedulerJobActorBillingRateUpdateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('billingRateOverride body is required');
  }
  const record = body as Record<string, unknown>;
  if (
    !Object.hasOwn(record, 'billingRateOverride')
    || Object.keys(record).some((key) => key !== 'billingRateOverride')
  ) {
    throw badRequest('billingRateOverride must be the only request field');
  }
  const value = record.billingRateOverride;
  if (
    value !== null
    && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  ) {
    throw badRequest('billingRateOverride must be a nonnegative number or null');
  }
  if (value !== null && !Number.isSafeInteger(Math.round(value * 100))) {
    throw badRequest('billingRateOverride is too large');
  }
  return { billingRateOverride: value };
}

const expenseProperties = {
  kind: { type: 'string', enum: ['expense', 'supplier_bill'] },
  category: {
    type: 'string',
    enum: ['materials', 'travel', 'subcontractor', 'equipment', 'other'],
  },
  description: { type: 'string', minLength: 1, maxLength: 500 },
  vendor: { type: ['string', 'null'], maxLength: 300 },
  reference: { type: ['string', 'null'], maxLength: 200 },
  costAmount: { type: 'number', minimum: 0 },
  billableAmount: { type: ['number', 'null'], minimum: 0 },
  billable: { type: 'boolean' },
  incurredAt: { type: ['string', 'null'] },
} as const;

const invoiceDraftBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedUpdatedAt'],
  properties: {
    expectedUpdatedAt: { type: 'string', format: 'date-time' },
    xeroInvoiceNumber: { type: ['string', 'null'], minLength: 1, maxLength: 100 },
    xeroDate: {
      type: ['string', 'null'],
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    },
    notes: { type: ['string', 'null'], maxLength: 5000 },
    dueDate: { type: ['string', 'null'] },
    billToName: { type: 'string', minLength: 1, maxLength: 300 },
    billToAbn: { type: ['string', 'null'], maxLength: 100 },
    billToAddress: { type: ['string', 'null'], maxLength: 1000 },
    billToEmail: { type: ['string', 'null'], maxLength: 320 },
    purchaseOrderReference: { type: ['string', 'null'], maxLength: 200 },
    lines: {
      type: 'array',
      maxItems: 250,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unitAmountExGst'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 100 },
          financeId: { type: 'string', minLength: 1, maxLength: 100 },
          kind: { type: 'string', enum: ['labour', 'expense', 'quoted', 'other'] },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          quantity: { type: 'number', minimum: 0.0001 },
          unitAmountExGst: { type: 'number', minimum: 0 },
          showQuantityAndRate: { type: 'boolean' },
          expenseId: { type: ['string', 'null'], maxLength: 100 },
        },
      },
    },
  },
} as const;

const invoiceVersionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedUpdatedAt'],
  properties: {
    expectedUpdatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const invoiceEmailBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedUpdatedAt', 'idempotencyKey'],
  properties: {
    expectedUpdatedAt: { type: 'string', format: 'date-time' },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
    to: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_SCHEDULER_INVOICE_EMAIL_RECIPIENT_LIST_LENGTH,
    },
    subject: { type: 'string', minLength: 1, maxLength: 500 },
    message: { type: 'string', maxLength: 10000 },
  },
} as const;

export async function portalSchedulerRoutes(app: FastifyInstance): Promise<void> {
  const jobActorBillingRateByRequest = new WeakMap<
    FastifyRequest,
    SchedulerJobActorBillingRateUpdateInput
  >();
  const inventoryMeterByRequest = new WeakMap<FastifyRequest, InventoryMeterRegistration>();

  app.get('/scheduler/summary', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Dashboard counts for the work calendar',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const summary = await getScheduleSummary(request.user);
    return reply.send(summary);
  });

  app.get('/scheduler/inventory', {
    schema: {
      tags: ['Portal Scheduler Inventory'],
      summary: 'Company and Field user meter custody counts',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (_request, reply) => {
    const [totals, users] = await Promise.all([
      db.select({ status: ihInventoryMeters.status, meterCount: count() })
        .from(ihInventoryMeters)
        .where(and(
          isNull(ihInventoryMeters.deletedAt),
          // Installed meters belong to sites and are no longer available inventory.
          eq(ihInventoryMeters.status, 'company'),
        ))
        .groupBy(ihInventoryMeters.status),
      db.select({
        userId: ihUsers.id,
        fullName: ihUsers.fullName,
        email: ihUsers.email,
        meterCount: count(),
      }).from(ihInventoryMeters)
        .innerJoin(ihUsers, eq(ihUsers.id, ihInventoryMeters.custodianUserId))
        .where(and(
          isNull(ihInventoryMeters.deletedAt),
          eq(ihInventoryMeters.status, 'user'),
        ))
        .groupBy(ihUsers.id, ihUsers.fullName, ihUsers.email),
    ]);
    const companyMeters = Number(totals[0]?.meterCount ?? 0);
    const userMeters = users.reduce((sum, user) => sum + Number(user.meterCount), 0);
    return reply.send({
      companyMeters,
      userMeters,
      totalMetersInInventory: companyMeters + userMeters,
      users: users.map((user) => ({
        userId: user.userId,
        name: user.fullName?.trim() || user.email,
        email: user.email,
        meterCount: Number(user.meterCount),
      })).sort((a, b) => b.meterCount - a.meterCount || a.name.localeCompare(b.name)),
    });
  });

  app.get('/scheduler/meter-register', {
    schema: {
      tags: ['Portal Scheduler Inventory'],
      summary: 'Search non-installed company and user-held Field meter stock',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search: { type: 'string', maxLength: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const query = request.query as { search?: string };
    return reply.send(await listNonInstalledInventoryMeters({ search: query.search }));
  });

  app.post('/scheduler/meter-register', {
    schema: {
      tags: ['Portal Scheduler Inventory'],
      summary: 'Register a non-installed meter in company stock',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['deviceId', 'deviceModel'],
        additionalProperties: false,
        properties: {
          deviceId: { type: 'string', minLength: 1, maxLength: 200 },
          deviceModel: { type: 'string', enum: ['A3RM', 'A6M', 'OTHER'] },
          customManufacturerName: { type: ['string', 'null'], maxLength: 200 },
          customModelName: { type: ['string', 'null'], maxLength: 200 },
          notes: { type: ['string', 'null'], maxLength: 2000 },
        },
      },
    },
    preValidation: async (request) => {
      // Retain the exact meter-only contract before Ajv can coerce or remove
      // unexpected fields such as job, site, scheduling, or custody data.
      inventoryMeterByRequest.set(request, parseInventoryMeterRegistration(request.body));
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const meter = inventoryMeterByRequest.get(request);
    if (!meter) throw new Error('Inventory meter request was not validated');
    const created = await registerInventoryMeter({
      meter,
      custodianUserId: null,
      actorUserId: request.user.userId,
    });
    return reply.status(201).send(toNonInstalledInventoryMeterItem({ meter: created }));
  });

  app.get('/scheduler/analytics', {
    schema: {
      tags: ['Portal Scheduler Analytics'],
      summary: 'Admin people and financial analytics for an inclusive calendar-date window',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to'],
        properties: {
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          timezone: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return reply.send(await getSchedulerAnalytics(request.user, {
      from: query.from,
      to: query.to,
      timezone: query.timezone,
    }));
  });

  app.post('/scheduler/address-suggestions', {
    schema: {
      tags: ['Portal Scheduler Routing'],
      summary: 'Suggest normalized Australian addresses from the configured geocoder',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 300 },
          postcode: { type: 'string', pattern: '^[0-9]{4}$' },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    return reply.send(await suggestSchedulerAddresses({
      query: typeof body.query === 'string' ? body.query : '',
      postcode: typeof body.postcode === 'string' ? body.postcode : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
    }));
  });

  app.get('/scheduler/clients', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Search company clients and all saved site addresses',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 300 },
          clientId: { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const query = request.query as { q?: string; clientId?: string; limit?: number };
    return reply.send({
      companyScope: 'current',
      clients: await listClientDirectory({
        query: query.q,
        clientId: query.clientId,
        limit: query.limit,
      }),
    });
  });

  app.post('/scheduler/client-address-suggestions', {
    schema: {
      tags: ['Portal Scheduler Routing'],
      summary: 'Return saved client addresses and Australian provider suggestions together',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          clientId: { type: 'string', minLength: 1, maxLength: 200 },
          query: { type: 'string', maxLength: 300 },
          postcode: { type: 'string', pattern: '^[0-9]{4}$' },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      clientId?: string;
      query?: string;
      postcode?: string;
      limit?: number;
    };
    return reply.send(await suggestClientAndProviderAddresses({
      clientId: body.clientId,
      query: body.query ?? '',
      postcode: body.postcode,
      limit: body.limit,
    }));
  });

  app.post<{ Params: { id: string } }>('/scheduler/clients/:id/merge', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Merge one duplicate client into another without deleting addresses',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['targetClientId', 'reason'],
        properties: {
          targetClientId: { type: 'string', minLength: 1, maxLength: 200 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { targetClientId: string; reason: string };
    return reply.send({
      client: await mergeBusinessClients({
        sourceClientId: request.params.id,
        targetClientId: body.targetClientId,
        mergedByUserId: request.user.userId,
        reason: body.reason,
      }),
    });
  });

  app.post('/scheduler/route-suggestions', {
    schema: {
      tags: ['Portal Scheduler Routing'],
      summary: 'Suggest the shortest route through one employee’s scheduled Australian jobs',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'currentLocation'],
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          assigneeFieldUserId: { type: 'string', minLength: 1, maxLength: 200 },
          currentLocation: {
            type: 'object',
            additionalProperties: false,
            required: ['latitude', 'longitude'],
            properties: {
              latitude: { type: 'number', minimum: -44, maximum: -9 },
              longitude: { type: 'number', minimum: 112, maximum: 154 },
              accuracyMeters: { type: 'number', minimum: 0, maximum: 100000 },
              capturedAt: { type: 'string' },
            },
          },
        },
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return reply.send(await getSchedulerRouteSuggestion(request.user, {
      date: body.date,
      currentLocation: body.currentLocation,
      assigneeFieldUserId: body.assigneeFieldUserId,
    }));
  });

  app.get('/scheduler/leave-requests', {
    schema: {
      tags: ['Portal Scheduler HR'],
      summary: 'List personal leave or, for administrators, team leave',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          globalUserId: { type: 'string', minLength: 1 },
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected', 'cancelled'],
          },
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => reply.send({
    requests: await listSchedulerLeaveRequests(
      request.user,
      request.query as Record<string, unknown>,
    ),
  }));

  app.post('/scheduler/leave-requests', {
    schema: {
      tags: ['Portal Scheduler HR'],
      summary: 'Apply for leave as the signed-in employee',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['leaveType', 'startDate', 'endDate'],
        properties: {
          leaveType: {
            type: 'string',
            enum: ['annual', 'personal', 'unpaid', 'other'],
          },
          startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          employeeNote: { type: ['string', 'null'], maxLength: 2000 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => reply.status(201).send(await createSchedulerLeaveRequest(
    request.user,
    request.body as Record<string, unknown> & {
      leaveType: unknown;
      startDate: unknown;
      endDate: unknown;
    },
  )));

  app.post<{ Params: { id: string } }>('/scheduler/leave-requests/:id/decision', {
    schema: {
      tags: ['Portal Scheduler HR'],
      summary: 'Approve or reject a pending leave request',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['decision', 'expectedUpdatedAt'],
        properties: {
          decision: { type: 'string', enum: ['approve', 'reject'] },
          reviewerNote: { type: ['string', 'null'], maxLength: 2000 },
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await reviewSchedulerLeaveRequest(
    request.user,
    request.params.id,
    request.body as {
      decision: unknown;
      reviewerNote?: unknown;
      expectedUpdatedAt: unknown;
    },
  )));

  app.post<{ Params: { id: string } }>('/scheduler/leave-requests/:id/cancel', {
    schema: {
      tags: ['Portal Scheduler HR'],
      summary: 'Cancel a pending or approved leave request',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedUpdatedAt'],
        properties: {
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => reply.send(await cancelSchedulerLeaveRequest(
    request.user,
    request.params.id,
    request.body as { expectedUpdatedAt: unknown },
  )));

  app.get('/scheduler/events', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'List schedule events in a date window',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          assigneeFieldUserId: { type: 'string' },
          sourceApp: { type: 'string' },
          status: { type: 'string' },
          includeCancelled: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    if (q.assigneeFieldUserId && !isSchedulerAdmin(request.user)) {
      throw forbidden('Inspectors cannot filter other users’ calendars');
    }

    const events = await listScheduleEvents(request.user, {
      from: parseOptionalDate(q.from, 'from'),
      to: parseOptionalDate(q.to, 'to'),
      assigneeFieldUserId: q.assigneeFieldUserId,
      sourceApp: q.sourceApp as ScheduleSourceApp | undefined,
      status: q.status as ScheduleStatus | undefined,
      includeCancelled: q.includeCancelled === 'true' || q.includeCancelled === '1',
    });
    return reply.send({ events });
  });

  app.get<{ Params: { id: string } }>('/scheduler/events/:id', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Get one schedule event',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate],
  }, async (request, reply) => {
    const event = await getScheduleEvent(request.user, request.params.id);
    return reply.send(event);
  });

  app.post('/scheduler/events', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Create a linked or custom schedule event',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const event = await createScheduleEvent(request.user, {
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' || body.description === null
        ? (body.description as string | null)
        : undefined,
      sourceApp: body.sourceApp,
      sourceType: body.sourceType,
      sourceId: typeof body.sourceId === 'string' ? body.sourceId : null,
      assigneeFieldUserId: String(body.assigneeFieldUserId ?? ''),
      scheduledStartAt: body.scheduledStartAt,
      estimatedDurationMinutes: body.estimatedDurationMinutes,
      deadlineAt: body.deadlineAt,
      status: body.status,
    });
    return reply.status(201).send(event);
  });

  app.post('/scheduler/dispatches', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Create a product job, with a planned event when an assignee is supplied',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceApp',
          'scheduledStartAt',
          'deadlineAt',
          'job',
        ],
        properties: {
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          title: { type: 'string', maxLength: 300 },
          description: { type: ['string', 'null'] },
          assigneeFieldUserId: { type: 'string' },
          scheduledStartAt: { type: 'string' },
          estimatedDurationMinutes: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: MAX_ESTIMATED_DURATION_MINUTES,
          },
          // Rolling-deploy compatibility only. The handler deliberately
          // ignores this deprecated field instead of persisting or inferring it.
          scheduledEndAt: { type: ['string', 'null'] },
          deadlineAt: { type: 'string' },
          job: { type: 'object', additionalProperties: true },
          // Kept in the validated payload so the service can reject attempts
          // to set a client-owned lifecycle state instead of Ajv stripping it.
          status: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const event = await createSchedulerDispatch(request.user, {
      sourceApp: body.sourceApp,
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' || body.description === null
        ? (body.description as string | null)
        : undefined,
      assigneeFieldUserId: String(body.assigneeFieldUserId ?? ''),
      scheduledStartAt: body.scheduledStartAt,
      estimatedDurationMinutes: body.estimatedDurationMinutes,
      deadlineAt: body.deadlineAt,
      job: body.job,
      status: body.status,
    });
    return reply.status(201).send(event);
  });

  app.patch<{ Params: { id: string } }>('/scheduler/events/:id', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Update a schedule event',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const event = await updateScheduleEvent(request.user, request.params.id, {
      title: typeof body.title === 'string' ? body.title : undefined,
      description: body.description === null || typeof body.description === 'string'
        ? (body.description as string | null)
        : undefined,
      assigneeFieldUserId: typeof body.assigneeFieldUserId === 'string'
        ? body.assigneeFieldUserId
        : undefined,
      scheduledStartAt: body.scheduledStartAt,
      estimatedDurationMinutes: body.estimatedDurationMinutes,
      deadlineAt: body.deadlineAt,
      status: body.status,
    });
    return reply.send(event);
  });

  app.post<{
    Params: { sourceApp: string; sourceType: string; sourceId: string };
  }>('/scheduler/jobs/:sourceApp/:sourceType/:sourceId/complete', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Mark a linked product job complete from Scheduler',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['idempotencyKey'],
        properties: {
          idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { idempotencyKey: string };
    const result = await completeSchedulerJob(request.user, {
      sourceApp: request.params.sourceApp as Exclude<ScheduleSourceApp, 'custom'>,
      sourceType: request.params.sourceType as Exclude<ScheduleSourceType, 'custom'>,
      sourceId: request.params.sourceId,
      idempotencyKey: body.idempotencyKey,
    });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/scheduler/events/:id', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Cancel a schedule event',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const event = await cancelScheduleEvent(request.user, request.params.id);
    return reply.send(event);
  });

  app.post<{ Params: { id: string } }>('/scheduler/events/:id/remind', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Queue an immediate mobile reminder for the assigned user',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['idempotencyKey'],
        properties: {
          idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { idempotencyKey: string };
    const queued = await queueManualSchedulerReminder(
      request.user,
      request.params.id,
      body.idempotencyKey,
    );
    return reply.status(202).send(queued);
  });

  app.get('/scheduler/finance', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'List one commercial summary row per unique scheduler source job',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'string' },
          cursor: { type: 'string' },
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          sourceId: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const query = request.query as {
      limit?: string;
      cursor?: string;
      sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
      sourceId?: string;
    };
    const parsedLimit = query.limit === undefined ? undefined : Number(query.limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
      throw badRequest('limit must be a positive integer');
    }
    return reply.send(await listSchedulerFinanceOverview(request.user, {
      limit: parsedLimit,
      cursor: query.cursor,
      sourceApp: query.sourceApp,
      sourceId: query.sourceId,
    }));
  });

  app.get('/scheduler/finance/portfolio-summary', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Get exact currency-separated Scheduler portfolio totals',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          sourceId: { type: 'string' },
          currency: { type: 'string', minLength: 1, maxLength: 8 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await getSchedulerFinancePortfolioSummary(
    request.user,
    request.query as {
      sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
      sourceId?: string;
      currency?: string;
    },
  )));

  app.get('/scheduler/invoices', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'List invoices across every Scheduler job',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'string' },
          cursor: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'issued', 'paid', 'void'] },
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          financeId: { type: 'string' },
          search: { type: 'string', maxLength: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const query = request.query as {
      limit?: string;
      cursor?: string;
      status?: 'draft' | 'issued' | 'paid' | 'void';
      sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
      financeId?: string;
      search?: string;
    };
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw badRequest('limit must be a positive integer');
    }
    return reply.send(await listSchedulerInvoicePortfolio(request.user, {
      ...query,
      limit,
    }));
  });

  app.post('/scheduler/invoices/eligibility', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Preview reservation-safe consolidated invoice eligibility',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['financeIds'],
        properties: {
          financeIds: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            uniqueItems: true,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { financeIds: string[] };
    return reply.send(await getConsolidatedInvoiceEligibility(request.user, body.financeIds));
  });

  app.post('/scheduler/invoices/quick', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Create one reservation-safe invoice across selected jobs',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['jobs'],
        properties: {
          jobs: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['financeId'],
              properties: {
                financeId: { type: 'string', minLength: 1 },
                expenseIds: {
                  type: 'array',
                  uniqueItems: true,
                  items: { type: 'string', minLength: 1 },
                },
                includeLabour: { type: 'boolean' },
              },
            },
          },
          billTo: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 300 },
              abn: { type: ['string', 'null'], maxLength: 100 },
              address: { type: ['string', 'null'], maxLength: 1000 },
              email: { type: ['string', 'null'], maxLength: 320 },
              purchaseOrderReference: { type: ['string', 'null'], maxLength: 200 },
            },
          },
          notes: { type: ['string', 'null'], maxLength: 5000 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.status(201).send(
    await createConsolidatedSchedulerInvoice(
      request.user,
      request.body as ConsolidatedInvoiceInput,
    ),
  ));

  app.get<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Get a single- or multi-job Scheduler invoice',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await getConsolidatedSchedulerInvoice(
    request.user,
    request.params.invoiceId,
  )));

  app.get<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/refunds', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'List posted and voided refunds for an invoice',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send({
    items: await listSchedulerInvoiceRefunds(request.user, request.params.invoiceId),
  }));

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/refunds', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Post a partial or full invoice refund',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: [
          'idempotencyKey',
          'expectedUpdatedAt',
          'amountExGst',
          'gstAmount',
          'reason',
        ],
        properties: {
          idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
          amountExGst: { type: 'number', exclusiveMinimum: 0 },
          gstAmount: { type: 'number', minimum: 0 },
          refundedAt: { type: ['string', 'null'], format: 'date-time' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
          externalReference: { type: ['string', 'null'], maxLength: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.status(201).send(await postSchedulerInvoiceRefund(
    request.user,
    request.params.invoiceId,
    request.body as PostSchedulerInvoiceRefundInput,
  )));

  app.post<{ Params: { invoiceId: string; refundId: string } }>(
    '/scheduler/invoices/:invoiceId/refunds/:refundId/void',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Void a posted refund while retaining its audit history',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedUpdatedAt', 'reason'],
          properties: {
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            reason: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await voidSchedulerInvoiceRefund(
      request.user,
      request.params.invoiceId,
      request.params.refundId,
      request.body as VoidSchedulerInvoiceRefundInput,
    )),
  );

  app.patch<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Edit draft content or reconcile non-void invoice Xero metadata',
      security: [{ bearerAuth: [] }],
      body: invoiceDraftBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await updateConsolidatedSchedulerDraftInvoice(
    request.user,
    request.params.invoiceId,
    (request.body ?? {}) as UpdateDraftInvoiceInput,
  )));

  app.patch<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/seller', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Save the current seller ABN and apply it to this invoice',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['sellerAbn', 'expectedUpdatedAt'],
        properties: {
          sellerAbn: { type: ['string', 'null'], maxLength: 100 },
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await updateSchedulerInvoiceSeller(
    request.user,
    request.params.invoiceId,
    request.body as UpdateSchedulerInvoiceSellerInput,
  )));

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/issue', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Issue or reissue a consolidated invoice revision',
      security: [{ bearerAuth: [] }],
      body: invoiceVersionBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { expectedUpdatedAt: string };
    const invoice = await issueConsolidatedSchedulerInvoice(
      request.user,
      request.params.invoiceId,
      body.expectedUpdatedAt,
    );
    const pdfExport = await queueSchedulerInvoicePdfByInvoiceId(
      request.user,
      invoice.id,
      invoice.updatedAt,
    );
    return reply.send({ ...invoice, pdfExport });
  });

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/void', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Void an unpaid consolidated invoice',
      security: [{ bearerAuth: [] }],
      body: invoiceVersionBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { expectedUpdatedAt: string };
    return reply.send(await voidConsolidatedSchedulerInvoice(
      request.user,
      request.params.invoiceId,
      body.expectedUpdatedAt,
    ));
  });

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/mark-paid', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Mark an issued consolidated invoice paid',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedUpdatedAt'],
        properties: {
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
          paidAt: { type: ['string', 'null'] },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { expectedUpdatedAt: string; paidAt?: string | null };
    return reply.send(await markConsolidatedSchedulerInvoicePaid(
      request.user,
      request.params.invoiceId,
      body.paidAt,
      body.expectedUpdatedAt,
    ));
  });

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/pdf/jobs', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Queue a durable consolidated invoice PDF export',
      security: [{ bearerAuth: [] }],
      body: invoiceVersionBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { expectedUpdatedAt: string };
    return reply.status(202).send(await queueSchedulerInvoicePdfByInvoiceId(
      request.user,
      request.params.invoiceId,
      body.expectedUpdatedAt,
    ));
  });

  app.get<{ Params: { invoiceId: string } }>(
    '/scheduler/invoices/:invoiceId/email-deliveries',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'List the durable email delivery audit for a Scheduler invoice',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send({
      items: await listSchedulerInvoiceEmailDeliveries(
        request.user,
        request.params.invoiceId,
      ),
    }),
  );

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/email', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Queue an issued Scheduler invoice for idempotent Gmail delivery',
      security: [{ bearerAuth: [] }],
      body: invoiceEmailBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.status(202).send(await queueSchedulerInvoiceEmail(
    request.user,
    request.params.invoiceId,
    request.body as QueueSchedulerInvoiceEmailInput,
  )));

  app.get('/scheduler/expenses', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'List bills and expenses across every Scheduler job',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'string' },
          cursor: { type: 'string' },
          kind: { type: 'string', enum: ['expense', 'supplier_bill'] },
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          financeId: { type: 'string' },
          search: { type: 'string', maxLength: 200 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const query = request.query as {
      limit?: string;
      cursor?: string;
      kind?: 'expense' | 'supplier_bill';
      sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
      financeId?: string;
      search?: string;
    };
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw badRequest('limit must be a positive integer');
    }
    return reply.send(await listSchedulerExpensePortfolio(request.user, { ...query, limit }));
  });

  app.post<{ Params: { expenseId: string } }>('/scheduler/expenses/:expenseId/attachments', {
    bodyLimit: config.schedulerFinance.billAttachmentMaxBytes,
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Upload private PDF or image evidence for a bill or expense',
      security: [{ bearerAuth: [] }],
      headers: {
        type: 'object',
        required: ['x-file-name'],
        properties: {
          'x-file-name': { type: 'string', minLength: 1, maxLength: 500 },
          'x-file-content-type': { type: 'string', maxLength: 100 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.status(201).send(await uploadSchedulerExpenseAttachment(
    request.user,
    request.params.expenseId,
    {
      filename: request.headers['x-file-name'],
      contentType: request.headers['x-file-content-type'],
      body: request.body,
    },
  )));

  app.get<{ Params: { expenseId: string; attachmentId: string } }>(
    '/scheduler/expenses/:expenseId/attachments/:attachmentId/download',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Download private bill or expense evidence',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const attachment = await downloadSchedulerExpenseAttachment(
        request.user,
        request.params.expenseId,
        request.params.attachmentId,
      );
      return reply
        .header('Content-Length', String(attachment.sizeBytes))
        .header('Content-Disposition', exportArtifactContentDisposition(attachment.filename))
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Authorization')
        .type(attachment.contentType)
        .send(attachment.stream);
    },
  );

  app.delete<{ Params: { expenseId: string; attachmentId: string } }>(
    '/scheduler/expenses/:expenseId/attachments/:attachmentId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Delete unreserved private bill or expense evidence',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      await deleteSchedulerExpenseAttachment(
        request.user,
        request.params.expenseId,
        request.params.attachmentId,
      );
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { financeId: string } }>('/scheduler/finance/:financeId', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Get a commercial ledger by stable finance identity',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await getSchedulerFinancialSummaryById(
    request.user,
    request.params.financeId,
  )));

  app.put<{ Params: { financeId: string } }>('/scheduler/finance/:financeId', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Update a commercial ledger by stable finance identity',
      security: [{ bearerAuth: [] }],
      body: financeUpdateBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await updateSchedulerFinanceById(
    request.user,
    request.params.financeId,
    (request.body ?? {}) as FinanceUpdateInput,
  )));

  app.patch<{
    Params: { financeId: string; globalUserId: string };
  }>('/scheduler/finance/:financeId/actors/:globalUserId/billing-rate', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Set or clear one actor billing-rate override for one job',
      security: [{ bearerAuth: [] }],
      body: jobActorBillingRateBodySchema,
    },
    preValidation: async (request) => {
      // Fastify's Ajv configuration coerces scalar values. Validate and retain
      // the original JSON body before schema validation so strings and
      // booleans can never become accounting values.
      jobActorBillingRateByRequest.set(
        request,
        parseJobActorBillingRateBody(request.body),
      );
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const input = jobActorBillingRateByRequest.get(request);
    if (!input) throw new Error('Job actor billing rate request was not validated');
    return reply.send(await updateSchedulerJobActorBillingRateByFinanceId(
      request.user,
      request.params.financeId,
      request.params.globalUserId,
      input,
    ));
  });

  app.post<{ Params: { financeId: string } }>('/scheduler/finance/:financeId/expenses', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Add a structured ex-GST expense or supplier bill',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'category', 'description', 'costAmount'],
        properties: expenseProperties,
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.status(201).send(await createSchedulerExpenseByFinanceId(
    request.user,
    request.params.financeId,
    request.body as ExpenseInput,
  )));

  app.patch<{ Params: { financeId: string; expenseId: string } }>(
    '/scheduler/finance/:financeId/expenses/:expenseId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Update an unreserved expense or supplier bill',
        security: [{ bearerAuth: [] }],
        body: { type: 'object', additionalProperties: false, properties: expenseProperties },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await updateSchedulerExpenseByFinanceId(
      request.user,
      request.params.financeId,
      request.params.expenseId,
      (request.body ?? {}) as Partial<ExpenseInput>,
    )),
  );

  app.delete<{ Params: { financeId: string; expenseId: string } }>(
    '/scheduler/finance/:financeId/expenses/:expenseId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Delete an unreserved expense or supplier bill',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      await deleteSchedulerExpenseByFinanceId(
        request.user,
        request.params.financeId,
        request.params.expenseId,
      );
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { financeId: string } }>('/scheduler/finance/:financeId/invoices', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'List invoices for a stable commercial ledger',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send({
    items: await listSchedulerInvoicesByFinanceId(request.user, request.params.financeId),
  }));

  app.post<{ Params: { financeId: string } }>('/scheduler/finance/:financeId/invoices/quick', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Create a reservation-safe quick draft invoice',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expenseIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          includeLabour: { type: 'boolean' },
          notes: { type: ['string', 'null'], maxLength: 5000 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.status(201).send(await createQuickSchedulerInvoiceByFinanceId(
    request.user,
    request.params.financeId,
    (request.body ?? {}) as QuickInvoiceInput,
  )));

  app.get<{ Params: { financeId: string; invoiceId: string } }>(
    '/scheduler/finance/:financeId/invoices/:invoiceId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Get an invoice from a stable commercial ledger',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await getSchedulerInvoiceByFinanceId(
      request.user,
      request.params.financeId,
      request.params.invoiceId,
    )),
  );

  app.patch<{ Params: { financeId: string; invoiceId: string } }>(
    '/scheduler/finance/:financeId/invoices/:invoiceId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Edit draft content or reconcile non-void invoice Xero metadata',
        security: [{ bearerAuth: [] }],
        body: invoiceDraftBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await updateSchedulerDraftInvoiceByFinanceId(
      request.user,
      request.params.financeId,
      request.params.invoiceId,
      (request.body ?? {}) as UpdateDraftInvoiceInput,
    )),
  );

  app.post<{ Params: { financeId: string; invoiceId: string } }>(
    '/scheduler/finance/:financeId/invoices/:invoiceId/issue',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Issue or reissue a scheduler invoice revision',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      const invoice = await issueSchedulerInvoiceByFinanceId(
        request.user,
        request.params.financeId,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      );
      const pdfExport = await queueSchedulerInvoicePdfByFinanceId(
        request.user,
        request.params.financeId,
        invoice.id,
        invoice.updatedAt,
      );
      return reply.send({ ...invoice, pdfExport });
    },
  );

  app.post<{ Params: { financeId: string; invoiceId: string } }>(
    '/scheduler/finance/:financeId/invoices/:invoiceId/void',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Void an unpaid invoice and release its reservations',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      return reply.send(await voidSchedulerInvoiceByFinanceId(
        request.user,
        request.params.financeId,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      ));
    },
  );

  app.post<{ Params: { financeId: string; invoiceId: string } }>(
    '/scheduler/finance/:financeId/invoices/:invoiceId/mark-paid',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Mark an issued invoice paid',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedUpdatedAt'],
          properties: {
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            paidAt: { type: ['string', 'null'] },
          },
        },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string; paidAt?: string | null };
      return reply.send(await markSchedulerInvoicePaidByFinanceId(
        request.user,
        request.params.financeId,
        request.params.invoiceId,
        body.paidAt,
        body.expectedUpdatedAt,
      ));
    },
  );

  app.post<{ Params: { financeId: string; invoiceId: string } }>(
    '/scheduler/finance/:financeId/invoices/:invoiceId/pdf/jobs',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Queue a durable branded invoice PDF export',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      const queued = await queueSchedulerInvoicePdfByFinanceId(
        request.user,
        request.params.financeId,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      );
      return reply.status(202).send(queued);
    },
  );

  app.get<{ Params: { id: string } }>('/scheduler/events/:id/financial-summary', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Get recorded time, commercial settings, expenses, and invoices for a source job',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    return reply.send(await getSchedulerFinancialSummary(request.user, request.params.id));
  });

  app.put<{ Params: { id: string } }>('/scheduler/events/:id/finance', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Update job pricing, rates, billing contact, and hour override provenance',
      security: [{ bearerAuth: [] }],
      body: financeUpdateBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const summary = await updateSchedulerFinance(
      request.user,
      request.params.id,
      (request.body ?? {}) as FinanceUpdateInput,
    );
    return reply.send(summary);
  });

  app.post<{ Params: { id: string } }>('/scheduler/events/:id/expenses', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Add a structured ex-GST expense or supplier bill',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'category', 'description', 'costAmount'],
        properties: expenseProperties,
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const expense = await createSchedulerExpense(
      request.user,
      request.params.id,
      request.body as ExpenseInput,
    );
    return reply.status(201).send(expense);
  });

  app.patch<{ Params: { id: string; expenseId: string } }>(
    '/scheduler/events/:id/expenses/:expenseId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Update an unreserved expense or supplier bill',
        security: [{ bearerAuth: [] }],
        body: { type: 'object', additionalProperties: false, properties: expenseProperties },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const expense = await updateSchedulerExpense(
        request.user,
        request.params.id,
        request.params.expenseId,
        (request.body ?? {}) as Partial<ExpenseInput>,
      );
      return reply.send(expense);
    },
  );

  app.delete<{ Params: { id: string; expenseId: string } }>(
    '/scheduler/events/:id/expenses/:expenseId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Delete an unreserved expense or supplier bill',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      await deleteSchedulerExpense(request.user, request.params.id, request.params.expenseId);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string } }>('/scheduler/events/:id/invoices', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'List invoices for a scheduler source job',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    return reply.send({ items: await listSchedulerInvoices(request.user, request.params.id) });
  });

  app.post<{ Params: { id: string } }>('/scheduler/events/:id/invoices/quick', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Create a reservation-safe quick draft invoice',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expenseIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          includeLabour: { type: 'boolean' },
          notes: { type: ['string', 'null'], maxLength: 5000 },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const invoice = await createQuickSchedulerInvoice(
      request.user,
      request.params.id,
      (request.body ?? {}) as QuickInvoiceInput,
    );
    return reply.status(201).send(invoice);
  });

  app.get<{ Params: { id: string; invoiceId: string } }>(
    '/scheduler/events/:id/invoices/:invoiceId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Get an invoice with its current job and billing values',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await getSchedulerInvoice(
      request.user,
      request.params.id,
      request.params.invoiceId,
    )),
  );

  app.patch<{ Params: { id: string; invoiceId: string } }>(
    '/scheduler/events/:id/invoices/:invoiceId',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Edit draft content or reconcile non-void invoice Xero metadata',
        security: [{ bearerAuth: [] }],
        body: invoiceDraftBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await updateSchedulerDraftInvoice(
      request.user,
      request.params.id,
      request.params.invoiceId,
      (request.body ?? {}) as UpdateDraftInvoiceInput,
    )),
  );

  app.post<{ Params: { id: string; invoiceId: string } }>(
    '/scheduler/events/:id/invoices/:invoiceId/issue',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'issue a scheduler invoice',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      const invoice = await issueSchedulerInvoice(
        request.user,
        request.params.id,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      );
      const pdfExport = await queueSchedulerInvoicePdfByEventId(
        request.user,
        request.params.id,
        invoice.id,
        invoice.updatedAt,
      );
      return reply.send({ ...invoice, pdfExport });
    },
  );

  app.post<{ Params: { id: string; invoiceId: string } }>(
    '/scheduler/events/:id/invoices/:invoiceId/void',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'void a scheduler invoice',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      return reply.send(await voidSchedulerInvoice(
        request.user,
        request.params.id,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      ));
    },
  );

  app.post<{ Params: { id: string; invoiceId: string } }>(
    '/scheduler/events/:id/invoices/:invoiceId/mark-paid',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Mark an issued scheduler invoice paid',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedUpdatedAt'],
          properties: {
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            paidAt: { type: ['string', 'null'] },
          },
        },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string; paidAt?: string | null };
      return reply.send(await markSchedulerInvoicePaid(
        request.user,
        request.params.id,
        request.params.invoiceId,
        body.paidAt,
        body.expectedUpdatedAt,
      ));
    },
  );

  app.post<{ Params: { id: string; invoiceId: string } }>(
    '/scheduler/events/:id/invoices/:invoiceId/pdf/jobs',
    {
      schema: {
        tags: ['Portal Scheduler Finance'],
        summary: 'Queue a durable branded invoice PDF export',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      const queued = await queueSchedulerInvoicePdfByEventId(
        request.user,
        request.params.id,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      );
      return reply.status(202).send(queued);
    },
  );

  app.get('/scheduler/job-options', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'Search product jobs to link to a schedule event',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          sourceApp: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const q = request.query as { q?: string; sourceApp?: string };
    const options = await searchJobOptions(
      request.user,
      q.q ?? '',
      q.sourceApp as ScheduleSourceApp | undefined,
    );
    return reply.send({ options });
  });

  app.get('/scheduler/sites', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'List canonical client sites for editable job prefill',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          limit: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const q = request.query as { q?: string; sourceApp?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : undefined;
    const sites = await listSchedulerSites(request.user, {
      q: q.q,
      sourceApp: q.sourceApp as Exclude<ScheduleSourceApp, 'custom'> | undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return reply.send({ sites });
  });

  app.get('/scheduler/unscheduled-jobs', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'List product jobs for the Scheduler jobs panel',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          sourceApp: { type: 'string' },
          limit: { type: 'string' },
          unscheduledOnly: { type: 'string', enum: ['true', 'false'] },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const q = request.query as {
      q?: string;
      sourceApp?: string;
      limit?: string;
      unscheduledOnly?: string;
    };
    const limit = q.limit ? Number(q.limit) : undefined;
    const jobs = await listUnscheduledJobs(request.user, {
      q: q.q ?? '',
      sourceApp: q.sourceApp as ScheduleSourceApp | undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      unscheduledOnly: q.unscheduledOnly === undefined
        ? true
        : q.unscheduledOnly === 'true',
    });
    return reply.send({ jobs });
  });
}
