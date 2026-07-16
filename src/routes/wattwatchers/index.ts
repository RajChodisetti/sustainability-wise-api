import type { FastifyInstance } from 'fastify';
import { wattwatchersIngestRoutes } from './ingest.js';
import { wattwatchersReadRoutes } from './read.js';
import { wattwatchersUserRoutes } from './users.js';

export async function wattwatchersRoutes(app: FastifyInstance): Promise<void> {
  await app.register(wattwatchersUserRoutes, { prefix: '/users' });
  await app.register(wattwatchersReadRoutes);
  await app.register(wattwatchersIngestRoutes, { prefix: '/ingest' });
}
