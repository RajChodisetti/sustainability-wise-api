import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, like, ne } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import {
  ihInstallations,
  ihInvoiceLines,
  ihInvoices,
  ihJobCostLines,
  ihJobFinance,
} from '../db/schema/installhub.js';
import { renderPdf } from '../pdf/renderer.js';
import { assertInstallationAccess } from '../routes/installhub/helpers.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { buildInvoiceHtml, type InvoicePdfModel } from './installHubInvoicePdf.js';

export type InvoiceStatus = 'draft' | 'issued' | 'void';
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
    siteName: string;
    clientName: string;
    siteAddress: string;
    status: string;
  };
  lines: InvoiceLineDto[];
};

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

function isElevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

function assertCanWriteInvoices(user: AuthUser): void {
  if (!isElevated(user)) {
    throw forbidden('Only administrators can manage invoices');
  }
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

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function lineToDto(row: typeof ihInvoiceLines.$inferSelect): InvoiceLineDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    sortOrder: row.sortOrder,
    description: row.description,
    quantity: row.quantity,
    unitAmountExGst: row.unitAmountExGst,
    lineTotalExGst: row.lineTotalExGst,
    costLineId: row.costLineId,
    category: (row.category as CostCategory | null) ?? null,
  };
}

function invoiceListItem(
  row: typeof ihInvoices.$inferSelect,
): InvoiceListItemDto {
  return {
    id: row.id,
    installationId: row.installationId,
    invoiceNumber: row.invoiceNumber,
    status: row.status as InvoiceStatus,
    currency: row.currency,
    issueDate: toIso(row.issueDate),
    dueDate: toIso(row.dueDate),
    subtotalExGst: row.subtotalExGst,
    gstAmount: row.gstAmount,
    totalIncGst: row.totalIncGst,
    gstRate: row.gstRate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadInstallationOrThrow(installationId: string) {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(eq(ihInstallations.id, installationId), isNull(ihInstallations.deletedAt)));
  if (!installation) throw notFound('Installation');
  return installation;
}

async function loadInvoiceOrThrow(installationId: string, invoiceId: string) {
  const [row] = await db
    .select()
    .from(ihInvoices)
    .where(and(eq(ihInvoices.id, invoiceId), eq(ihInvoices.installationId, installationId)));
  if (!row) throw notFound('Invoice');
  return row;
}

async function nextInvoiceNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const prefix = `INV-${year}-`;
  const [latest] = await db
    .select({ invoiceNumber: ihInvoices.invoiceNumber })
    .from(ihInvoices)
    .where(like(ihInvoices.invoiceNumber, `${prefix}%`))
    .orderBy(desc(ihInvoices.invoiceNumber))
    .limit(1);

  let seq = 1;
  if (latest?.invoiceNumber) {
    const m = /-(\d+)$/.exec(latest.invoiceNumber);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function ensureFinanceCurrency(installationId: string): Promise<string> {
  const [header] = await db
    .select()
    .from(ihJobFinance)
    .where(eq(ihJobFinance.installationId, installationId));
  if (header) return header.currency || 'AUD';
  await db.insert(ihJobFinance).values({
    installationId,
    pricingMode: 'charge_up',
    pricedAmount: null,
    currency: 'AUD',
    notes: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  });
  return 'AUD';
}

async function buildInvoiceDto(
  installation: typeof ihInstallations.$inferSelect,
  invoice: typeof ihInvoices.$inferSelect,
): Promise<InvoiceDto> {
  const lines = await db
    .select()
    .from(ihInvoiceLines)
    .where(eq(ihInvoiceLines.invoiceId, invoice.id))
    .orderBy(asc(ihInvoiceLines.sortOrder), asc(ihInvoiceLines.createdAt));

  return {
    ...invoiceListItem(invoice),
    notes: invoice.notes,
    sellerName: invoice.sellerName,
    sellerAbn: invoice.sellerAbn,
    sellerAddress: invoice.sellerAddress,
    sellerEmail: invoice.sellerEmail,
    createdByUserId: invoice.createdByUserId,
    issuedAt: toIso(invoice.issuedAt),
    voidedAt: toIso(invoice.voidedAt),
    installation: {
      siteName: installation.siteName,
      clientName: installation.clientName,
      siteAddress: installation.siteAddress,
      status: installation.status,
    },
    lines: lines.map(lineToDto),
  };
}

function sellerFromConfig() {
  const c = config.installhubInvoice;
  return {
    name: c.sellerName || 'Sustainability Wise',
    abn: c.sellerAbn || null,
    address: c.sellerAddress || null,
    email: c.sellerEmail || null,
  };
}

function toPdfModel(invoice: InvoiceDto): InvoicePdfModel {
  const fallback = sellerFromConfig();
  const seller = {
    name: invoice.sellerName || fallback.name,
    abn: invoice.sellerAbn ?? fallback.abn,
    address: invoice.sellerAddress ?? fallback.address,
    email: invoice.sellerEmail ?? fallback.email,
  };
  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    gstRate: invoice.gstRate,
    subtotalExGst: invoice.subtotalExGst,
    gstAmount: invoice.gstAmount,
    totalIncGst: invoice.totalIncGst,
    seller,
    billTo: {
      clientName: invoice.installation.clientName,
      siteName: invoice.installation.siteName,
      siteAddress: invoice.installation.siteAddress,
    },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitAmountExGst: l.unitAmountExGst,
      lineTotalExGst: l.lineTotalExGst,
    })),
  };
}

