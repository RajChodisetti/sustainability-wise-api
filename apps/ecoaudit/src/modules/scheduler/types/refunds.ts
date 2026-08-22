export type SchedulerInvoiceRefundStatus = 'posted' | 'voided';

export type SchedulerInvoiceRefund = {
  id: string;
  invoiceId: string;
  idempotencyKey: string;
  status: SchedulerInvoiceRefundStatus;
  currency: string;
  amountExGst: number;
  gstAmount: number;
  totalIncGst: number;
  refundedAt: string;
  reason: string;
  externalReference: string | null;
  createdByUserId: string;
  createdByDisplayName: string | null;
  voidedByUserId: string | null;
  voidedByDisplayName: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostSchedulerInvoiceRefundInput = {
  idempotencyKey: string;
  expectedUpdatedAt: string;
  amountExGst: number;
  gstAmount: number;
  refundedAt?: string | null;
  reason: string;
  externalReference?: string | null;
};
