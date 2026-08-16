import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { notFound } from '../utils/errors.js';
import {
  createQuickSchedulerInvoiceByFinanceId,
  getSchedulerFinancialSummaryForSource,
  getSchedulerInvoiceByFinanceId,
  getSchedulerInvoicePdfByFinanceId,
  issueSchedulerInvoiceByFinanceId,
  listSchedulerInvoicesByFinanceId,
  updateSchedulerDraftInvoiceByFinanceId,
  voidSchedulerInvoiceByFinanceId,
  type SchedulerInvoiceDto,
  type SchedulerInvoiceLineDto,
  type SchedulerInvoiceListItemDto,
} from './schedulerFinanceService.js';

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';
export type CostCategory = 'labour' | 'material' | 'other';

export type InvoiceLineDto = {
  id: string;
  invoiceId: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
  costLineId: string | null;
  category: CostCategory | null;
};

export type InvoiceListItemDto = {
  id: string;
  installationId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  gstRate: number;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceDto = InvoiceListItemDto & {
  notes: string | null;
  sellerName: string | null;
  sellerAbn: string | null;
  sellerAddress: string | null;
  sellerEmail: string | null;
  createdByUserId: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  installation: {
    id: string;
    auditDate: string;
    siteName: string;
    clientName: string;
    siteAddress: string;
    status: string;
  };
  lines: InvoiceLineDto[];
};

function sharedLineToLegacy(line: SchedulerInvoiceLineDto): InvoiceLineDto {
  return {
    id: line.id,
    invoiceId: line.invoiceId,
    sortOrder: line.sortOrder,
    description: line.description,
    quantity: line.quantity,
    unitAmountExGst: line.unitAmountExGst,
    lineTotalExGst: line.lineTotalExGst,
    costLineId: line.expenseId,
    category: line.kind === 'labour' || line.kind === 'quoted'
      ? 'labour'
      : line.category === 'materials'
        ? 'material'
        : line.category ? 'other' : null,
  };
}

function sharedListToLegacy(
  row: SchedulerInvoiceListItemDto,
  installationId: string,
): InvoiceListItemDto {
  return {
    id: row.id,
    installationId,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    currency: row.currency,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    subtotalExGst: row.subtotalExGst,
    gstAmount: row.gstAmount,
    totalIncGst: row.totalIncGst,
    gstRate: row.gstRate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sharedInvoiceToLegacy(row: SchedulerInvoiceDto): InvoiceDto {
  return {
    ...sharedListToLegacy(row, row.job.sourceId),
    notes: row.notes,
    sellerName: row.sellerName,
    sellerAbn: row.sellerAbn,
    sellerAddress: row.sellerAddress,
    sellerEmail: row.sellerEmail,
    createdByUserId: row.createdByUserId,
    issuedAt: row.issuedAt,
    voidedAt: row.voidedAt,
    installation: {
      id: row.job.sourceId,
      auditDate: row.job.jobDate,
      siteName: row.job.siteName,
      clientName: row.job.clientName ?? row.billToName,
      siteAddress: row.job.siteAddress ?? '',
      status: row.job.status,
    },
    lines: row.lines.map(sharedLineToLegacy),
  };
}

function assertLegacySingleJobInvoice(row: SchedulerInvoiceDto): SchedulerInvoiceDto {
  if (
    row.jobCount !== 1
    || row.job.sourceApp !== 'installhub'
    || row.job.sourceType !== 'installation'
  ) throw notFound('Invoice');
  return row;
}

async function sharedFinanceId(user: AuthUser, installationId: string): Promise<string> {
  const summary = await getSchedulerFinancialSummaryForSource(user, {
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: installationId,
  });
  return summary.financeId;
}

export type QuickInvoiceInput = {
  costLineIds?: string[];
  notes?: string | null;
};

export type UpdateDraftInput = {
  notes?: string | null;
  dueDate?: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function effectiveSell(line: {
  billable: boolean;
  costAmount: number;
  sellAmount: number | null;
}): number {
  if (!line.billable) return 0;
  if (line.sellAmount != null && Number.isFinite(line.sellAmount)) return line.sellAmount;
  return line.costAmount;
}

/** Map a cost line into invoice qty + unit (ex GST). Sell amounts are treated as line totals. */
export function costLineToInvoiceAmounts(line: {
  hours: number | null;
  costAmount: number;
  sellAmount: number | null;
  billable: boolean;
}): { quantity: number; unitAmountExGst: number; lineTotalExGst: number } {
  const total = round2(effectiveSell(line));
  const hours = line.hours != null && Number.isFinite(line.hours) && line.hours > 0
    ? line.hours
    : null;
  if (hours != null) {
    const quantity = round2(hours);
    const unitAmountExGst = quantity > 0 ? round2(total / quantity) : total;
    return {
      quantity,
      unitAmountExGst,
      lineTotalExGst: round2(quantity * unitAmountExGst),
    };
  }
  return { quantity: 1, unitAmountExGst: total, lineTotalExGst: total };
}

export function computeGstTotals(
  lineTotalsExGst: number[],
  gstRate = config.installhubInvoice.gstRate,
): { subtotalExGst: number; gstAmount: number; totalIncGst: number; gstRate: number } {
  const rate = Math.max(0, gstRate);
  const subtotalExGst = round2(lineTotalsExGst.reduce((s, n) => s + n, 0));
  const gstAmount = round2(subtotalExGst * rate);
  const totalIncGst = round2(subtotalExGst + gstAmount);
  return { subtotalExGst, gstAmount, totalIncGst, gstRate: rate };
}

export async function listInvoices(
  user: AuthUser,
  installationId: string,
): Promise<InvoiceListItemDto[]> {
  const financeId = await sharedFinanceId(user, installationId);
  return (await listSchedulerInvoicesByFinanceId(user, financeId))
    .filter((row) => row.jobCount === 1 && row.sourceApps[0] === 'installhub')
    .map((row) => sharedListToLegacy(row, installationId));
}

export async function getInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<InvoiceDto> {
  const financeId = await sharedFinanceId(user, installationId);
  return sharedInvoiceToLegacy(assertLegacySingleJobInvoice(
    await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId),
  ));
}

export async function quickCreateInvoice(
  user: AuthUser,
  installationId: string,
  input: QuickInvoiceInput = {},
): Promise<InvoiceDto> {
  const financeId = await sharedFinanceId(user, installationId);
  const invoice = await createQuickSchedulerInvoiceByFinanceId(user, financeId, {
    expenseIds: input.costLineIds,
    includeLabour: true,
    notes: input.notes,
  });
  return sharedInvoiceToLegacy(invoice);
}

export async function updateDraftInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
  input: UpdateDraftInput,
): Promise<InvoiceDto> {
  const financeId = await sharedFinanceId(user, installationId);
  assertLegacySingleJobInvoice(await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId));
  return sharedInvoiceToLegacy(await updateSchedulerDraftInvoiceByFinanceId(
    user,
    financeId,
    invoiceId,
    input,
  ));
}

export async function issueInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<InvoiceDto> {
  const financeId = await sharedFinanceId(user, installationId);
  assertLegacySingleJobInvoice(await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId));
  return sharedInvoiceToLegacy(await issueSchedulerInvoiceByFinanceId(
    user,
    financeId,
    invoiceId,
  ));
}

export async function voidInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<InvoiceDto> {
  const financeId = await sharedFinanceId(user, installationId);
  assertLegacySingleJobInvoice(await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId));
  return sharedInvoiceToLegacy(await voidSchedulerInvoiceByFinanceId(
    user,
    financeId,
    invoiceId,
  ));
}

export async function getInvoicePdf(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<{ filename: string; contentDisposition: string; buffer: Buffer }> {
  const financeId = await sharedFinanceId(user, installationId);
  assertLegacySingleJobInvoice(await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId));
  return getSchedulerInvoicePdfByFinanceId(user, financeId, invoiceId);
}