export async function listInvoices(
  user: AuthUser,
  installationId: string,
): Promise<InvoiceListItemDto[]> {
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);

  const rows = await db
    .select()
    .from(ihInvoices)
    .where(eq(ihInvoices.installationId, installationId))
    .orderBy(desc(ihInvoices.createdAt));

  return rows.map(invoiceListItem);
}

export async function getInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<InvoiceDto> {
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);
  const invoice = await loadInvoiceOrThrow(installationId, invoiceId);
  return buildInvoiceDto(installation, invoice);
}

export async function quickCreateInvoice(
  user: AuthUser,
  installationId: string,
  input: QuickInvoiceInput = {},
): Promise<InvoiceDto> {
  assertCanWriteInvoices(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);

  const allLines = await db
    .select()
    .from(ihJobCostLines)
    .where(eq(ihJobCostLines.installationId, installationId))
    .orderBy(asc(ihJobCostLines.createdAt));

  let selected = allLines.filter((l) => l.billable && !l.invoiced);
  if (input.costLineIds && input.costLineIds.length > 0) {
    const idSet = new Set(input.costLineIds);
    selected = allLines.filter((l) => idSet.has(l.id));
    if (selected.length !== input.costLineIds.length) {
      throw badRequest('One or more cost lines were not found on this installation');
    }
    const blocked = selected.filter((l) => !l.billable || l.invoiced);
    if (blocked.length) {
      throw badRequest('Selected cost lines must be billable and not already invoiced');
    }
  }

  if (!selected.length) {
    throw badRequest('No uninvoiced billable cost lines available for Quick Invoice');
  }

  const currency = await ensureFinanceCurrency(installationId);
  const gstRate = config.installhubInvoice.gstRate;
  const dueDays = config.installhubInvoice.dueDays;
  const now = new Date();
  const dueDate = new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000);
  const invoiceId = randomUUID();
  const invoiceNumber = await nextInvoiceNumber(now);

  const builtLines = selected.map((line, index) => {
    const amounts = costLineToInvoiceAmounts(line);
    return {
      id: randomUUID(),
      invoiceId,
      sortOrder: index,
      description: line.description.slice(0, 500),
      quantity: amounts.quantity,
      unitAmountExGst: amounts.unitAmountExGst,
      lineTotalExGst: amounts.lineTotalExGst,
      costLineId: line.id,
      category: line.category,
      createdAt: now,
    };
  });

  const totals = computeGstTotals(
    builtLines.map((l) => l.lineTotalExGst),
    gstRate,
  );
  const notes = input.notes === undefined ? null : (input.notes?.trim() || null);

  await db.insert(ihInvoices).values({
    id: invoiceId,
    installationId,
    invoiceNumber,
    status: 'draft',
    currency,
    issueDate: null,
    dueDate,
    subtotalExGst: totals.subtotalExGst,
    gstAmount: totals.gstAmount,
    totalIncGst: totals.totalIncGst,
    gstRate: totals.gstRate,
    notes,
    sellerName: null,
    sellerAbn: null,
    sellerAddress: null,
    sellerEmail: null,
    createdByUserId: user.userId,
    issuedAt: null,
    voidedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  if (builtLines.length) {
    await db.insert(ihInvoiceLines).values(builtLines);
  }

  const invoice = await loadInvoiceOrThrow(installationId, invoiceId);
  return buildInvoiceDto(installation, invoice);
}

export async function updateDraftInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
  input: UpdateDraftInput,
): Promise<InvoiceDto> {
  assertCanWriteInvoices(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);
  const existing = await loadInvoiceOrThrow(installationId, invoiceId);
  if (existing.status !== 'draft') {
    throw badRequest('Only draft invoices can be edited');
  }

  const patch: Partial<typeof ihInvoices.$inferInsert> = { updatedAt: new Date() };
  if (input.notes !== undefined) {
    patch.notes = input.notes?.trim() || null;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate === null || input.dueDate === '') {
      patch.dueDate = null;
    } else {
      const d = new Date(input.dueDate);
      if (Number.isNaN(d.getTime())) throw badRequest('dueDate must be a valid ISO datetime');
      patch.dueDate = d;
    }
  }

  await db.update(ihInvoices).set(patch).where(eq(ihInvoices.id, invoiceId));
  const updated = await loadInvoiceOrThrow(installationId, invoiceId);
  return buildInvoiceDto(installation, updated);
}

