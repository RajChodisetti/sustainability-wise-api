import type { FastifyInstance } from 'fastify';
import { wattwatchersIngestRoutes } from './ingest.js';
import { wattwatchersReadRoutes } from './read.js';
import { wattwatchersUserRoutes } from './users.js';
import { wattwatchersClientAdminRoutes } from './clients.js';
import { wattwatchersTopologyBetaRoutes } from './topologyBeta.js';
import { wattwatchersMeterRegisterRoutes } from './meterRegister.js';

export async function wattwatchersRoutes(app: FastifyInstance): Promise<void> {
  await app.register(wattwatchersUserRoutes, { prefix: '/users' });
  await app.register(wattwatchersReadRoutes);
  await app.register(wattwatchersClientAdminRoutes, { prefix: '/clients' });
  await app.register(wattwatchersTopologyBetaRoutes, { prefix: '/topology-beta' });
  await app.register(wattwatchersMeterRegisterRoutes, { prefix: '/meter-register' });
  await app.register(wattwatchersIngestRoutes, { prefix: '/ingest' });
}
