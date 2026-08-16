import type { FastifyInstance } from 'fastify';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  createCostLine,
  deleteCostLine,
  financialSummaryToCsv,
  getFinancialSummary,
  updateCostLine,
  upsertFinanceHeader,
  type CostCategory,
  type PricingMode,
} from '../../services/installHubFinanceService.js';
import { badRequest } from '../../utils/errors.js';

export async function installhubFinanceRoutes(app: FastifyInstance): Promise<void> {
  const readGate = [authenticate, requireApp('installhub'), requireRole('admin')] as const;
  const writeGate = [authenticate, requireApp('installhub'), requireRole('admin')] as const;

  app.get('/:installationId/financial-summary', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'Fergus-style financial summary for an installation',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...readGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const summary = await getFinancialSummary(request.user, installationId);
    return reply.send(summary);
  });

  app.get('/:installationId/financial-summary.csv', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'Download financial summary as CSV',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...readGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const summary = await getFinancialSummary(request.user, installationId);
    const csv = financialSummaryToCsv(summary);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="financial-summary-${installationId}.csv"`,
      )
      .send(csv);
  });

  app.put('/:installationId/finance', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'Upsert job finance header (pricing mode, priced amount)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.pricingMode === undefined) throw badRequest('pricingMode is required');
    const header = await upsertFinanceHeader(request.user, installationId, {
      pricingMode: body.pricingMode as PricingMode,
      pricedAmount: body.pricedAmount as number | null,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      notes: body.notes === null || typeof body.notes === 'string' ? (body.notes as string | null) : undefined,
    });
    return reply.send(header);
  });

  app.get('/:installationId/cost-lines', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'List cost lines for an installation',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...readGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const summary = await getFinancialSummary(request.user, installationId);
    return reply.send({ lines: summary.lines });
  });

  app.post('/:installationId/cost-lines', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'Add a cost line',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const line = await createCostLine(request.user, installationId, {
      category: body.category as CostCategory,
      description: String(body.description ?? ''),
      costAmount: body.costAmount as number,
      sellAmount: body.sellAmount as number | null | undefined,
      hours: body.hours as number | null | undefined,
      billable: body.billable as boolean | undefined,
      invoiced: body.invoiced as boolean | undefined,
      incurredAt: body.incurredAt as string | null | undefined,
    });
    return reply.status(201).send(line);
  });

  app.patch('/:installationId/cost-lines/:lineId', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'Update a cost line',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId, lineId } = request.params as {
      installationId: string;
      lineId: string;
    };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const line = await updateCostLine(request.user, installationId, lineId, {
      category: body.category as CostCategory | undefined,
      description: body.description === undefined ? undefined : String(body.description),
      costAmount: body.costAmount as number | undefined,
      sellAmount: body.sellAmount as number | null | undefined,
      hours: body.hours as number | null | undefined,
      billable: body.billable as boolean | undefined,
      invoiced: body.invoiced as boolean | undefined,
      incurredAt: body.incurredAt as string | null | undefined,
    });
    return reply.send(line);
  });

  app.delete('/:installationId/cost-lines/:lineId', {
    schema: {
      tags: ['Field App Complete Finance'],
      summary: 'Delete a cost line',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId, lineId } = request.params as {
      installationId: string;
      lineId: string;
    };
    await deleteCostLine(request.user, installationId, lineId);
    return reply.status(204).send();
  });
}