export async function issueInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<InvoiceDto> {
  assertCanWriteInvoices(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);
  const existing = await loadInvoiceOrThrow(installationId, invoiceId);
  if (existing.status !== 'draft') {
    throw badRequest('Only draft invoices can be issued');
  }

  const lines = await db
    .select()
    .from(ihInvoiceLines)
    .where(eq(ihInvoiceLines.invoiceId, invoiceId));
  if (!lines.length) throw badRequest('Invoice has no lines');

  const costLineIds = lines.map((l) => l.costLineId).filter((id): id is string => Boolean(id));
  if (costLineIds.length) {
    const costLines = await db
      .select()
      .from(ihJobCostLines)
      .where(and(
        eq(ihJobCostLines.installationId, installationId),
        inArray(ihJobCostLines.id, costLineIds),
      ));
    if (costLines.some((l) => l.invoiced)) {
      throw badRequest('One or more linked cost lines are already invoiced');
    }
  }

  const seller = sellerFromConfig();
  const now = new Date();
  const dueDays = config.installhubInvoice.dueDays;
  const dueDate = existing.dueDate ?? new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000);

  await db
    .update(ihInvoices)
    .set({
      status: 'issued',
      issueDate: now,
      dueDate,
      sellerName: seller.name,
      sellerAbn: seller.abn,
      sellerAddress: seller.address,
      sellerEmail: seller.email,
      issuedAt: now,
      updatedAt: now,
    })
    .where(eq(ihInvoices.id, invoiceId));

  if (costLineIds.length) {
    await db
      .update(ihJobCostLines)
      .set({ invoiced: true, updatedAt: now })
      .where(and(
        eq(ihJobCostLines.installationId, installationId),
        inArray(ihJobCostLines.id, costLineIds),
      ));
  }

  const updated = await loadInvoiceOrThrow(installationId, invoiceId);
  return buildInvoiceDto(installation, updated);
}

export async function voidInvoice(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<InvoiceDto> {
  assertCanWriteInvoices(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);
  const existing = await loadInvoiceOrThrow(installationId, invoiceId);
  if (existing.status === 'void') {
    throw badRequest('Invoice is already void');
  }
  if (existing.status !== 'issued' && existing.status !== 'draft') {
    throw badRequest('Invoice cannot be voided');
  }

  const now = new Date();
  const wasIssued = existing.status === 'issued';

  await db
    .update(ihInvoices)
    .set({
      status: 'void',
      voidedAt: now,
      updatedAt: now,
    })
    .where(eq(ihInvoices.id, invoiceId));

  if (wasIssued) {
    const lines = await db
      .select()
      .from(ihInvoiceLines)
      .where(eq(ihInvoiceLines.invoiceId, invoiceId));
    const costLineIds = lines.map((l) => l.costLineId).filter((id): id is string => Boolean(id));

    for (const costLineId of costLineIds) {
      const [stillReferenced] = await db
        .select({ id: ihInvoiceLines.id })
        .from(ihInvoiceLines)
        .innerJoin(ihInvoices, eq(ihInvoiceLines.invoiceId, ihInvoices.id))
        .where(and(
          eq(ihInvoiceLines.costLineId, costLineId),
          eq(ihInvoices.status, 'issued'),
          ne(ihInvoices.id, invoiceId),
        ))
        .limit(1);

      if (!stillReferenced) {
        await db
          .update(ihJobCostLines)
          .set({ invoiced: false, updatedAt: now })
          .where(and(
            eq(ihJobCostLines.id, costLineId),
            eq(ihJobCostLines.installationId, installationId),
          ));
      }
    }
  }

  const updated = await loadInvoiceOrThrow(installationId, invoiceId);
  return buildInvoiceDto(installation, updated);
}

export async function getInvoicePdf(
  user: AuthUser,
  installationId: string,
  invoiceId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const invoice = await getInvoice(user, installationId, invoiceId);
  if (invoice.status === 'void') {
    throw badRequest('Void invoices cannot be downloaded as PDF');
  }

  const html = buildInvoiceHtml(toPdfModel(invoice));
  const buffer = await renderPdf(html);
  const filename = `${invoice.invoiceNumber}.pdf`;
  return { filename, buffer };
}
