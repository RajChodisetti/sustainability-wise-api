'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner } from '@/components/ui/Card';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  Textarea,
} from '@/components/ui/FormFields';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { useUpdateFleetMeterRegisterEntry } from '@/modules/fleet/hooks/useFleet';
import {
  meterRegisterEditInitialValues,
  normalizeMeterRegisterEdit,
  type MeterRegisterEditErrors,
  type MeterRegisterEditFormValues,
} from '@/modules/fleet/lib/meterRegisterEdit';
import {
  meterRegisterClassificationPresentation,
  meterRegisterRawSourceValue,
} from '@/modules/fleet/lib/meterRegisterList';
import {
  tableCellClass,
  tableClass,
  tableHeadClass,
} from '@/modules/fleet/components/Table';
import {
  FLEET_AU_STATES,
  type FleetRegisterEvidence,
} from '@/modules/fleet/types/domain';

type EditableField = Exclude<keyof MeterRegisterEditFormValues, 'revision'>;

function SourceValue({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-[var(--text)]">
        {value?.trim() || 'Not recorded'}
      </dd>
    </div>
  );
}

function sourceBoolean(value: boolean | null | undefined): string | null {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return null;
}

function sourceMoney(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(value / 100);
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-base font-extrabold tracking-[-0.015em] text-[var(--text)]">{title}</h3>
      {description ? <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{description}</p> : null}
      <div className="mt-1 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export function MeterRegisterEditDialog({
  deviceId,
  evidence,
  onClose,
}: {
  deviceId?: string;
  evidence: FleetRegisterEvidence;
  onClose: () => void;
}) {
  const { wwUser } = usePortalAuth();
  const mutation = useUpdateFleetMeterRegisterEntry(deviceId);
  const [values, setValues] = useState(() => meterRegisterEditInitialValues(evidence));
  const [errors, setErrors] = useState<MeterRegisterEditErrors>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(mutation.isPending);
  const sourceClientName = evidence.clientName ?? evidence.fleetAccountName;
  const rawSourceEntries = Object.entries(evidence.sourcePayload ?? {});

  useEffect(() => {
    pendingRef.current = mutation.isPending;
  }, [mutation.isPending]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pendingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(overlayRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.hidden);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  if (wwUser?.role !== 'admin') return null;

  function setField(field: EditableField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function renderInput(
    field: EditableField,
    label: string,
    options: InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) {
    const id = `meter-register-${evidence.id}-${field}`;
    return (
      <div className={options.className?.includes('sm:col-span') ? options.className : ''}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          {...options}
          id={id}
          className=""
          value={String(values[field])}
          aria-invalid={Boolean(errors[field])}
          aria-describedby={errors[field] ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(event) => setField(field, event.target.value)}
        />
        <FieldError id={`${id}-error`} message={errors[field]} />
        {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
      </div>
    );
  }

  function renderTriState(field: 'maas' | 'maasReportingRequired' | 'dataEnabled', label: string) {
    const id = `meter-register-${evidence.id}-${field}`;
    return (
      <div>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select id={id} value={values[field]} onChange={(event) => setField(field, event.target.value)}>
          <option value="">Not recorded</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeMeterRegisterEdit(values);
    setErrors(normalized.errors);
    if (!normalized.ok) return;
    try {
      await mutation.mutateAsync({
        entryId: evidence.id,
        input: normalized.input,
        previousBusinessClientId: evidence.record?.businessClientId,
        previousBusinessSiteId: evidence.record?.businessSiteId,
      });
      onClose();
    } catch {
      // The authenticated API client's error is rendered below the form.
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !mutation.isPending) onClose();
      }}
    >
      <Card
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden !p-0 sm:max-h-[calc(100vh-2.5rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meter-register-edit-title"
        aria-describedby="meter-register-edit-description"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div>
            <h2 id="meter-register-edit-title" className="text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">
              Edit Meter Register details
            </h2>
            <p id="meter-register-edit-description" className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              Complete the mapped client, customer, site and operational fields. Optional fields can be cleared.
            </p>
          </div>
          <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={onClose} aria-label="Close Meter Register editor">
            Close
          </Button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          <section className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] p-4">
            <h3 className="text-sm font-extrabold text-[var(--text)]">Immutable Excel source</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
              These source values and device identifiers remain unchanged. Saving creates or updates the mapped record used by Fleet.
            </p>
            <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <SourceValue label="Workbook / sheet" value={[evidence.sourceWorkbook, evidence.sourceSheet].filter(Boolean).join(' · ')} />
              <SourceValue label="Source row" value={evidence.sourceRow ? String(evidence.sourceRow) : null} />
              <SourceValue label="Source client" value={sourceClientName} />
              <SourceValue label="Source customer" value={evidence.customerName} />
              <SourceValue label="Source site address" value={evidence.siteAddress} />
              <SourceValue label="Source state" value={evidence.siteState} />
              <SourceValue
                label="Existing device ID"
                value={evidence.existingDeviceIdentifier
                  ? `${evidence.existingDeviceIdentifier} · ${meterRegisterClassificationPresentation(evidence.existingDeviceClassification).label}`
                  : null}
              />
              <SourceValue
                label="New device ID"
                value={evidence.newDeviceIdentifier
                  ? `${evidence.newDeviceIdentifier} · ${meterRegisterClassificationPresentation(evidence.newDeviceClassification).label}`
                  : null}
              />
              <SourceValue
                label="Current device ID"
                value={evidence.currentDeviceIdentifier
                  ? `${evidence.currentDeviceIdentifier} · ${meterRegisterClassificationPresentation(evidence.currentDeviceClassification).label}`
                  : null}
              />
            </dl>
            <details className="mt-4 border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer text-sm font-bold text-[var(--primary)]">View normalized imported fields</summary>
              <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <SourceValue label="Status" value={evidence.status} />
                <SourceValue label="Service type" value={evidence.serviceType} />
                <SourceValue label="Metering solution type" value={evidence.meteringSolutionType} />
                <SourceValue label="Meter type" value={evidence.meterType} />
                <SourceValue label="Fergus job number" value={evidence.jobNumber} />
                <SourceValue label="Quote number" value={evidence.quoteNumber} />
                <SourceValue label="Purchase order number" value={evidence.purchaseOrderNumber} />
                <SourceValue label="Job completion date" value={evidence.jobCompletionDate} />
                <SourceValue label="Job completed by" value={evidence.jobCompletedBy} />
                <SourceValue label="Hardware installed" value={evidence.hardwareInstalled} />
                <SourceValue label="MaaS" value={sourceBoolean(evidence.maas)} />
                <SourceValue label="MaaS start date" value={evidence.maasStartDate} />
                <SourceValue label="MaaS term" value={evidence.maasTerm} />
                <SourceValue label="MaaS reporting required" value={sourceBoolean(evidence.maasReportingRequired)} />
                <SourceValue label="Data enabled" value={sourceBoolean(evidence.dataEnabled)} />
                <SourceValue label="Wattwatchers product" value={evidence.productName} />
                <SourceValue label="Xero invoice number" value={evidence.xeroInvoiceNumber} />
                <SourceValue label="Meter cost (ex GST)" value={sourceMoney(evidence.meterCostExGstCents)} />
                <SourceValue label="Recurring fee (ex GST)" value={sourceMoney(evidence.meteringRecurringFeeExGstCents)} />
                <SourceValue label="Other invoice costs (ex GST)" value={sourceMoney(evidence.otherInvoiceCostsExGstCents)} />
                <SourceValue label="Invoice amount (ex GST)" value={sourceMoney(evidence.invoiceAmountExGstCents)} />
                <SourceValue label="Recurring fee PO" value={evidence.recurringFeePo} />
                <SourceValue label="Invoicing client contact" value={evidence.invoicingClientContact} />
                <SourceValue label="Comments" value={evidence.comments} />
                <SourceValue label="Recurring start date" value={evidence.recurringStartDate} />
                <SourceValue label="Recurring frequency" value={evidence.recurringFrequency} />
                <SourceValue label="Next invoice issue date" value={evidence.recurringNextInvoiceIssueDate} />
                <SourceValue label="Invoice issued date" value={evidence.invoiceIssuedDate} />
                <SourceValue label="Billing period" value={evidence.billingPeriod} />
                <SourceValue label="Issued-period next invoice date" value={evidence.issuedPeriodNextInvoiceIssueDate} />
              </dl>
            </details>
            <details className="mt-4 border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer text-sm font-bold text-[var(--primary)]">
                View raw Excel values{rawSourceEntries.length ? ` (${rawSourceEntries.length} columns)` : ''}
              </summary>
              <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">
                Exact cell values are shown before date, currency or identifier parsing.
              </p>
              {rawSourceEntries.length ? (
                <div className="mt-3 max-h-96 overflow-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
                  <table className={tableClass}>
                    <caption className="sr-only">Exact values from every source Excel column</caption>
                    <thead>
                      <tr>
                        <th className={tableHeadClass} scope="col">Excel column</th>
                        <th className={tableHeadClass} scope="col">Raw cell value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rawSourceEntries.map(([column, rawValue]) => {
                        const displayedValue = meterRegisterRawSourceValue(rawValue);
                        return (
                          <tr key={column}>
                            <th className={`${tableCellClass} min-w-56 text-left font-bold`} scope="row">{column}</th>
                            <td className={`${tableCellClass} min-w-80 whitespace-pre-wrap break-words font-mono text-xs`}>
                              {displayedValue || <span className="font-sans italic text-[var(--muted)]">Blank</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--text-sub)]">Raw Excel values are unavailable for this row.</p>
              )}
            </details>
          </section>

          <form className="mt-6 space-y-7" noValidate onSubmit={(event) => void submit(event)}>
            <FormSection
              title="Client, customer and site"
              description="These fields create the canonical Fleet placement. Use NA only when the value is genuinely unknown."
            >
              {renderInput('clientName', 'Client name', { maxLength: 300, required: true, autoFocus: true })}
              {renderInput('customerName', 'Customer name', { maxLength: 300, required: true })}
              {renderInput('siteName', 'Site name', { maxLength: 300, required: true })}
              {renderInput('siteAddress', 'Site address', { maxLength: 1000, required: true })}
              <div>
                <FieldLabel htmlFor={`meter-register-${evidence.id}-siteState`}>State</FieldLabel>
                <Select
                  id={`meter-register-${evidence.id}-siteState`}
                  value={values.siteState}
                  onChange={(event) => setField('siteState', event.target.value)}
                >
                  <option value="">Not recorded</option>
                  {FLEET_AU_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </Select>
              </div>
            </FormSection>

            <FormSection title="Work and meter details">
              {renderInput('status', 'Status', { maxLength: 300 })}
              {renderInput('serviceType', 'Service type', { maxLength: 300 })}
              {renderInput('meteringSolutionType', 'Metering solution type', { maxLength: 300 })}
              {renderInput('installationDetail', 'Installation detail', { maxLength: 300 })}
              {renderInput('meterType', 'Meter type', { maxLength: 300 })}
              {renderInput('fergusJobNumber', 'Fergus job number', { maxLength: 300 })}
              {renderInput('quoteNumber', 'Quote number', { maxLength: 300 })}
              {renderInput('purchaseOrderNumber', 'Purchase order number', { maxLength: 300 })}
              {renderInput('jobCompletionDate', 'Job completion date', { type: 'date' })}
              {renderInput('jobCompletedBy', 'Job completed by', { maxLength: 300 })}
              {renderInput('hardwareInstalled', 'Hardware installed', { maxLength: 300 })}
              {renderInput('productName', 'Wattwatchers product name', { maxLength: 300 })}
            </FormSection>

            <FormSection title="MaaS and data">
              {renderTriState('maas', 'MaaS')}
              {renderInput('maasStartDate', 'MaaS start date', { type: 'date' })}
              {renderInput('maasTerm', 'MaaS term', { maxLength: 300 })}
              {renderTriState('maasReportingRequired', 'MaaS reporting required')}
              {renderTriState('dataEnabled', 'Data enabled')}
            </FormSection>

            <FormSection title="Invoice values" description="Enter Australian dollar amounts; they are saved as exact cents.">
              {renderInput('xeroInvoiceNumber', 'Xero invoice number', { maxLength: 300 })}
              {renderInput('meterCostExGst', 'Meter cost (ex GST, AUD)', { type: 'number', step: '0.01', inputMode: 'decimal' })}
              {renderInput('meteringRecurringFeeExGst', 'Metering recurring fee (ex GST, AUD)', { type: 'number', step: '0.01', inputMode: 'decimal' })}
              {renderInput('otherInvoiceCostsExGst', 'Other invoice costs (ex GST, AUD)', { type: 'number', step: '0.01', inputMode: 'decimal' })}
              {renderInput('invoiceAmountExGst', 'Invoice amount (ex GST, AUD)', { type: 'number', step: '0.01', inputMode: 'decimal' })}
              {renderInput('invoicingClientContact', 'Invoicing client contact', { maxLength: 500 })}
            </FormSection>

            <FormSection title="Recurring invoice schedule">
              {renderInput('recurringFeePo', 'Recurring fee purchase order', { maxLength: 300 })}
              {renderInput('recurringStartDate', 'Recurring start date', { type: 'date' })}
              {renderInput('recurringFrequency', 'Recurring frequency', { maxLength: 300 })}
              {renderInput('recurringNextInvoiceIssueDate', 'Next invoice issue date', { type: 'date' })}
              {renderInput('invoiceIssuedDate', 'Invoice issued date', { type: 'date' })}
              {renderInput('billingPeriod', 'Billing period', { maxLength: 300 })}
              {renderInput('issuedPeriodNextInvoiceIssueDate', 'Issued-period next invoice date', { type: 'date' })}
            </FormSection>

            <section className="border-t border-[var(--border)] pt-6">
              <h3 className="text-base font-extrabold tracking-[-0.015em] text-[var(--text)]">Comments</h3>
              <FieldLabel htmlFor={`meter-register-${evidence.id}-comments`}>Comments</FieldLabel>
              <Textarea
                id={`meter-register-${evidence.id}-comments`}
                maxLength={2000}
                value={values.comments}
                onChange={(event) => setField('comments', event.target.value)}
              />
            </section>

            {mutation.error ? <ErrorBanner message={fleetConnectionErrorMessage(mutation.error)} /> : null}

            <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
              <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : evidence.record ? 'Save changes' : 'Create mapped record'}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
