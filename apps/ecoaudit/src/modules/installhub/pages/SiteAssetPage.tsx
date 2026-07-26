'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed asset editor from its server query record */

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice } from '@/modules/installhub/components/InstallHubUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createSiteAsset, nowIso } from '@/modules/installhub/lib/model';
import { SITE_ASSET_TYPES, type SiteAsset } from '@/modules/installhub/types/domain';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import { useToast } from '@/contexts/ToastContext';

export function InstallHubSiteAssetPage({ mode }: { mode: 'new' | 'edit' }) {
  const { installationId, zoneId, assetId } = useParams<{
    installationId: string;
    zoneId: string;
    assetId?: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<SiteAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const source = query.data?.siteAssets.find((item) => item.id === assetId);
  useEffect(() => {
    if (mode === 'new') {
      setDraft((current) => current ?? createSiteAsset(installationId, zoneId));
    } else if (source) {
      setDraft(structuredClone(source));
    }
  }, [assetId, installationId, mode, source, zoneId]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (mode === 'edit' && !source) return <ErrorBanner message="Site asset not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  if (!zone) return <ErrorBanner message="Zone not found." />;
  const saved = mode === 'edit';
  const currentDraft = draft;
  const forms = tree.formSubmissions.filter((item) => item.siteAssetId === assetId);

  function set<K extends keyof SiteAsset>(key: K, value: SiteAsset[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!currentDraft.assetName.trim()) {
      toast.error('Asset name is required.');
      return;
    }
    setBusy(true);
    try {
      await writer.mutate((next) => {
        const value: SiteAsset = {
          ...structuredClone(currentDraft),
          assetName: currentDraft.assetName.trim(),
          electricalBoardId: currentDraft.electricalBoardTbc ? null : currentDraft.electricalBoardId || null,
          meterSwitchboardId: currentDraft.meterSwitchboardTbc ? null : currentDraft.meterSwitchboardId || null,
          updatedAt: nowIso(),
        };
        const index = next.siteAssets.findIndex((item) => item.id === value.id);
        if (index >= 0) next.siteAssets[index] = value;
        else next.siteAssets.push(value);
      });
      toast.success(saved ? 'Site asset saved.' : 'Site asset created.');
      if (!saved) {
        router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/assets/${currentDraft.id}`);
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLocation(files: File[]) {
    const file = files[0];
    if (!file || !assetId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.siteAssets.find((item) => item.id === assetId);
        if (!target) throw new Error('Site asset not found.');
        target.locationPhoto = await uploadInstallationPhoto(next, {
          installationId,
          entityType: 'site_asset',
          entityId: assetId,
          fieldName: 'locationPhoto',
        }, file);
        target.updatedAt = nowIso();
      });
      toast.success('Location photo uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (!assetId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.siteAssets.find((item) => item.id === assetId);
        if (!target) throw new Error('Site asset not found.');
        for (const file of files) {
          const index = target.extraPhotos.length;
          target.extraPhotos.push(await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'site_asset',
            entityId: assetId,
            fieldName: `extraPhotos[${index}]`,
          }, file));
        }
        target.updatedAt = nowIso();
      });
      toast.success(`${files.length} evidence photo${files.length === 1 ? '' : 's'} uploaded.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(kind: 'location' | 'extra') {
    try {
      await writer.mutate((next) => {
        const target = next.siteAssets.find((item) => item.id === assetId);
        if (!target) return;
        if (kind === 'location') target.locationPhoto = null;
        else target.extraPhotos.pop();
        target.updatedAt = nowIso();
      });
      toast.success('Photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeAsset() {
    if (!assetId || !confirm(`Delete ${currentDraft.assetName} and its linked forms?`)) return;
    try {
      await writer.mutate((next) => {
        next.siteAssets = next.siteAssets.filter((item) => item.id !== assetId);
        next.formSubmissions = next.formSubmissions.filter((item) => item.siteAssetId !== assetId);
      });
      toast.success('Site asset deleted.');
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  const latest = query.data!.siteAssets.find((item) => item.id === assetId) ?? draft;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone.zoneName, href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: mode === 'new' ? 'New site asset' : draft.assetName || 'Site asset' },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New site asset' : draft.assetName || 'Site asset'}
        subtitle="Equipment identity, electrical and metering relationships, channels, and evidence."
        actions={saved ? (
          <>
            <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&siteAssetId=${assetId}`}>
              <Icon name="clipboard" size={17} />New field form
            </LinkButton>
            <Button variant="danger" onClick={() => void removeAsset()}>Delete</Button>
          </>
        ) : undefined}
      />

      <form onSubmit={(event) => void save(event)}>
        <Card className="mb-5">
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel>Asset name *</FieldLabel>
              <Input required value={draft.assetName} onChange={(event) => set('assetName', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Asset type *</FieldLabel>
              <Select value={draft.assetType} onChange={(event) => set('assetType', event.target.value as SiteAsset['assetType'])}>
                {SITE_ASSET_TYPES.map((value) => <option key={value}>{value}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Display code</FieldLabel>
              <Input value={draft.displayCode ?? ''} onChange={(event) => set('displayCode', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Location description</FieldLabel>
              <Input value={draft.locationDescription ?? ''} onChange={(event) => set('locationDescription', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Electrical board</FieldLabel>
              <Select
                value={draft.electricalBoardId ?? ''}
                disabled={draft.electricalBoardTbc}
                onChange={(event) => set('electricalBoardId', event.target.value || null)}
              >
                <option value="">Not connected</option>
                {tree.electricalAssets.map((board) => <option key={board.id} value={board.id}>{board.displayCode} — {board.assetName}</option>)}
              </Select>
              <Checkbox
                label="Electrical board to be confirmed (TBC)"
                checked={draft.electricalBoardTbc}
                onChange={(checked) => {
                  set('electricalBoardTbc', checked);
                  if (checked) set('electricalBoardId', null);
                }}
              />
            </div>
            <div>
              <FieldLabel>Meter switchboard</FieldLabel>
              <Select
                value={draft.meterSwitchboardId ?? ''}
                disabled={draft.meterSwitchboardTbc}
                onChange={(event) => set('meterSwitchboardId', event.target.value || null)}
              >
                <option value="">No meter switchboard</option>
                {tree.electricalAssets.map((board) => <option key={board.id} value={board.id}>{board.displayCode} — {board.assetName}</option>)}
              </Select>
              <Checkbox
                label="Meter relationship to be confirmed (TBC)"
                checked={draft.meterSwitchboardTbc}
                onChange={(checked) => {
                  set('meterSwitchboardTbc', checked);
                  if (checked) set('meterSwitchboardId', null);
                }}
              />
            </div>
          </div>
          <Checkbox label="Meter present" checked={draft.meterPresent} onChange={(checked) => set('meterPresent', checked)} />

          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-extrabold text-[var(--text)]">Meter channels</h2>
                <p className="mt-1 text-xs text-[var(--text-sub)]">Map one or more switchboard channels to this asset.</p>
              </div>
              <Button variant="secondary" onClick={() => set('meterChannels', [...draft.meterChannels, { channel: '', description: '' }])}>
                <Icon name="plus" size={16} />Add channel
              </Button>
            </div>
            {draft.meterChannels.map((channel, index) => (
              <div key={index} className="mt-3 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 sm:grid-cols-[10rem_1fr_auto]">
                <Input
                  aria-label={`Channel ${index + 1}`}
                  placeholder="Channel"
                  value={channel.channel}
                  onChange={(event) => {
                    const next = [...draft.meterChannels];
                    next[index] = { ...channel, channel: event.target.value };
                    set('meterChannels', next);
                  }}
                />
                <Input
                  aria-label={`Channel ${index + 1} description`}
                  placeholder="Description"
                  value={channel.description}
                  onChange={(event) => {
                    const next = [...draft.meterChannels];
                    next[index] = { ...channel, description: event.target.value };
                    set('meterChannels', next);
                  }}
                />
                <Button
                  variant="ghost"
                  className="text-[var(--red)]"
                  aria-label={`Remove channel ${index + 1}`}
                  onClick={() => set('meterChannels', draft.meterChannels.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Icon name="trash" size={17} />
                </Button>
              </div>
            ))}
          </div>

          <FieldLabel>Comments</FieldLabel>
          <Textarea value={draft.comments ?? ''} onChange={(event) => set('comments', event.target.value)} />
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save site asset'}</Button>
            <Button variant="secondary" onClick={() => router.back()} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </form>

      {!saved ? (
        <InlineNotice>Save the site asset first, then add evidence and water/logger field forms.</InlineNotice>
      ) : (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-extrabold text-[var(--text)]">Field forms</h2>
                <p className="mt-1 text-xs text-[var(--text-sub)]">Honeywell, Captis, and SUMS installation records.</p>
              </div>
              <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&siteAssetId=${assetId}`}><Icon name="plus" size={16} />Start form</LinkButton>
            </div>
            {forms.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No forms linked to this asset.</p> : (
              <div className="space-y-2">
                {forms.map((form) => (
                  <Link key={form.id} href={`/installhub/installations/${installationId}/forms/${form.id}`} className="flex min-h-12 items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                    <span>
                      <span className="block text-sm font-bold text-[var(--text)]">{FORM_DEFINITION_BY_TYPE[form.formType]?.shortTitle ?? form.formType}</span>
                      <span className="block text-xs text-[var(--text-sub)]">{form.status} · {form.attachments.length} attachments</span>
                    </span>
                    <Icon name="chevron-right" size={17} className="text-[var(--muted)]" />
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <h2 className="font-extrabold text-[var(--text)]">Site asset evidence</h2>
            <EvidenceField
              label="Location photo"
              items={latest.locationPhoto ? [{ id: 'location', uri: latest.locationPhoto }] : []}
              busy={uploading}
              onFiles={uploadLocation}
              onRemoveLast={latest.locationPhoto ? () => removePhoto('location') : undefined}
            />
            <EvidenceField
              label="Extra photos"
              items={latest.extraPhotos.map((uri, index) => ({ id: `${index}`, uri }))}
              busy={uploading}
              onFiles={uploadExtra}
              onRemoveLast={latest.extraPhotos.length ? () => removePhoto('extra') : undefined}
            />
          </Card>
        </>
      )}
    </div>
  );
}
