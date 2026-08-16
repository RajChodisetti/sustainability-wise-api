import type { FastifyInstance } from 'fastify';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  getInvoice,
  getInvoicePdf,
  issueInvoice,
  listInvoices,
  quickCreateInvoice,
  updateDraftInvoice,
  voidInvoice,
} from '../../services/installHubInvoiceService.js';

export async function installhubInvoiceRoutes(app: FastifyInstance): Promise<void> {
  const readGate = [authenticate, requireApp('installhub'), requireRole('admin')] as const;
  const writeGate = [authenticate, requireApp('installhub'), requireRole('admin')] as const;

  app.get('/:installationId/invoices', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'List invoices for an installation',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...readGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const items = await listInvoices(request.user, installationId);
    return reply.send({ items });
  });

  app.post('/:installationId/invoices/quick', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'Quick-create a draft invoice from uninvoiced billable cost lines',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = (request.body ?? {}) as {
      costLineIds?: string[];
      notes?: string | null;
    };
    const invoice = await quickCreateInvoice(request.user, installationId, {
      costLineIds: Array.isArray(body.costLineIds) ? body.costLineIds : undefined,
      notes: body.notes,
    });
    return reply.code(201).send(invoice);
  });

  app.get('/:installationId/invoices/:invoiceId', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'Get invoice detail',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...readGate],
  }, async (request, reply) => {
    const { installationId, invoiceId } = request.params as {
      installationId: string;
      invoiceId: string;
    };
    const invoice = await getInvoice(request.user, installationId, invoiceId);
    return reply.send(invoice);
  });

  app.patch('/:installationId/invoices/:invoiceId', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'Update a draft invoice (notes / due date)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId, invoiceId } = request.params as {
      installationId: string;
      invoiceId: string;
    };
    const body = (request.body ?? {}) as {
      notes?: string | null;
      dueDate?: string | null;
    };
    const invoice = await updateDraftInvoice(request.user, installationId, invoiceId, body);
    return reply.send(invoice);
  });

  app.post('/:installationId/invoices/:invoiceId/issue', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'Issue a draft invoice and mark linked cost lines invoiced',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId, invoiceId } = request.params as {
      installationId: string;
      invoiceId: string;
    };
    const invoice = await issueInvoice(request.user, installationId, invoiceId);
    return reply.send(invoice);
  });

  app.post('/:installationId/invoices/:invoiceId/void', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'Void an invoice and reverse cost-line invoiced flags when safe',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...writeGate],
  }, async (request, reply) => {
    const { installationId, invoiceId } = request.params as {
      installationId: string;
      invoiceId: string;
    };
    const invoice = await voidInvoice(request.user, installationId, invoiceId);
    return reply.send(invoice);
  });

  app.get('/:installationId/invoices/:invoiceId/pdf', {
    schema: {
      tags: ['Field App Complete Invoices'],
      summary: 'Download invoice PDF (tax invoice with GST)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [...readGate],
  }, async (request, reply) => {
    const { installationId, invoiceId } = request.params as {
      installationId: string;
      invoiceId: string;
    };
    const { contentDisposition, buffer } = await getInvoicePdf(
      request.user,
      installationId,
      invoiceId,
    );
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', contentDisposition)
      .send(buffer);
  });
}
