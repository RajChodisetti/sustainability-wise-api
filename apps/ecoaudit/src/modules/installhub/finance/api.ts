import { installHubRequest, installHubRequestBlob } from '@/modules/installhub/api/client';
import type {
  CostLine,
  CostLineInput,
  FinanceHeader,
  FinancialSummary,
  UpsertFinanceHeaderInput,
} from '@/modules/installhub/finance/types';

const base = (installationId: string) =>
  `/v1/installhub/installations/${encodeURIComponent(installationId)}`;

export function fetchFinancialSummary(installationId: string): Promise<FinancialSummary> {
  return installHubRequest<FinancialSummary>('GET', `${base(installationId)}/financial-summary`);
}

export function upsertFinanceHeader(
  installationId: string,
  input: UpsertFinanceHeaderInput,
): Promise<FinanceHeader> {
  return installHubRequest<FinanceHeader>('PUT', `${base(installationId)}/finance`, input);
}

export function createCostLine(
  installationId: string,
  input: CostLineInput,
): Promise<CostLine> {
  return installHubRequest<CostLine>('POST', `${base(installationId)}/cost-lines`, input);
}

export function updateCostLine(
  installationId: string,
  lineId: string,
  input: Partial<CostLineInput>,
): Promise<CostLine> {
  return installHubRequest<CostLine>(
    'PATCH',
    `${base(installationId)}/cost-lines/${encodeURIComponent(lineId)}`,
    input,
  );
}

export function deleteCostLine(installationId: string, lineId: string): Promise<void> {
  return installHubRequest<void>(
    'DELETE',
    `${base(installationId)}/cost-lines/${encodeURIComponent(lineId)}`,
  );
}

export async function downloadFinancialSummaryCsv(installationId: string): Promise<Blob> {
  return installHubRequestBlob('GET', `${base(installationId)}/financial-summary.csv`);
}
