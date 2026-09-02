'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetClients, useSaveFleetClientApiKey } from '@/modules/fleet/hooks/useFleet';
import { formatDate, formatNumber, formatPercent } from '@/modules/fleet/lib/format';

export default function ClientsPage() {
  const { wwUser } = usePortalAuth();
  const query = useFleetClients();
  const saveApiKey = useSaveFleetClientApiKey();
  const [search, setSearch] = useState('');
  const [maas, setMaas] = useState<'all' | 'true' | 'false'>('all');
  const [quality, setQuality] = useState<'all' | 'healthy' | 'issues'>('all');
  const [apiKeyFilter, setApiKeyFilter] = useState<'all' | 'configured' | 'missing'>('all');
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const clients = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const run = query.data?.run;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesSearch = !needle || client.name.toLowerCase().includes(needle) || client.code.toLowerCase().includes(needle);
      const matchesMaas = maas === 'all' || client.isMaas === (maas === 'true');
      const healthy = ['complete', 'completed', 'success', 'successful', 'published'].includes(client.collectionStatus?.toLowerCase() ?? '');
      const matchesQuality = quality === 'all' || (quality === 'healthy' ? healthy : !healthy || Boolean(client.collectionError));
      const matchesApiKey = apiKeyFilter === 'all'
        || client.apiKeyConfigured === (apiKeyFilter === 'configured');
      return matchesSearch && matchesMaas && matchesQuality && matchesApiKey;
    });
  }, [apiKeyFilter, clients, maas, quality, search]);

  const editingClient = clients.find((client) => client.id === editingClientId) ?? null;

  async function submitApiKey(event: FormEvent) {
    event.preventDefault();
    if (!editingClient || apiKey.trim().length < 8) return;
    await saveApiKey.mutateAsync({ clientId: editingClient.id, apiKey: apiKey.trim() });
    setApiKey('');
    setEditingClientId(null);
  }

  const totals = useMemo(() => clients.reduce(
    (acc, client) => ({
      devices: acc.devices + client.totalDevices,
      offline: acc.offline + client.offline,
      reportOffline: acc.reportOffline + client.reportOffline,
      collectionIssues: acc.collectionIssues + (client.collectionError ? 1 : 0),
    }),
    { devices: 0, offline: 0, reportOffline: 0, collectionIssues: 0 },
  ), [clients]);

  if (query.isLoading) return <Spinner label="Loading fleet clients…" />;

  return (
    <div>
      <PageHeader
        title="Fleet accounts"
        subtitle="Compare Wattwatchers API-key owners and MaaS collection fleets. End-customer clients and their sites are shown from device placement records."
        actions={(
          <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <Icon name="activity" size={17} />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {query.error ? <ErrorBanner message={fleetConnectionErrorMessage(query.error)} /> : null}

      {!query.error && clients.length === 0 ? (
        <EmptyState icon="users" title="No Fleet accounts yet" description="Fleet-account results will appear after a complete collection run is published." />
      ) : clients.length > 0 ? (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Fleet accounts" value={formatNumber(clients.length)} icon="users" />
            <StatCard label="Account memberships" value={formatNumber(totals.devices)} icon="gauge" />
            <StatCard label="Offline memberships" value={formatNumber(totals.offline)} icon="wifi-off" tone="danger" />
            <StatCard label="Collection issues" value={formatNumber(totals.collectionIssues)} icon="activity" tone={totals.collectionIssues > 0 ? 'danger' : 'success'} />
          </div>

          <Card className="mb-5 !p-4 sm:!p-5">
            <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <legend className="sr-only">Fleet account filters</legend>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                Search Fleet account
                <div className="relative mt-1.5">
                  <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <Input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or code" />
                </div>
              </label>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                API key
                <Select className="mt-1.5" value={apiKeyFilter} onChange={(event) => setApiKeyFilter(event.target.value as typeof apiKeyFilter)}>
                  <option value="all">All Fleet accounts</option>
                  <option value="missing">API key not added</option>
                  <option value="configured">API key configured</option>
                </Select>
              </label>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                MaaS classification
                <Select className="mt-1.5" value={maas} onChange={(event) => setMaas(event.target.value as typeof maas)}>
                  <option value="all">All Fleet accounts</option>
                  <option value="true">MaaS accounts</option>
                  <option value="false">Non-MaaS accounts</option>
                </Select>
              </label>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                Collection quality
                <Select className="mt-1.5" value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}>
                  <option value="all">All collection results</option>
                  <option value="healthy">Healthy only</option>
                  <option value="issues">Issues only</option>
                </Select>
              </label>
            </fieldset>
          </Card>

          <div className="mb-4 flex flex-col gap-1 text-sm text-[var(--text-sub)] sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite"><span className="font-bold text-[var(--text)]">{formatNumber(filtered.length)}</span> Fleet accounts shown</p>
            {run ? <p>Snapshot {formatDate(run.reportingDate)}</p> : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon="search" title="No Fleet accounts match these filters" description="Change the search, MaaS, API-key, or collection-quality filter." />
          ) : (
            <Card className="min-w-0 !p-0">
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <caption className="sr-only">Fleet connectivity, collection quality and API-key state by Wattwatchers Fleet account</caption>
                  <thead>
                    <tr>
                      <th className={tableHeadClass} scope="col">Fleet account</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Availability at scan</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Communicating</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Delayed</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Offline</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Inactive / unknown</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Report offline</th>
                      <th className={tableHeadClass} scope="col">Collection</th>
                      <th className={tableHeadClass} scope="col">API key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((client) => (
                      <tr key={client.id} className="hover:bg-[var(--surface2)]/70">
                        <td className={tableCellClass}>
                          <Link href={`/fleet/devices?clientId=${encodeURIComponent(client.id)}`} className="font-bold text-[var(--primary)] hover:underline">{client.name}</Link>
                          <p className="mt-1 text-xs text-[var(--text-sub)]">{client.code}</p>
                          {client.isMaas ? <span className="mt-2 inline-flex rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">MaaS</span> : null}
                        </td>
                        <td className={`${tableCellClass} text-right font-bold`}>{formatNumber(client.totalDevices)}</td>
                        <td className={`${tableCellClass} min-w-44 text-right`}>
                          <span className="font-bold">{formatPercent(client.availabilityPercent)}</span>
                          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--surface2)]" aria-hidden="true">
                            <span className="block h-full bg-[var(--primary)]" style={{ width: `${Math.max(0, Math.min(100, client.availabilityPercent ?? 0))}%` }} />
                          </span>
                        </td>
                        <td className={`${tableCellClass} text-right text-[var(--green)]`}>{formatNumber(client.communicating)}</td>
                        <td className={`${tableCellClass} text-right text-[var(--amber)]`}>{formatNumber(client.delayed)}</td>
                        <td className={`${tableCellClass} text-right font-bold text-[var(--red)]`}>{formatNumber(client.offline)}</td>
                        <td className={`${tableCellClass} text-right`}>{formatNumber(client.inactive + client.unknown)}</td>
                        <td className={`${tableCellClass} text-right`}>{formatNumber(client.reportOffline)}</td>
                        <td className={tableCellClass}>
                          <ProcessStatusBadge status={client.collectionStatus} />
                          {client.collectionError ? <p className="mt-2 max-w-64 text-xs leading-5 text-[var(--red)]">{client.collectionError}</p> : null}
                        </td>
                        <td className={`${tableCellClass} min-w-44`}>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                            client.apiKeyConfigured
                              ? 'bg-[var(--green-soft)] text-[var(--green)]'
                              : 'bg-[var(--amber-soft)] text-[var(--amber)]'
                          }`}>
                            {client.apiKeyConfigured ? 'API key configured' : 'API key not added'}
                          </span>
                          {wwUser?.role === 'admin' ? (
                            <Button
                              className="mt-2 !min-h-9 !px-3 !py-1.5"
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setApiKey('');
                                setEditingClientId(client.id);
                              }}
                            >
                              {client.apiKeyConfigured ? 'Update key' : 'Add key'}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : null}

      {editingClient && wwUser?.role === 'admin' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setEditingClientId(null);
        }}>
          <Card className="w-full max-w-lg" role="dialog" aria-modal="true" aria-labelledby="fleet-api-key-title">
            <h2 id="fleet-api-key-title" className="text-lg font-extrabold text-[var(--text)]">
              {editingClient.apiKeyConfigured ? 'Update' : 'Add'} API key for {editingClient.name}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
              The key is encrypted after submission and is never displayed again.
            </p>
            <form className="mt-4" onSubmit={(event) => void submitApiKey(event)}>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                Wattwatchers API key
                <Input className="mt-1.5" type="password" autoComplete="new-password" minLength={8} required value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoFocus />
              </label>
              {saveApiKey.error ? (
                <div className="mt-3"><ErrorBanner message={fleetConnectionErrorMessage(saveApiKey.error)} /></div>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditingClientId(null)}>Cancel</Button>
                  <Button type="submit" disabled={apiKey.trim().length < 8 || saveApiKey.isPending}>
                    {saveApiKey.isPending
                      ? 'Saving…'
                      : editingClient.apiKeyConfigured ? 'Update API key' : 'Add API key'}
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
