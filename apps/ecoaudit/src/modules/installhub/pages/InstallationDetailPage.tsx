'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { deleteCloudInstallation } from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import {
  Breadcrumbs,
  DefinitionList,
  WorkspaceLink,
} from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';

export function InstallHubInstallationDetailPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const { user } = useInstallHubAuth();

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Installation not found." />;

  const tree = query.data;
  const installation = tree.installation;
  const canDelete =
    user?.role === 'admin' ||
    Boolean(user?.id && installation.createdByUserId === user.id);
  const meters = tree.electricalAssets.reduce((total, board) => total + board.meters.length, 0);
  const evidenceCount =
    tree.zones.reduce((total, zone) => total + zone.photos.length, 0) +
    tree.electricalAssets.reduce(
      (total, board) =>
        total +
        (board.photo ? 1 : 0) +
        board.extraPhotos.length +
        board.meters.reduce(
          (meterTotal, meter) =>
            meterTotal +
            (meter.wwPhotos?.deviceInstalled ? 1 : 0) +
            (meter.wwPhotos?.switchboardOverview ? 1 : 0) +
            (meter.wwPhotos?.labeling ? 1 : 0) +
            (meter.wwPhotos?.extra?.length ?? 0),
          0,
        ),
      0,
    ) +
    tree.siteAssets.reduce(
      (total, asset) => total + (asset.locationPhoto ? 1 : 0) + asset.extraPhotos.length,
      0,
    ) +
    tree.formSubmissions.reduce((total, form) => total + form.attachments.length, 0);

  async function toggleStatus() {
    try {
      await writer.mutate((next) => {
        next.installation.status =
          next.installation.status === 'Completed' ? 'Draft' : 'Completed';
      });
      toast.success(
        installation.status === 'Completed'
          ? 'Installation reopened.'
          : 'Installation marked as completed.',
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeInstallation() {
    const confirmation = window.prompt(
      `Permanently delete ${installation.siteName} from InstallHub Cloud Backup?\n\nThis removes its forms, unshared originals, generated reports, and version history. Existing iOS cpN copies remain on their devices but lose this server source.\n\nType the site name to confirm.`,
    );
    if (confirmation !== installation.siteName) {
      if (confirmation !== null) {
        toast.info('Site name did not match. Nothing was deleted.');
      }
      return;
    }
    try {
      await deleteCloudInstallation(installationId, true);
      toast.success('Cloud installation permanently deleted.');
      router.replace('/installhub/installations');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: installation.siteName },
      ]} />
      <PageHeader
        title={installation.siteName}
        subtitle={`${installation.clientName} · ${installation.siteAddress}`}
        actions={
          <>
            <StatusBadge status={installation.status} />
            <LinkButton href={`/installhub/installations/${installationId}/edit`} variant="secondary">Edit</LinkButton>
            <Button variant="secondary" onClick={() => void writer.refresh()}><Icon name="refresh" size={17} />Refresh</Button>
            <Button onClick={() => void toggleStatus()}>
              {installation.status === 'Completed' ? 'Reopen' : 'Complete'}
            </Button>
            {canDelete ? (
              <Button variant="danger" onClick={() => void removeInstallation()}>
                Delete from cloud
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-6">
        <DefinitionList items={[
          { label: 'Installer', value: installation.inspectorName },
          { label: 'Date', value: installation.auditDate },
          { label: 'Zones', value: tree.zones.length },
          { label: 'Switchboards', value: tree.electricalAssets.length },
          { label: 'Site assets', value: tree.siteAssets.length },
          { label: 'Meters', value: meters },
        ]} />
      </Card>

      <section className="mb-7" aria-labelledby="installhub-workspace">
        <h2 id="installhub-workspace" className="mb-3 text-lg font-extrabold text-[var(--text)]">Installation workspace</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <WorkspaceLink href={`/installhub/installations/${installationId}/zones`} icon="building" title="Zones & assets" description="Zones, switchboards, meters, and site assets." count={tree.zones.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/forms`} icon="clipboard" title="Field forms" description="Six current workflows plus legacy form history." count={tree.formSubmissions.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/data`} icon="grid" title="Data view" description="Review hierarchy and resolve TBC relationships." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/metering`} icon="gauge" title="Metering table" description="Meter devices, channels, and coverage." count={meters} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/photos`} icon="camera" title="Photo gallery" description="All installation and form evidence." count={evidenceCount} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/report`} icon="file-text" title="Report pack" description="Generate and download server PDF packs." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/client-report`} icon="eye" title="Client report" description="Client-facing installation summary and readiness." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/cloud`} icon="cloud" title="Cloud files & history" description="Stored originals, PDFs, and version snapshots." />
          {user?.role === 'admin' ? (
            <WorkspaceLink href={`/installhub/installations/${installationId}/access`} icon="users" title="Access" description="View or manage inspector assignment." />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="installation-zones">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="installation-zones" className="text-lg font-extrabold text-[var(--text)]">Zones</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Open a zone to manage its boards, meters, and assets.</p>
          </div>
          <LinkButton href={`/installhub/installations/${installationId}/zones/new`}>
            <Icon name="plus" size={17} />Add zone
          </LinkButton>
        </div>
        {tree.zones.length === 0 ? (
          <EmptyState title="No zones yet" description="Add a zone to start mapping the installation." icon="building" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {tree.zones.map((zone) => {
              const boards = tree.electricalAssets.filter((item) => item.zoneId === zone.id).length;
              const assets = tree.siteAssets.filter((item) => item.zoneId === zone.id).length;
              return (
                <Link key={zone.id} href={`/installhub/installations/${installationId}/zones/${zone.id}`} className="block">
                  <Card className="interactive-card h-full">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-[var(--text)]">{zone.zoneName}</p>
                        <p className="mt-1 text-sm text-[var(--text-sub)]">{zone.zoneDescription || 'No description'}</p>
                        <p className="mt-3 text-xs font-semibold text-[var(--muted)]">{boards} boards · {assets} assets · {zone.photos.length} photos</p>
                      </div>
                      <Icon name="chevron-right" size={18} className="text-[var(--muted)]" />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
