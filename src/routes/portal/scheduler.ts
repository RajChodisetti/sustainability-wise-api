import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../auth/middleware.js';
import {
  assertPortalSchedulerApp,
  cancelScheduleEvent,
  createScheduleEvent,
  getScheduleEvent,
  getScheduleSummary,
  isSchedulerAdmin,
  listScheduleEvents,
  searchJobOptions,
  updateScheduleEvent,
  type ScheduleSourceApp,
  type ScheduleStatus,
} from '../../services/scheduleService.js';
import { badRequest, forbidden } from '../../utils/errors.js';

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
}
