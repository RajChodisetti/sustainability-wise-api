import { type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { formatDate } from '@/modules/fleet/lib/format';
import {
  meterRegisterClassificationPresentation,
  meterRegisterRawSourceValue,
} from '@/modules/fleet/lib/meterRegisterList';
import type { FleetRegisterEvidence } from '@/modules/fleet/types/domain';

function DisplayValue({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-[var(--text)]">
        {empty ? 'Not recorded' : value}
      </dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-5 first:border-t-0 first:pt-0">
      <h4 className="text-sm font-extrabold text-[var(--text)]">{title}</h4>
      <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </dl>
    </section>
  );
}

function yesNo(value: boolean | null | undefined): string | null {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return null;
}

function money(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value / 100);
}

function sourceDeviceIdentifier(
  identifier: string | null | undefined,
  classification: Parameters<typeof meterRegisterClassificationPresentation>[0],
): string | null {
  if (!identifier) return null;
  return `${identifier} · ${meterRegisterClassificationPresentation(classification).label}`;
}

export function DeviceMeterRegisterDetails({
  evidence,
  isAdmin,
  onEdit,
}: {
  evidence: FleetRegisterEvidence;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const record = evidence.record;
  const details = record?.details;
  const effective = <T,>(recordValue: T | null | undefined, sourceValue: T | null | undefined) => (
    record ? recordValue : sourceValue
  );
  const rawEntries = Object.entries(evidence.sourcePayload ?? {});

  return (
    <article className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-extrabold text-[var(--text)]">
            {[evidence.sourceWorkbook, evidence.sourceSheet].filter(Boolean).join(' · ') || 'Imported Meter Register'}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
            Row {evidence.sourceRow ?? 'not recorded'} · {evidence.matchedRoles?.map((role) => role.charAt(0).toUpperCase() + role.slice(1)).join(', ') || 'Matched device'}
            {record ? ` · Mapped revision ${record.revision}` : ' · Needs mapping'}
          </p>
        </div>
        {isAdmin ? (
          <Button type="button" variant="secondary" className="!min-h-9 !px-3 !py-1.5 !text-xs" onClick={onEdit}>
            {record ? 'Edit all mapped fields' : 'Complete mapped fields'}
          </Button>
        ) : null}
      </div>

      <div className="space-y-6 p-5">
        <DetailSection title="Client, customer and site">
          <DisplayValue label="Client" value={record?.clientName ?? evidence.clientName ?? evidence.fleetAccountName} />
          <DisplayValue label="Customer" value={record?.customerName ?? evidence.customerName} />
          <DisplayValue label="Site name" value={record?.siteName ?? evidence.customerName} />
          <DisplayValue label="Site address" value={record?.siteAddress ?? evidence.siteAddress} />
          <DisplayValue label="State" value={record ? record.siteState : evidence.siteState} />
        </DetailSection>

        <DetailSection title="Device identifiers and source">
          <DisplayValue label="Existing device ID" value={sourceDeviceIdentifier(evidence.existingDeviceIdentifier, evidence.existingDeviceClassification)} />
          <DisplayValue label="New device ID" value={sourceDeviceIdentifier(evidence.newDeviceIdentifier, evidence.newDeviceClassification)} />
          <DisplayValue label="Current device ID" value={sourceDeviceIdentifier(evidence.currentDeviceIdentifier, evidence.currentDeviceClassification)} />
          <DisplayValue label="Source key" value={evidence.sourceKey} />
        </DetailSection>

        <DetailSection title="Work and meter details">
          <DisplayValue label="Status" value={effective(details?.status, evidence.status)} />
          <DisplayValue label="Service type" value={effective(details?.serviceType, evidence.serviceType)} />
          <DisplayValue label="Metering solution type" value={effective(details?.meteringSolutionType, evidence.meteringSolutionType)} />
          <DisplayValue label="Installation detail" value={details?.installationDetail} />
          <DisplayValue label="Meter type" value={effective(details?.meterType, evidence.meterType)} />
          <DisplayValue label="Fergus job number" value={effective(details?.fergusJobNumber, evidence.jobNumber)} />
          <DisplayValue label="Quote number" value={effective(details?.quoteNumber, evidence.quoteNumber)} />
          <DisplayValue label="Purchase order number" value={effective(details?.purchaseOrderNumber, evidence.purchaseOrderNumber)} />
          <DisplayValue label="Job completion date" value={formatDate(effective(details?.jobCompletionDate, evidence.jobCompletionDate))} />
          <DisplayValue label="Job completed by" value={effective(details?.jobCompletedBy, evidence.jobCompletedBy)} />
          <DisplayValue label="Hardware installed" value={effective(details?.hardwareInstalled, evidence.hardwareInstalled)} />
          <DisplayValue label="Wattwatchers product" value={effective(details?.productName, evidence.productName)} />
        </DetailSection>

        <DetailSection title="MaaS and data">
          <DisplayValue label="MaaS" value={yesNo(effective(details?.maas, evidence.maas))} />
          <DisplayValue label="MaaS start date" value={formatDate(effective(details?.maasStartDate, evidence.maasStartDate))} />
          <DisplayValue label="MaaS term" value={effective(details?.maasTerm, evidence.maasTerm)} />
          <DisplayValue label="MaaS reporting required" value={yesNo(effective(details?.maasReportingRequired, evidence.maasReportingRequired))} />
          <DisplayValue label="Data enabled" value={yesNo(effective(details?.dataEnabled, evidence.dataEnabled))} />
        </DetailSection>

        {isAdmin ? (
          <>
            <DetailSection title="Invoice values">
              <DisplayValue label="Xero invoice number" value={effective(details?.xeroInvoiceNumber, evidence.xeroInvoiceNumber)} />
              <DisplayValue label="Meter cost (ex GST)" value={money(effective(details?.meterCostExGstCents, evidence.meterCostExGstCents))} />
              <DisplayValue label="Recurring fee (ex GST)" value={money(effective(details?.meteringRecurringFeeExGstCents, evidence.meteringRecurringFeeExGstCents))} />
              <DisplayValue label="Other invoice costs (ex GST)" value={money(effective(details?.otherInvoiceCostsExGstCents, evidence.otherInvoiceCostsExGstCents))} />
              <DisplayValue label="Invoice amount (ex GST)" value={money(effective(details?.invoiceAmountExGstCents, evidence.invoiceAmountExGstCents))} />
              <DisplayValue label="Invoicing client contact" value={effective(details?.invoicingClientContact, evidence.invoicingClientContact)} />
            </DetailSection>

            <DetailSection title="Recurring invoice schedule">
              <DisplayValue label="Recurring fee purchase order" value={effective(details?.recurringFeePo, evidence.recurringFeePo)} />
              <DisplayValue label="Recurring start date" value={formatDate(effective(details?.recurringStartDate, evidence.recurringStartDate))} />
              <DisplayValue label="Recurring frequency" value={effective(details?.recurringFrequency, evidence.recurringFrequency)} />
              <DisplayValue label="Next invoice issue date" value={formatDate(effective(details?.recurringNextInvoiceIssueDate, evidence.recurringNextInvoiceIssueDate))} />
              <DisplayValue label="Invoice issued date" value={formatDate(effective(details?.invoiceIssuedDate, evidence.invoiceIssuedDate))} />
              <DisplayValue label="Billing period" value={effective(details?.billingPeriod, evidence.billingPeriod)} />
              <DisplayValue label="Issued-period next invoice date" value={formatDate(effective(details?.issuedPeriodNextInvoiceIssueDate, evidence.issuedPeriodNextInvoiceIssueDate))} />
            </DetailSection>

            <DetailSection title="Comments">
              <DisplayValue label="Comments" value={effective(details?.comments, evidence.comments)} />
            </DetailSection>

            <details className="border-t border-[var(--border)] pt-5">
              <summary className="cursor-pointer text-sm font-extrabold text-[var(--primary)]">
                Raw Excel columns{rawEntries.length ? ` (${rawEntries.length})` : ''}
              </summary>
              <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">Immutable cell evidence is retained exactly; edits update the mapped Fleet record above.</p>
              {rawEntries.length ? (
                <div className="mt-4 max-h-96 overflow-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                  <table className={tableClass}>
                    <caption className="sr-only">Exact values from every source Excel column</caption>
                    <thead><tr><th className={tableHeadClass} scope="col">Excel column</th><th className={tableHeadClass} scope="col">Raw cell value</th></tr></thead>
                    <tbody>
                      {rawEntries.map(([column, rawValue]) => {
                        const displayed = meterRegisterRawSourceValue(rawValue);
                        return (
                          <tr key={column}>
                            <th className={`${tableCellClass} min-w-56 text-left font-bold`} scope="row">{column}</th>
                            <td className={`${tableCellClass} min-w-80 whitespace-pre-wrap break-words font-mono text-xs`}>
                              {displayed || <span className="font-sans italic text-[var(--muted)]">Blank</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-3 text-sm text-[var(--text-sub)]">Raw Excel values are unavailable for this row.</p>}
            </details>
          </>
        ) : null}
      </div>
    </article>
  );
}
