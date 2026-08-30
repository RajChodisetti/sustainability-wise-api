'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { ScannerInput } from '@/modules/installhub/components/ScannerInput';
import {
  useClaimInstallHubInventoryMeter,
  useInstallHubInventoryAccess,
  useInstallHubInventoryMeters,
} from '@/modules/installhub/hooks/useInventory';
import { installHubInventoryModelLabel, normalizeInventoryDeviceId } from '@/modules/installhub/lib/inventory';
import type { InstallHubInventoryScope } from '@/modules/installhub/api/inventory';
import type { InstallHubInventoryMeter } from '@/modules/installhub/types/inventory';

const BARCODE_MODES = ['barcode'] as const;
const EMPTY_INVENTORY_METERS: InstallHubInventoryMeter[] = [];

function useDebouncedValue(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function InventoryStatusBadge({ meter }: { meter: InstallHubInventoryMeter }) {
  const company = meter.status === 'company';
  return (
    <span className={`inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-bold ${
      company
        ? 'border-[var(--border-strong)] bg-[var(--surface2)] text-[var(--text-sub)]'
        : 'border-[var(--amber)]/25 bg-[var(--amber-soft)] text-[var(--amber)]'
    }`}>
      {company ? 'Company' : 'With user'}
    </span>
  );
}

function AddInventoryMeterDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const toast = useToast();
  const claim = useClaimInstallHubInventoryMeter();
  const [mode, setMode] = useState<'choose' | 'scan' | 'manual'>('choose');
  const [deviceId, setDeviceId] = useState('');
  const [pendingScannedId, setPendingScannedId] = useState('');
  const [scanKey, setScanKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !claim.isPending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [claim.isPending, onClose]);

  const handleDeviceIdChange = useCallback((value: string) => {
    setDeviceId(value);
    setPendingScannedId('');
    setError(null);
  }, []);

  const handleScanResult = useCallback((value: string) => {
    const normalized = normalizeInventoryDeviceId(value);
    if (!normalized) return;
    setDeviceId(normalized);
    setPendingScannedId(normalized);
    setError(null);
  }, []);

  async function claimMeter(rawDeviceId: string, continueScanning: boolean) {
    const normalized = normalizeInventoryDeviceId(rawDeviceId);
    if (!normalized) {
      setError('Enter or scan the meter Device ID / serial.');
      return;
    }
    setError(null);
    try {
      await claim.mutateAsync(normalized);
      toast.success(`${normalized} added to your inventory.`);
      setDeviceId('');
      setPendingScannedId('');
      if (continueScanning) {
        setScanKey((value) => value + 1);
      } else {
        onClose();
      }
    } catch (caught) {
      setError(installHubConnectionErrorMessage(caught));
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-inventory-meter-title"
        className="max-h-[min(90vh,48rem)] w-full max-w-xl overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-inventory-meter-title" className="text-xl font-extrabold text-[var(--text)]">
              Add meter
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              The meter must already exist in company stock. Adding it transfers custody to you and updates Scheduler immediately.
            </p>
          </div>
          <Button variant="ghost" disabled={claim.isPending} onClick={onClose} aria-label="Close Add meter">
            Close
          </Button>
        </div>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

        {mode === 'choose' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface2)] p-5 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
              onClick={() => {
                setMode('scan');
                setScanKey((value) => value + 1);
              }}
            >
              <Icon name="camera" size={22} className="text-[var(--primary)]" />
              <span className="mt-3 block font-extrabold text-[var(--text)]">Scan barcode</span>
              <span className="mt-1 block text-sm leading-6 text-[var(--text-sub)]">
                Use this device’s camera and confirm each detected meter.
              </span>
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface2)] p-5 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
              onClick={() => setMode('manual')}
            >
              <Icon name="file-text" size={22} className="text-[var(--primary)]" />
              <span className="mt-3 block font-extrabold text-[var(--text)]">Enter manually</span>
              <span className="mt-1 block text-sm leading-6 text-[var(--text-sub)]">
                Type the exact company-stock Device ID / serial.
              </span>
            </button>
          </div>
        ) : null}

        {mode === 'scan' ? (
          <div className="mt-5">
            <FieldLabel htmlFor="inventory-scanned-device-id" className="!mt-0">Device ID / serial</FieldLabel>
            <ScannerInput
              inputId="inventory-scanned-device-id"
              value={deviceId}
              onChange={handleDeviceIdChange}
              onScanResult={handleScanResult}
              autoOpenKey={scanKey}
              modes={BARCODE_MODES}
              disabled={claim.isPending}
            />
            <FieldHint>After you confirm and add a meter, the scanner opens again automatically for the next one.</FieldHint>

            {pendingScannedId ? (
              <Card className="mt-4 !p-4" role="status">
                <p className="font-extrabold text-[var(--text)]">Confirm meter</p>
                <p className="mt-1 text-sm text-[var(--text-sub)]">
                  Add <strong className="text-[var(--text)]">{pendingScannedId}</strong> to your inventory?
                </p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={claim.isPending}
                    onClick={() => {
                      setDeviceId('');
                      setPendingScannedId('');
                      setScanKey((value) => value + 1);
                    }}
                  >
                    Scan again
                  </Button>
                  <Button
                    disabled={claim.isPending}
                    onClick={() => void claimMeter(pendingScannedId, true)}
                  >
                    {claim.isPending ? 'Adding…' : 'Add meter'}
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={claim.isPending || !normalizeInventoryDeviceId(deviceId)}
                  onClick={() => setPendingScannedId(normalizeInventoryDeviceId(deviceId))}
                >
                  Review Device ID
                </Button>
              </div>
            )}

            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <Button
                variant="ghost"
                disabled={claim.isPending}
                onClick={() => {
                  setDeviceId('');
                  setPendingScannedId('');
                  setMode('manual');
                }}
              >
                Enter Device ID manually instead
              </Button>
            </div>
          </div>
        ) : null}

        {mode === 'manual' ? (
          <div className="mt-5">
            <FieldLabel htmlFor="inventory-manual-device-id" className="!mt-0">Device ID / serial</FieldLabel>
            <Input
              id="inventory-manual-device-id"
              value={deviceId}
              autoComplete="off"
              autoCapitalize="characters"
              disabled={claim.isPending}
              placeholder="Enter company-stock Device ID"
              onChange={(event) => handleDeviceIdChange(event.target.value)}
            />
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={claim.isPending} onClick={() => setMode('choose')}>
                Back
              </Button>
              <Button
                disabled={claim.isPending || !normalizeInventoryDeviceId(deviceId)}
                onClick={() => void claimMeter(deviceId, false)}
              >
                {claim.isPending ? 'Adding…' : 'Add to my inventory'}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function InstallHubInventoryPage() {
  const [scope, setScope] = useState<InstallHubInventoryScope>('mine');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const normalizedSearch = search.trim();
  const debouncedSearch = useDebouncedValue(normalizedSearch);
  const access = useInstallHubInventoryAccess();
  const inventory = useInstallHubInventoryMeters(scope);
  const searchInventory = useInstallHubInventoryMeters(
    scope,
    debouncedSearch,
    Boolean(debouncedSearch),
  );
  const listInventory = debouncedSearch ? searchInventory : inventory;
  const summaryMeters = inventory.data?.data ?? EMPTY_INVENTORY_METERS;
  const meters = listInventory.data?.data ?? EMPTY_INVENTORY_METERS;
  const searchIsPending = normalizedSearch !== debouncedSearch
    || (Boolean(debouncedSearch) && searchInventory.isLoading);

  if ((access.isLoading || inventory.isLoading) && !inventory.data) {
    return <Spinner label="Loading meter inventory…" />;
  }
  if (access.error) return <ErrorBanner message={installHubConnectionErrorMessage(access.error)} />;
  if (inventory.error) return <ErrorBanner message={installHubConnectionErrorMessage(inventory.error)} />;
  if (debouncedSearch && searchInventory.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(searchInventory.error)} />;
  }

  const isMaintainer = access.data?.isMaintainer === true;
  const total = inventory.data?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-[96rem]">
      <PageHeader
        title="Meter inventory"
        subtitle="See meters in your custody and claim existing company stock before installation."
        actions={scope === 'mine' ? (
          <Button onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={18} />
            Add meter
          </Button>
        ) : null}
      />

      {isMaintainer ? (
        <div className="mb-5 flex flex-wrap gap-2" aria-label="Inventory scope">
          <Button
            variant={scope === 'mine' ? 'primary' : 'secondary'}
            aria-pressed={scope === 'mine'}
            onClick={() => {
              setScope('mine');
              setSearch('');
            }}
          >
            My inventory
          </Button>
          <Button
            variant={scope === 'company' ? 'primary' : 'secondary'}
            aria-pressed={scope === 'company'}
            onClick={() => {
              setScope('company');
              setSearch('');
            }}
          >
            Company inventory
          </Button>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={scope === 'mine' ? 'My inventory total' : 'Active meters'}
          value={total}
          icon="clipboard"
        />
        {scope === 'company' ? (
          <>
            <StatCard
              label={inventory.data?.truncated ? 'Company stock shown' : 'Company stock'}
              value={summaryMeters.filter((meter) => meter.status === 'company').length}
              icon="building"
            />
            <StatCard
              label={inventory.data?.truncated ? 'With field users shown' : 'With field users'}
              value={summaryMeters.filter((meter) => meter.status === 'user').length}
              icon="users"
              tone="warning"
            />
          </>
        ) : null}
      </div>

      <Card className="mb-5 !p-4 sm:!p-5">
        <FieldLabel htmlFor="inventory-search" className="!mt-0">Search inventory</FieldLabel>
        <Input
          id="inventory-search"
          value={search}
          type="search"
          placeholder="Device ID, A3RM/A6M/OTHER, or custodian name"
          onChange={(event) => setSearch(event.target.value)}
        />
        <FieldHint>
          {searchIsPending
            ? 'Searching all active inventory…'
            : debouncedSearch
              ? `Showing ${meters.length} of ${listInventory.data?.total ?? 0} matching meters.`
              : `Showing ${meters.length} of ${total} meter${total === 1 ? '' : 's'}.`}
          {listInventory.data?.truncated ? ' Only the first 500 matching records are shown.' : ''}
        </FieldHint>
      </Card>

      {searchIsPending ? (
        <Spinner label="Searching meter inventory…" />
      ) : meters.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title={search.trim() ? 'No matching meters' : 'No meters in this inventory'}
          description={scope === 'mine'
            ? 'Use Add meter to claim an existing company-stock Device ID.'
            : 'Company stock and meters currently held by Field users appear here.'}
          actions={scope === 'mine' && !search.trim() ? (
            <Button onClick={() => setAddOpen(true)}>Add meter</Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" aria-label="Meter inventory list">
          {meters.map((meter) => (
            <Card key={meter.id} className="!p-4 sm:!p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-all font-extrabold text-[var(--text)]">{meter.deviceId}</p>
                  <p className="mt-1 text-sm text-[var(--text-sub)]">
                    {installHubInventoryModelLabel(meter)}
                  </p>
                  {meter.status === 'user' && scope === 'company' ? (
                    <p className="mt-1 break-words text-xs text-[var(--muted)]">
                      With {meter.custodianName ?? meter.custodianUserId ?? 'Field user'}
                    </p>
                  ) : null}
                  {meter.notes ? (
                    <p className="mt-2 break-words text-xs leading-5 text-[var(--text-sub)]">{meter.notes}</p>
                  ) : null}
                </div>
                <InventoryStatusBadge meter={meter} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {addOpen ? <AddInventoryMeterDialog onClose={() => setAddOpen(false)} /> : null}
    </div>
  );
}
