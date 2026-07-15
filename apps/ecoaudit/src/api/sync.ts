import { request } from '@/api/client';

export type PullResult = {
  audits: unknown[];
  zones: unknown[];
  mainSwitchboards: unknown[];
  additionalSwitchboards: unknown[];
  hvacUnits: unknown[];
  lightingSystems: unknown[];
  solarPv: unknown[];
  forkliftChargers: unknown[];
  hotWaterSystems: unknown[];
  generalWater: unknown[];
  generalElectricity: unknown[];
  pulledAt: string;
};

export function pullSync(since: string, auditId?: string): Promise<PullResult> {
  const params = new URLSearchParams({ since });
  if (auditId) params.set('auditId', auditId);
  return request<PullResult>('GET', `/v1/ecoaudit/sync/pull?${params}`);
}
