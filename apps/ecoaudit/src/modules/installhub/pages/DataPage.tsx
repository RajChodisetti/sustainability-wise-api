'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { StatusBadge } from '@/components/ui/Badges';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs, DefinitionList } from '@/modules/installhub/components/InstallHubUi';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import { useInstallationTree } from '@/modules/installhub/hooks/useInstallationTree';
import { collectPhotoReferences } from '@/modules/installhub/lib/model';
import { displayCodeValue } from '@/modules/installhub/lib/workflow';
import type { InstallationTree } from '@/modules/installhub/types/domain';

function installationBreadcrumbs(tree: InstallationTree, installationId: string, label: string) {
  return [
    { label: 'Installations', href: '/installhub/installations' },
    { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
    { label },
  ];
}

export const installHubPhotoSelectionStorageKey = (installationId: string) =>
  `ih_client_report_photo_selection:${installationId}`;

function loadExcludedPhotos(installationId: string): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(installHubPhotoSelectionStorageKey(installationId));
    return saved ? JSON.parse(saved) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export function InstallHubPhotosPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    window.setTimeout(() => setExcluded(loadExcludedPhotos(installationId)), 0);
  }, [installationId]);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const photos = collectPhotoReferences(tree);
  const missing = [
    ...tree.zones.filter((zone) => !zone.photos.length).map((zone) => `Zone · ${zone.zoneName}`),
    ...tree.electricalAssets.filter((board) =>
      !board.photo
      && !board.extraPhotos.length
      && board.meters.every((meter) =>
        !meter.wwPhotos?.deviceInstalled
        && !meter.wwPhotos?.switchboardOverview
        && !meter.wwPhotos?.labeling
        && !meter.wwPhotos?.extra?.length,
      )
    ).map((board) => `Switchboard · ${displayCodeValue(board) || board.assetName}`),
    ...tree.siteAssets.filter((asset) => !asset.locationPhoto && !asset.extraPhotos.length)
      .map((asset) => `Site asset · ${displayCodeValue(asset) || asset.assetName}`),
  ];
  const includedCount = photos.filter((photo) => !excluded[photo.key]).length;

  function toggle(key: string, included: boolean) {
    setExcluded((current) => {
      const next = { ...current };
      if (included) delete next[key];
      else next[key] = true;
      try {
        localStorage.setItem(installHubPhotoSelectionStorageKey(installationId), JSON.stringify(next));
      } catch {
        // The current selection remains usable when browser storage is blocked.
      }
      return next;
    });
  }

  return (
    <div>
      <Breadcrumbs items={installationBreadcrumbs(tree, installationId, 'Photo gallery')} />
      <PageHeader
        title="Photo preview"
        subtitle={`${tree.installation.siteName} · Choose which evidence appears in the browser client-report preview.`}
        actions={<LinkButton href={`/installhub/installations/${installationId}/client-report`} variant="secondary"><Icon name="eye" size={17} />Client report</LinkButton>}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Evidence files" value={photos.length} icon="camera" />
        <StatCard label="Included" value={includedCount} icon="check" tone="success" />
        <StatCard label="Items without evidence" value={missing.length} icon="activity" tone={missing.length ? 'warning' : 'success'} />
      </div>
      {!photos.length ? (
        <EmptyState
          title="No photos captured"
          description="Photo evidence uploaded from zone, asset, meter, and form workflows appears here."
          icon="camera"
          actions={<LinkButton href={`/installhub/installations/${installationId}/zones`}>Open zones</LinkButton>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {photos.map((photo) => (
            <Card key={photo.key} className="overflow-hidden !p-3">
              <PhotoThumb app="installhub" uri={photo.uri} label={photo.label} className="h-52 w-full rounded-xl object-cover" />
              <div className="px-1 pb-1 pt-3">
                <p className="min-h-10 text-sm font-bold leading-5 text-[var(--text)]">{photo.label}</p>
                <Checkbox label="Include in client report preview" checked={!excluded[photo.key]} onChange={(checked) => toggle(photo.key, checked)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {missing.length ? (
        <section className="mt-8" aria-labelledby="missing-evidence-heading">
          <h2 id="missing-evidence-heading" className="mb-3 text-lg font-extrabold text-[var(--text)]">Items without evidence</h2>
          <Card><ul className="grid gap-2 text-sm text-[var(--text-sub)] sm:grid-cols-2">{missing.map((label) => <li key={label} className="flex items-center gap-2"><Icon name="camera" size={16} className="shrink-0 text-[var(--muted)]" />{label}</li>)}</ul></Card>
        </section>
      ) : null}
    </div>
  );
}

export function InstallHubClientReportPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    window.setTimeout(() => setExcluded(loadExcludedPhotos(installationId)), 0);
  }, [installationId]);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const meters = tree.meterDevices?.length ?? tree.electricalAssets.reduce((total, board) => total + board.meters.length, 0);
  const completedForms = tree.formSubmissions.filter((form) => form.status === 'Completed');
  const openTbc = tree.electricalAssets.filter((board) => board.electricalSource?.kind === 'TBC' || board.electricalParentTbc).length
    + tree.siteAssets.filter((asset) => asset.electricalSource?.kind === 'TBC' || asset.electricalBoardTbc || asset.meteringState?.kind === 'TBC').length;
  const photos = collectPhotoReferences(tree);
  const includedPhotos = photos.filter((photo) => !excluded[photo.key]);
  const completedFormNames = Array.from(new Set(completedForms.map((form) => FORM_DEFINITION_BY_TYPE[form.formType]?.shortTitle ?? form.formType)));

  return (
    <div>
      <div className="print:hidden">
        <Breadcrumbs items={installationBreadcrumbs(tree, installationId, 'Client report')} />
        <PageHeader
          title="Client report"
          subtitle="A client-facing browser summary derived from the live installation record."
          actions={<><LinkButton href={`/installhub/installations/${installationId}/photos`} variant="secondary"><Icon name="camera" size={17} />Choose photos</LinkButton><Button onClick={() => window.print()}><Icon name="download" size={17} />Print / save PDF</Button></>}
        />
      </div>
      <article className="mx-auto max-w-5xl rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-xs)] print:max-w-none print:border-0 print:p-0 print:shadow-none sm:p-8">
        <header className="border-b-2 border-[var(--primary)] pb-6">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--primary)]">Field App Complete</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-[var(--text)]">Installation summary</h1>
          <p className="mt-3 text-xl font-bold text-[var(--text)]">{tree.installation.siteName}</p>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{tree.installation.clientName} · {tree.installation.siteAddress}</p>
        </header>
        <section className="border-b border-[var(--border)] py-6">
          <DefinitionList items={[
            { label: 'Installer', value: tree.installation.inspectorName },
            { label: 'Date', value: tree.installation.auditDate },
            { label: 'Status', value: <StatusBadge status={tree.installation.status} /> },
            { label: 'Zones', value: tree.zones.length },
            { label: 'Switchboards', value: tree.electricalAssets.length },
            { label: 'Meters', value: meters },
          ]} />
        </section>
        <section className="border-b border-[var(--border)] py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">Electrical overview</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">{tree.electricalAssets.length} switchboards and {meters} installed meter devices were documented across {tree.zones.length} site zones.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{tree.zones.map((zone) => {
            const boards = tree.electricalAssets.filter((board) => board.zoneId === zone.id).length;
            const assets = tree.siteAssets.filter((asset) => asset.zoneId === zone.id).length;
            return <div key={zone.id} className="rounded-xl bg-[var(--surface2)] p-4"><p className="font-extrabold text-[var(--text)]">{zone.zoneName}</p><p className="mt-1 text-sm text-[var(--text-sub)]">{boards} switchboards · {assets} site assets</p></div>;
          })}</div>
        </section>
        <section className="border-b border-[var(--border)] py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">Loads and site assets</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">{tree.siteAssets.length} site assets were recorded; {tree.siteAssets.filter((asset) => asset.meteringState?.kind === 'METERED').length} have confirmed direct metering.</p>
          {tree.siteAssets.length ? <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">{tree.siteAssets.slice(0, 250).map((asset) => <div key={asset.id} className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-0"><span><span className="block text-sm font-bold text-[var(--text)]">{asset.assetName}</span><span className="block text-xs text-[var(--text-sub)]">{asset.assetType}</span></span><span className="text-xs font-bold text-[var(--text-sub)]">{asset.meteringState?.kind === 'METERED' ? 'Metered' : asset.meteringState?.kind === 'UNMETERED' ? 'Unmetered' : 'To be confirmed'}</span></div>)}</div> : null}
          {tree.siteAssets.length > 250 ? <p className="mt-2 text-xs text-[var(--text-sub)]">First 250 assets shown in this browser preview. The formal report pack contains the authoritative dataset.</p> : null}
        </section>
        <section className="border-b border-[var(--border)] py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">Commissioning records</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">{completedForms.length} completed field forms{completedFormNames.length ? `: ${completedFormNames.join(', ')}.` : '.'}</p>
          <p className={`mt-3 text-sm font-bold ${openTbc ? 'text-[var(--amber)]' : 'text-[var(--green)]'}`}>{openTbc ? `${openTbc} relationship${openTbc === 1 ? '' : 's'} remain to be confirmed.` : 'All recorded relationships are confirmed.'}</p>
        </section>
        <section className="py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">Selected evidence</h2>
          <p className="mt-2 text-sm text-[var(--text-sub)]">{includedPhotos.length} of {photos.length} available photos included.</p>
          {includedPhotos.length ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{includedPhotos.map((photo) => <figure key={photo.key}><PhotoThumb app="installhub" uri={photo.uri} label={photo.label} className="h-40 w-full rounded-xl object-cover print:h-32" /><figcaption className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{photo.label}</figcaption></figure>)}</div> : <p className="mt-4 text-sm text-[var(--text-sub)]">No evidence selected for this preview.</p>}
        </section>
      </article>
      <div className="mt-5 flex justify-end print:hidden"><LinkButton href={`/installhub/installations/${installationId}/report`}>Generate formal report pack<Icon name="arrow-right" size={17} /></LinkButton></div>
    </div>
  );
}
