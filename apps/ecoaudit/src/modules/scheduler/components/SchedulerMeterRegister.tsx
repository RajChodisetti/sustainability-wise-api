'use client';

import { useDeferredValue, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldError, FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import {
  useCreateSchedulerInventoryMeter,
  useSchedulerMeterRegister,
} from '@/modules/scheduler/hooks/useScheduler';
import type { CreateSchedulerInventoryMeterInput } from '@/modules/scheduler/types/domain';

function updatedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Date unavailable';
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMPTY_METER: CreateSchedulerInventoryMeterInput = {
  deviceId: '',
  deviceModel: 'A3RM',
  customManufacturerName: null,
  customModelName: null,
  notes: null,
};

function optionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

export function SchedulerMeterRegister() {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [meter, setMeter] = useState<CreateSchedulerInventoryMeterInput>(EMPTY_METER);
  const [formError, setFormError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const register = useSchedulerMeterRegister(deferredSearch);
  const createMeter = useCreateSchedulerInventoryMeter();
  const toast = useToast();

  async function submitMeter() {
    const deviceId = meter.deviceId.trim();
    const customManufacturerName = optionalValue(meter.customManufacturerName);
    const customModelName = optionalValue(meter.customModelName);
    if (!deviceId) {
      setFormError('Enter the meter Device ID.');
      return;
    }
    if (meter.deviceModel === 'OTHER' && (!customManufacturerName || !customModelName)) {
      setFormError('Other meters require both manufacturer and model name.');
      return;
    }
    setFormError(null);
    try {
      const created = await createMeter.mutateAsync({
        deviceId,
        deviceModel: meter.deviceModel,
        customManufacturerName: meter.deviceModel === 'OTHER' ? customManufacturerName : null,
        customModelName: meter.deviceModel === 'OTHER' ? customModelName : null,
        notes: optionalValue(meter.notes),
      });
      setMeter(EMPTY_METER);
      setAdding(false);
      toast.success(`${created.deviceId} added to company stock.`);
    } catch (cause) {
      setFormError(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-extrabold text-[var(--text)]">Meter inventory</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              Add and view meters before installation. Company stock and meters held by Field users appear here; installed meters are excluded.
            </p>
          </div>
          <Button
            type="button"
            variant={adding ? 'secondary' : 'primary'}
            aria-expanded={adding}
            aria-controls="inventory-add-meter-form"
            onClick={() => {
              setAdding((current) => !current);
              setFormError(null);
            }}
          >
            <Icon name={adding ? 'close' : 'plus'} size={18} />
            {adding ? 'Cancel' : 'Add meter'}
          </Button>
        </div>
      </Card>

      {adding ? (
        <Card id="inventory-add-meter-form">
          <form
            aria-labelledby="inventory-add-meter-heading"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMeter();
            }}
          >
            <div>
              <h2 id="inventory-add-meter-heading" className="font-extrabold text-[var(--text)]">Add company stock</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                Record meter details only. The meter remains uninstalled and available in company stock until it is transferred or claimed.
              </p>
            </div>
            <div className="grid gap-x-4 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor="inventory-device-id">Device ID</FieldLabel>
                <Input
                  id="inventory-device-id"
                  value={meter.deviceId}
                  maxLength={200}
                  autoComplete="off"
                  disabled={createMeter.isPending}
                  onChange={(event) => setMeter((current) => ({ ...current, deviceId: event.target.value }))}
                  placeholder="Scan or enter Device ID"
                  required
                />
              </div>
              <div>
                <FieldLabel htmlFor="inventory-device-model">Meter model</FieldLabel>
                <Select
                  id="inventory-device-model"
                  value={meter.deviceModel}
                  disabled={createMeter.isPending}
                  onChange={(event) => setMeter((current) => ({
                    ...current,
                    deviceModel: event.target.value as CreateSchedulerInventoryMeterInput['deviceModel'],
                  }))}
                >
                  <option value="A3RM">A3RM</option>
                  <option value="A6M">A6M</option>
                  <option value="OTHER">Other</option>
                </Select>
              </div>
              {meter.deviceModel === 'OTHER' ? (
                <>
                  <div>
                    <FieldLabel htmlFor="inventory-manufacturer">Manufacturer</FieldLabel>
                    <Input
                      id="inventory-manufacturer"
                      value={meter.customManufacturerName ?? ''}
                      maxLength={200}
                      disabled={createMeter.isPending}
                      onChange={(event) => setMeter((current) => ({ ...current, customManufacturerName: event.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="inventory-custom-model">Model name</FieldLabel>
                    <Input
                      id="inventory-custom-model"
                      value={meter.customModelName ?? ''}
                      maxLength={200}
                      disabled={createMeter.isPending}
                      onChange={(event) => setMeter((current) => ({ ...current, customModelName: event.target.value }))}
                      required
                    />
                  </div>
                </>
              ) : null}
              <div className="md:col-span-2">
                <FieldLabel htmlFor="inventory-notes">Meter notes <span className="font-normal text-[var(--text-sub)]">(optional)</span></FieldLabel>
                <Textarea
                  id="inventory-notes"
                  value={meter.notes ?? ''}
                  maxLength={2000}
                  disabled={createMeter.isPending}
                  onChange={(event) => setMeter((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Meter condition or stock notes"
                />
                <FieldHint>Do not enter job, client, site, or installation details here.</FieldHint>
              </div>
            </div>
            <FieldError message={formError ?? undefined} />
            <div className="mt-5 flex justify-end">
              <Button type="submit" disabled={createMeter.isPending}>
                {createMeter.isPending ? 'Adding…' : 'Add to company stock'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <div className="w-full lg:max-w-md">
          <FieldLabel className="!mt-0" htmlFor="meter-register-search">Search meter inventory</FieldLabel>
          <Input
            id="meter-register-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Device ID, model, make, notes, or user"
          />
          <FieldHint>Searches current company and user-held stock only.</FieldHint>
        </div>
      </Card>

      {register.isLoading ? <Spinner label="Loading meter inventory…" /> : null}
      {register.isError ? <ErrorBanner message="The meter inventory could not be loaded." /> : null}
      {register.data && register.data.items.length === 0 ? (
        <EmptyState
          title={deferredSearch ? 'No inventory meters match this search' : 'No non-installed meters in inventory'}
          description={deferredSearch ? 'Try a Device ID, model, make, notes, or user name.' : 'Add a meter to begin the company stock register.'}
          actions={!deferredSearch ? <Button onClick={() => setAdding(true)}>Add meter</Button> : undefined}
        />
      ) : null}
      {register.data && register.data.items.length > 0 ? (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">{register.data.total} inventory meter{register.data.total === 1 ? '' : 's'}</h2>
              {register.data.truncated ? <p className="mt-1 text-xs text-[var(--text-sub)]">Showing the first 500 matches. Refine the search to narrow the register.</p> : null}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3 font-extrabold sm:px-6">Device ID</th>
                  <th className="px-4 py-3 font-extrabold">Meter</th>
                  <th className="px-4 py-3 font-extrabold">Notes</th>
                  <th className="px-4 py-3 font-extrabold">Custody</th>
                  <th className="px-5 py-3 text-right font-extrabold sm:px-6">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {register.data.items.map((meter) => (
                  <tr key={meter.inventoryMeterId}>
                    <td className="px-5 py-4 font-extrabold text-[var(--text)] sm:px-6">{meter.deviceId}</td>
                    <td className="px-4 py-4">
                      <span className="block font-bold text-[var(--text)]">{meter.deviceModel === 'OTHER' ? meter.customModelName : meter.deviceModel}</span>
                      {meter.deviceModel === 'OTHER' ? <span className="text-xs text-[var(--text-sub)]">{meter.customManufacturerName}</span> : null}
                    </td>
                    <td className="max-w-sm px-4 py-4 text-[var(--text-sub)]">{meter.notes || '—'}</td>
                    <td className="px-4 py-4">
                      {meter.status === 'user' ? (
                        <>
                          <span className="block font-bold text-[var(--text)]">{meter.custodianName || 'Field user'}</span>
                          <span className="block text-xs text-[var(--text-sub)]">{meter.custodianEmail || 'User-held stock'}</span>
                        </>
                      ) : (
                        <span className="inline-flex rounded-full bg-[var(--green-soft)] px-2.5 py-1 text-xs font-extrabold text-[var(--green)]">Company stock</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--text-sub)] sm:px-6">{updatedDate(meter.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
