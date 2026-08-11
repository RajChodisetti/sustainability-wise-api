import { installHubRequest, installHubRequestBlob } from '@/modules/installhub/api/client';
import type {
  Invoice,
  InvoiceListItem,
  QuickInvoiceInput,
  UpdateDraftInvoiceInput,
} from '@/modules/installhub/invoices/types';

const base = (installationId: string) =>
  `/v1/installhub/installations/${encodeURIComponent(installationId)}`;

export function listInvoices(installationId: string): Promise<{ items: InvoiceListItem[] }> {
  return installHubRequest<{ items: InvoiceListItem[] }>('GET', `${base(installationId)}/invoices`);
}

export function fetchInvoice(installationId: string, invoiceId: string): Promise<Invoice> {
  return installHubRequest<Invoice>(
    'GET',
    `${base(installationId)}/invoices/${encodeURIComponent(invoiceId)}`,
  );
}

export function quickCreateInvoice(
  installationId: string,
  input: QuickInvoiceInput = {},
): Promise<Invoice> {
  return installHubRequest<Invoice>('POST', `${base(installationId)}/invoices/quick`, input);
}

export function updateDraftInvoice(
  installationId: string,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<Invoice> {
  return installHubRequest<Invoice>(
    'PATCH',
    `${base(installationId)}/invoices/${encodeURIComponent(invoiceId)}`,
    input,
  );
}

export function issueInvoice(installationId: string, invoiceId: string): Promise<Invoice> {
  return installHubRequest<Invoice>(
    'POST',
    `${base(installationId)}/invoices/${encodeURIComponent(invoiceId)}/issue`,
  );
}

export function voidInvoice(installationId: string, invoiceId: string): Promise<Invoice> {
  return installHubRequest<Invoice>(
    'POST',
    `${base(installationId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
  );
}

export function downloadInvoicePdf(installationId: string, invoiceId: string): Promise<Blob> {
  return installHubRequestBlob(
    'GET',
    `${base(installationId)}/invoices/${encodeURIComponent(invoiceId)}/pdf`,
  );
}
