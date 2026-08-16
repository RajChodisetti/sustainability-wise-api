import type { FastifyInstance } from 'fastify';
import { installhubSyncRoutes } from './sync.js';
import { installhubUserRoutes } from './users.js';
import { installhubInstallationRoutes } from './installations.js';
import { installhubPdfRoutes } from './pdf.js';
import { installhubCanonicalRoutes } from './canonicalRoutes.js';
import { installhubFinanceRoutes } from './finance.js';
import { installhubInvoiceRoutes } from './invoices.js';

export async function installhubRoutes(app: FastifyInstance): Promise<void> {
  await app.register(installhubSyncRoutes, { prefix: '/sync' });
  await app.register(installhubUserRoutes, { prefix: '/users' });
  await app.register(installhubInstallationRoutes, {
    prefix: '/installations',
  });
  await app.register(installhubCanonicalRoutes, {
    prefix: '/installations',
  });
  await app.register(installhubFinanceRoutes, {
    prefix: '/installations',
  });
  await app.register(installhubInvoiceRoutes, {
    prefix: '/installations',
  });
  await app.register(installhubPdfRoutes);
}
