'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { MeterRegisterEditDialog } from '@/modules/fleet/components/MeterRegisterEditDialog';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetMeterRegisterEntries } from '@/modules/fleet/hooks/useFleet';
import { formatNumber } from '@/modules/fleet/lib/format';
import {
  meterRegisterClassificationPresentation,
  meterRegisterListValues,
  type MeterRegisterClassificationTone,
} from '@/modules/fleet/lib/meterRegisterList';
import type {
  FleetMeterRegisterIdentifierClassification,
  FleetRegisterEvidence,
} from '@/modules/fleet/types/domain';

const pageSize = 50;

const classificationToneClass: Record<MeterRegisterClassificationTone, string> = {
  positive: 'border-[var(--green)]/30 bg-[var(--green-soft)] text-[var(--green)]',
  warning: 'border-[var(--amber)]/30 bg-[var(--amber-soft)] text-[var(--amber)]',
  neutral: 'border-[var(--border-strong)] bg-[var(--surface2)] text-[var(--text-sub)]',
};

function ClassificationBadge({
  classification,
}: {
  classification?: FleetMeterRegisterIdentifierClassification;
}) {
  const presentation = meterRegisterClassificationPresentation(classification);
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${classificationToneClass[presentation.tone]}`}>
      {presentation.label}
    </span>
  );
}

function sourceClientName(evidence: FleetRegisterEvidence): string | null {
  return evidence.clientName?.trim() || evidence.fleetAccountName?.trim() || null;
}

export default function MeterRegisterPage() {
  const { wwUser } = usePortalAuth();
  const isAdmin = wwUser?.role === 'admin';
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [offset, setOffset] = useState(0);
  const [editingEvidence, setEditingEvidence] = useState<FleetRegisterEvidence | null>(null);
  const registerQuery = useFleetMeterRegisterEntries({
    search: deferredSearch,
    limit: pageSize,
    offset,
  }, isAdmin);
  const entries = registerQuery.data?.data ?? [];
  const total = registerQuery.data?.meta.total ?? 0;
  const firstItem = total === 0 ? 0 : offset + 1;
  const lastItem = Math.min(offset + pageSize, total);

  function clearSearch() {
    setSearch('');
    setOffset(0);
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon="shield"
        title="Fleet administrator access required"
        description="The full Meter Register includes financial, contact and raw Excel fields and is not available to Fleet viewers."
      />
    );
  }

  if (registerQuery.isLoading && !registerQuery.data) {
    return <Spinner label="Loading Meter Register…" />;
  }

  return (
    <div>
      <PageHeader
        title="Meter Register"
        subtitle="Search every imported row with a current identifier, including candidate Wattwatchers IDs and other hardware that is not listed as a Fleet device."
        actions={(
          <Button
            variant="secondary"
            disabled={registerQuery.isFetching}
            onClick={() => void registerQuery.refetch()}
          >
            <Icon name="refresh" size={17} />
            {registerQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {registerQuery.error ? (
        <div className="mb-5">
          <ErrorBanner message={fleetConnectionErrorMessage(registerQuery.error)} />
        </div>
      ) : null}

      <Card className="mb-5 !p-4 sm:!p-5">
        <label className="block max-w-2xl text-xs font-bold text-[var(--text-sub)]">
          Search Meter Register
          <div className="relative mt-1.5">
            <Icon
              name="search"
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              placeholder="Identifier, client, customer, site or source workbook"
              className="pl-10"
            />
          </div>
        </label>
      </Card>

      <p className="mb-4 text-sm text-[var(--text-sub)]" aria-live="polite">
        <span className="font-bold text-[var(--text)]">{formatNumber(total)}</span> current-identifier rows
        {deferredSearch ? ` matching “${deferredSearch}”` : ''}
      </p>

      {entries.length === 0 && !registerQuery.error ? (
        <EmptyState
          icon="clipboard"
          title={deferredSearch ? 'No Meter Register rows match this search' : 'No Meter Register rows are available'}
          description={deferredSearch
            ? 'Search by another identifier, client, customer, site or source value.'
            : 'Rows will appear here after the Meter Register is imported.'}
          actions={deferredSearch ? <Button variant="secondary" onClick={clearSearch}>Clear search</Button> : undefined}
        />
      ) : entries.length ? (
        <Card className="min-w-0 !p-0">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">
                Imported Meter Register rows with current identifier, classification, mapped client, customer, site, revision and source
              </caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Current identifier</th>
                  <th className={tableHeadClass} scope="col">Classification</th>
                  <th className={tableHeadClass} scope="col">Client</th>
                  <th className={tableHeadClass} scope="col">Customer</th>
                  <th className={tableHeadClass} scope="col">Site</th>
                  <th className={tableHeadClass} scope="col">Mapped record</th>
                  <th className={tableHeadClass} scope="col">Source</th>
                  {isAdmin ? <th className={tableHeadClass} scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {entries.map((evidence) => {
                  const values = meterRegisterListValues(evidence);
                  const rawClient = sourceClientName(evidence);
                  const linksToFleetDevice = evidence.currentDeviceClassification === 'confirmed_wattwatchers';
                  return (
                    <tr key={evidence.id} className="hover:bg-[var(--surface2)]/70">
                      <td className={`${tableCellClass} min-w-52`}>
                        {linksToFleetDevice ? (
                          <Link
                            href={`/fleet/devices/${encodeURIComponent(values.identifier)}`}
                            className="break-all font-bold text-[var(--primary)] hover:underline"
                          >
                            {values.identifier}
                          </Link>
                        ) : (
                          <span className="break-all font-bold text-[var(--text)]">{values.identifier}</span>
                        )}
                        {(evidence.existingDeviceIdentifier || evidence.newDeviceIdentifier) ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {evidence.newDeviceIdentifier ? 'New' : 'Existing'} source identifier
                          </p>
                        ) : null}
                      </td>
                      <td className={`${tableCellClass} min-w-48`}>
                        <ClassificationBadge classification={evidence.currentDeviceClassification} />
                      </td>
                      <td className={`${tableCellClass} min-w-52 max-w-72 whitespace-normal`}>
                        <span className="font-bold text-[var(--text)]">{values.clientName}</span>
                        {evidence.record && rawClient && rawClient !== values.clientName ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">Source client: {rawClient}</p>
                        ) : null}
                      </td>
                      <td className={`${tableCellClass} min-w-52 max-w-72 whitespace-normal`}>
                        <span className="font-semibold text-[var(--text)]">{values.customerName}</span>
                      </td>
                      <td className={`${tableCellClass} min-w-64 max-w-96 whitespace-normal`}>
                        <span className="font-bold text-[var(--text)]">{values.siteName}</span>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                          {[values.siteAddress, values.siteState].filter(Boolean).join(' · ')}
                        </p>
                        {evidence.record?.details.installationDetail ? (
                          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                            Installation: {evidence.record.details.installationDetail}
                          </p>
                        ) : null}
                      </td>
                      <td className={`${tableCellClass} min-w-36`}>
                        {values.revision === null ? (
                          <span className="font-semibold text-[var(--amber)]">Needs mapping</span>
                        ) : (
                          <>
                            <span className="font-bold text-[var(--text)]">Revision {values.revision}</span>
                            <p className="mt-1 text-xs text-[var(--text-sub)]">Mapped</p>
                          </>
                        )}
                      </td>
                      <td className={`${tableCellClass} min-w-56 max-w-80 whitespace-normal`}>
                        <span className="font-semibold text-[var(--text)]">
                          {evidence.sourceWorkbook?.trim() || 'Workbook not recorded'}
                        </span>
                        <p className="mt-1 text-xs text-[var(--text-sub)]">
                          {[evidence.sourceSheet?.trim(), evidence.sourceRow ? `Row ${evidence.sourceRow}` : null]
                            .filter(Boolean)
                            .join(' · ') || 'Sheet and row not recorded'}
                        </p>
                      </td>
                      {isAdmin ? (
                        <td className={tableCellClass}>
                          <Button
                            variant="secondary"
                            className="min-h-9 px-3 py-1.5"
                            onClick={() => setEditingEvidence(evidence)}
                            aria-label={`Edit Meter Register row for ${values.identifier}`}
                          >
                            Edit
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--text-sub)]">
              Showing {formatNumber(firstItem)}–{formatNumber(lastItem)} of {formatNumber(total)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0 || registerQuery.isFetching}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={offset + pageSize >= total || registerQuery.isFetching || registerQuery.isPlaceholderData}
                onClick={() => setOffset(offset + pageSize)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {editingEvidence ? (
        <MeterRegisterEditDialog
          deviceId={editingEvidence.currentDeviceClassification === 'confirmed_wattwatchers'
            ? editingEvidence.currentDeviceIdentifier ?? undefined
            : undefined}
          evidence={editingEvidence}
          onClose={() => setEditingEvidence(null)}
        />
      ) : null}
    </div>
  );
}
