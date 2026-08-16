export type InvoiceStatus = 'draft' | 'issued' | 'void';
export type CostCategory = 'labour' | 'material' | 'other';

export type InvoiceLine = {
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

export type InvoiceListItem = {
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

export type Invoice = InvoiceListItem & {
  notes: string | null;
  sellerName: string | null;
  sellerAbn: string | null;
  sellerAddress: string | null;
  sellerEmail: string | null;
  createdByUserId: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  installation: {
    auditDate: string;
    siteName: string;
    clientName: string;
    siteAddress: string;
    status: string;
  };
  lines: InvoiceLine[];
};

export type QuickInvoiceInput = {
  costLineIds?: string[];
  notes?: string | null;
};

export type UpdateDraftInvoiceInput = {
  notes?: string | null;
  dueDate?: string | null;
};
