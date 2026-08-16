import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../auth/middleware.js';
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
  createSchedulerExpense,
  createSchedulerExpenseByFinanceId,
  deleteSchedulerExpense,
  deleteSchedulerExpenseByFinanceId,
  getSchedulerFinancialSummary,
  getSchedulerFinancialSummaryById,
  getSchedulerInvoice,
  getSchedulerInvoiceByFinanceId,
  issueSchedulerInvoice,
  issueSchedulerInvoiceByFinanceId,
  listSchedulerFinanceOverview,
  listSchedulerInvoices,
  listSchedulerInvoicesByFinanceId,
  markSchedulerInvoicePaid,
  markSchedulerInvoicePaidByFinanceId,
  updateSchedulerDraftInvoice,
  updateSchedulerDraftInvoiceByFinanceId,
  updateSchedulerExpense,
  updateSchedulerExpenseByFinanceId,
  updateSchedulerFinance,
  updateSchedulerFinanceById,
  voidSchedulerInvoice,
  voidSchedulerInvoiceByFinanceId,
  type ExpenseInput,
  type FinanceUpdateInput,
  type InvoiceLineInput,
  type QuickInvoiceInput,
  type UpdateDraftInvoiceInput,
} from '../../services/schedulerFinanceService.js';
import {
  queueSchedulerInvoicePdfByEventId,
  queueSchedulerInvoicePdfByFinanceId,
} from '../../services/schedulerInvoicePdfExport.js';

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
    billingAddress: { type: ['string', 'null'], maxLength: 1000 },
    billingEmail: { type: ['string', 'null'], maxLength: 320 },
    billingReference: { type: ['string', 'null'], maxLength: 200 },
    billableHoursOverride: { type: ['number', 'null'], minimum: 0 },
    costHoursOverride: { type: ['number', 'null'], minimum: 0 },
    overrideReason: { type: ['string', 'null'], maxLength: 1000 },
    billableRate: { type: 'number', minimum: 0 },
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
          id: { type: 'string' },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          quantity: { type: 'number', exclusiveMinimum: 0 },
          unitAmountExGst: { type: 'number', minimum: 0 },
          expenseId: { type: ['string', 'null'] },
          kind: { type: 'string', enum: ['labour', 'expense', 'quoted', 'other'] },
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
      scheduledEndAt: body.scheduledEndAt,
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
      scheduledEndAt: body.scheduledEndAt,
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
      scheduledEndAt: body.scheduledEndAt,
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
        summary: 'Edit a draft invoice before its header and lines are frozen at issue',
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
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await voidSchedulerInvoiceByFinanceId(
      request.user,
      request.params.financeId,
      request.params.invoiceId,
    )),
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
          properties: { paidAt: { type: ['string', 'null'] } },
        },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { paidAt?: string | null };
      return reply.send(await markSchedulerInvoicePaidByFinanceId(
        request.user,
        request.params.financeId,
        request.params.invoiceId,
        body.paidAt,
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
        summary: 'Edit draft invoice notes, due date, or snapshot lines',
        security: [{ bearerAuth: [] }],
        body: invoiceDraftBodySchema,
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await updateSchedulerDraftInvoice(
      request.user,
      request.params.id,
      request.params.invoiceId,
      (request.body ?? {}) as UpdateDraftInvoiceInput & { lines?: InvoiceLineInput[] },
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
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => reply.send(await voidSchedulerInvoice(
      request.user,
      request.params.id,
      request.params.invoiceId,
    )),
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
          properties: { paidAt: { type: ['string', 'null'] } },
        },
      },
      preHandler: [authenticate, portalSchedulerGate, requireRole('admin')],
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { paidAt?: string | null };
      return reply.send(await markSchedulerInvoicePaid(
        request.user,
        request.params.id,
        request.params.invoiceId,
        body.paidAt,
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
