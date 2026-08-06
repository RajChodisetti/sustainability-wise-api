'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import {
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import { createDeviceCommissioningForm } from '@/modules/installhub/lib/deviceSearch';
import { useToast } from '@/contexts/ToastContext';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import {
  assetMeterReturnHref,
  assetMeterReturnRequest,
} from '@/modules/installhub/lib/electricalPresentation';

export function InstallHubNewMeterPage() {
  const { installationId, zoneId, boardId } = useParams<{
    installationId: string;
    zoneId: string;
    boardId: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const { user } = useInstallHubAuth();
  const router = useRouter();
  const toast = useToast();
  const activeRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const board = query.data?.electricalAssets.find(
    (item) => item.id === boardId && item.zoneId === zoneId,
  );

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  async function startWattwatchersForm() {
    if (!query.data || !user || !board || busy) return;
    setBusy(true);
    setError(null);
    let formId = '';
    try {
      await writer.mutate((next) => {
        const form = createDeviceCommissioningForm(next, user, {
          zoneId,
          boardId,
        });
        formId = form.id;
      }, 'metadata');
      if (!activeRef.current) return;
      toast.success('Full device installation form created.');
      const returnQuery = window.location.search;
      router.replace(
        `/installhub/installations/${encodeURIComponent(installationId)}/forms/${encodeURIComponent(formId)}${returnQuery}`,
      );
    } catch (cause) {
      if (!activeRef.current) return;
      setError(installHubConnectionErrorMessage(cause));
      setBusy(false);
    }
  }

  function openOtherMeter() {
    const returnQuery = window.location.search;
    router.push(
      `/installhub/installations/${encodeURIComponent(installationId)}/zones/${encodeURIComponent(zoneId)}/boards/${encodeURIComponent(boardId)}/meters/new/other${returnQuery}`,
    );
  }

  function returnToParent() {
    const request = assetMeterReturnRequest(new URLSearchParams(window.location.search));
    router.replace(request
      ? assetMeterReturnHref(installationId, request)
      : `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`);
  }

  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (query.data && !board) {
    return <ErrorBanner message="Switchboard not found." />;
  }
  if (!query.data || !board) return <Spinner />;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: query.data.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: query.data.zones.find((item) => item.id === zoneId)?.zoneName || 'Zone', href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: board.assetName, href: `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}` },
        { label: 'Add meter' },
      ]} />
      <PageHeader
        title="Add a meter"
        subtitle="Choose the correct workflow so the saved device record contains the production fields it needs."
      />
      {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}
      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        <Card className="flex h-full flex-col">
          <h2 className="text-lg font-extrabold text-[var(--text)]">Wattwatchers A3RM or A6M</h2>
          <p className="mt-2 flex-1 text-sm text-[var(--text-sub)]">
            Open the full production installation form, including safety, switchboard, channel, verification, commissioning, and evidence fields.
          </p>
          <Button className="mt-5" disabled={busy || !user} onClick={() => void startWattwatchersForm()}>
            {busy ? 'Opening form…' : 'Open full installation form'}
          </Button>
        </Card>
        <Card className="flex h-full flex-col">
          <h2 className="text-lg font-extrabold text-[var(--text)]">Other meter</h2>
          <p className="mt-2 flex-1 text-sm text-[var(--text-sub)]">
            Record an editable device name and number, manufacturer, model, serial, classification, coverage, and custom channel capabilities.
          </p>
          <Button className="mt-5" variant="secondary" disabled={busy} onClick={openOtherMeter}>
            Add other meter
          </Button>
        </Card>
      </div>
      <Button className="mt-5" variant="secondary" disabled={busy} onClick={returnToParent}>
        Cancel
      </Button>
    </div>
  );
}
