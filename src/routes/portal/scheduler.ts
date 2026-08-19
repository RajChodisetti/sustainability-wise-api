import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../auth/middleware.js';
import { config } from '../../config.js';
import {
  assertPortalSchedulerApp,
  cancelScheduleEvent,
  createScheduleEvent,
  createSchedulerDispatch,
  getScheduleEvent,
  getScheduleSummary,
  isSchedulerAdmin,
  listScheduleEvents,
  listUnscheduledJobs,
  MAX_ESTIMATED_DURATION_MINUTES,
  searchJobOptions,
  updateScheduleEvent,
  type ScheduleSourceApp,
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
  updateSchedulerExpense,
  updateSchedulerExpenseByFinanceId,
  updateSchedulerFinance,
  updateSchedulerFinanceById,
  voidSchedulerInvoice,
  voidSchedulerInvoiceByFinanceId,
  voidConsolidatedSchedulerInvoice,
  uploadSchedulerExpenseAttachment,
  downloadSchedulerExpenseAttachment,
  type ConsolidatedInvoiceInput,
  type ExpenseInput,
  type FinanceUpdateInput,
  type QuickInvoiceInput,
  type UpdateDraftInvoiceInput,
} from '../../services/schedulerFinanceService.js';
import { exportArtifactContentDisposition } from '../pdfJobs.js';
import {
  queueSchedulerInvoicePdfByInvoiceId,
  queueSchedulerInvoicePdfByEventId,
  queueSchedulerInvoicePdfByFinanceId,
} from '../../services/schedulerInvoicePdfExport.js';
import {
  listSchedulerInvoiceEmailDeliveries,
  queueSchedulerInvoiceEmail,
  type QueueSchedulerInvoiceEmailInput,
} from '../../services/schedulerInvoiceEmailService.js';

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
    to: { type: 'string', minLength: 1, maxLength: 320 },
    subject: { type: 'string', minLength: 1, maxLength: 500 },
    message: { type: 'string', maxLength: 10000 },
  },
} as const;

export async function portalSchedulerRoutes(app: FastifyInstance): Promise<void> {
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
      summary: 'Create a new product job and planned scheduler event atomically',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceApp',
          'assigneeFieldUserId',
          'scheduledStartAt',
          'deadlineAt',
          'job',
        ],
        properties: {
          sourceApp: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          title: { type: 'string', maxLength: 300 },
          description: { type: ['string', 'null'] },
          assigneeFieldUserId: { type: 'string', minLength: 1 },
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

  app.patch<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Edit a consolidated draft invoice',
      security: [{ bearerAuth: [] }],
      body: invoiceDraftBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => reply.send(await updateConsolidatedSchedulerDraftInvoice(
    request.user,
    request.params.invoiceId,
    (request.body ?? {}) as UpdateDraftInvoiceInput,
  )));

  app.post<{ Params: { invoiceId: string } }>('/scheduler/invoices/:invoiceId/issue', {
    schema: {
      tags: ['Portal Scheduler Finance'],
      summary: 'Issue and freeze a consolidated invoice snapshot',
      security: [{ bearerAuth: [] }],
      body: invoiceVersionBodySchema,
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { expectedUpdatedAt: string };
    return reply.send(await issueConsolidatedSchedulerInvoice(
      request.user,
      request.params.invoiceId,
      body.expectedUpdatedAt,
    ));
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
        summary: 'Edit draft invoice fields, costs, and presentation',
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
        summary: 'Issue and freeze a scheduler invoice snapshot',
        security: [{ bearerAuth: [] }],
        body: invoiceVersionBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = request.body as { expectedUpdatedAt: string };
      return reply.send(await issueSchedulerInvoiceByFinanceId(
        request.user,
        request.params.financeId,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      ));
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
        summary: 'Get an invoice with immutable job and billing snapshots',
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
        summary: 'Edit draft invoice fields, costs, and presentation',
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
      return reply.send(await issueSchedulerInvoice(
        request.user,
        request.params.id,
        request.params.invoiceId,
        body.expectedUpdatedAt,
      ));
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

  app.get('/scheduler/unscheduled-jobs', {
    schema: {
      tags: ['Portal Scheduler'],
      summary: 'List product jobs not yet on the work calendar',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          sourceApp: { type: 'string' },
          limit: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
  }, async (request, reply) => {
    const q = request.query as { q?: string; sourceApp?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : undefined;
    const jobs = await listUnscheduledJobs(request.user, {
      q: q.q ?? '',
      sourceApp: q.sourceApp as ScheduleSourceApp | undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return reply.send({ jobs });
  });
}
