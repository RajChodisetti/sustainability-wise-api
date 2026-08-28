import type { FastifyInstance } from 'fastify';
import { eaUserRoutes } from './users.js';
import { eaAuditRoutes } from './audits.js';
import { eaZoneRoutes } from './zones.js';
import { eaPhotoRoutes } from './photos.js';
import { eaSyncRoutes } from './sync.js';
import { eaPdfRoutes } from './pdf.js';
import {
  eaMainSwitchboardRoutes, eaAdditionalSwitchboardRoutes, eaHvacUnitRoutes,
  eaLightingSystemRoutes, eaSolarPvRoutes, eaForkliftChargerRoutes,
  eaHotWaterSystemRoutes, eaGeneralWaterRoutes, eaGeneralElectricityRoutes,
} from './equipment/index.js';
import { productClientDirectoryRoutes } from '../clientDirectory.js';

export async function ecoauditRoutes(app: FastifyInstance): Promise<void> {
  await app.register(productClientDirectoryRoutes('ecoaudit'));
  await app.register(eaUserRoutes,               { prefix: '/users' });
  await app.register(eaAuditRoutes,              { prefix: '/audits' });
  await app.register(eaZoneRoutes,               { prefix: '/' });
  await app.register(eaPhotoRoutes,              { prefix: '/' });
  await app.register(eaSyncRoutes,               { prefix: '/sync' });
  await app.register(eaPdfRoutes,                { prefix: '/' });
  await app.register(eaMainSwitchboardRoutes,    { prefix: '/' });
  await app.register(eaAdditionalSwitchboardRoutes, { prefix: '/' });
  await app.register(eaHvacUnitRoutes,           { prefix: '/' });
  await app.register(eaLightingSystemRoutes,     { prefix: '/' });
  await app.register(eaSolarPvRoutes,            { prefix: '/' });
  await app.register(eaForkliftChargerRoutes,    { prefix: '/' });
  await app.register(eaHotWaterSystemRoutes,     { prefix: '/' });
  await app.register(eaGeneralWaterRoutes,       { prefix: '/' });
  await app.register(eaGeneralElectricityRoutes, { prefix: '/' });
}
