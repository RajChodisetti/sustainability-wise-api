import type { FastifyInstance } from 'fastify';
import { solarsenseAssessmentRoutes } from './assessments.js';
import { solarsensePdfRoutes } from './pdf.js';
import { solarsensePhotoRoutes } from './photos.js';
import { solarsenseSiteRoutes } from './sites.js';
import { solarsenseSyncRoutes } from './sync.js';
import { solarsenseUserRoutes } from './users.js';
import { productClientDirectoryRoutes } from '../clientDirectory.js';

export async function solarsenseRoutes(app: FastifyInstance): Promise<void> {
  await app.register(productClientDirectoryRoutes('solarsense'));
  await app.register(solarsenseUserRoutes, { prefix: '/users' });
  await app.register(solarsenseSiteRoutes, { prefix: '/sites' });
  await app.register(solarsenseAssessmentRoutes);
  await app.register(solarsensePhotoRoutes);
  await app.register(solarsenseSyncRoutes, { prefix: '/sync' });
  await app.register(solarsensePdfRoutes);
}
