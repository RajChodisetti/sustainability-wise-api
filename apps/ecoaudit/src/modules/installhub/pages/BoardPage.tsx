'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed editor from its server query record */

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
import { createBoard, nowIso } from '@/modules/installhub/lib/model';
import { BOARD_TYPES, type ElectricalAsset } from '@/modules/installhub/types/domain';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import { useToast } from '@/contexts/ToastContext';

export function InstallHubBoardPage({ mode }: { mode: 'new' | 'edit' }) {
  const { installationId, zoneId, boardId } = useParams<{
    installationId: string;
    zoneId: string;
    boardId?: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<ElectricalAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const source = query.data?.electricalAssets.find((item) => item.id === boardId);
  useEffect(() => {
    if (mode === 'new') {
      setDraft((current) => current ?? createBoard(installationId, zoneId));
    } else if (source) {
      setDraft(structuredClone(source));
    }
  }, [installationId, mode, source, zoneId]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (mode === 'edit' && !source) return <ErrorBanner message="Switchboard not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  if (!zone) return <ErrorBanner message="Zone not found." />;
  const saved = mode === 'edit';
  const currentDraft = draft;
  const availableParents = tree.electricalAssets.filter((item) => item.id !== boardId);
  const forms = tree.formSubmissions.filter((item) => item.boardId === boardId);

  function set<K extends keyof ElectricalAsset>(key: K, value: ElectricalAsset[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!currentDraft.assetName.trim() || !currentDraft.displayCode.trim()) {
      toast.error('Board name and display code are required.');
      return;
    }
    setBusy(true);
    try {
      await writer.mutate((next) => {
        const value: ElectricalAsset = {
          ...structuredClone(currentDraft),
          assetName: currentDraft.assetName.trim(),
          displayCode: currentDraft.displayCode.trim(),
          electricalParentId: currentDraft.electricalParentTbc ? null : currentDraft.electricalParentId || null,
          updatedAt: nowIso(),
        };
        const index = next.electricalAssets.findIndex((item) => item.id === value.id);
        if (index >= 0) next.electricalAssets[index] = value;
        else next.electricalAssets.push(value);
      });
      toast.success(saved ? 'Switchboard saved.' : 'Switchboard created.');
      if (!saved) {
        router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${currentDraft.id}`);
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadMain(files: File[]) {
    const file = files[0];
    if (!file || !boardId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) throw new Error('Switchboard not found.');
        target.photo = await uploadInstallationPhoto(next, {
          installationId,
          entityType: 'electrical_asset',
          entityId: boardId,
          fieldName: 'photo',
        }, file);
        target.updatedAt = nowIso();
      });
      toast.success('Switchboard photo uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (!boardId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) throw new Error('Switchboard not found.');
        for (const file of files) {
          const index = target.extraPhotos.length;
          const uri = await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'electrical_asset',
            entityId: boardId,
            fieldName: `extraPhotos[${index}]`,
          }, file);
          target.extraPhotos.push(uri);
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

  async function removePhoto(kind: 'main' | 'extra', id?: string) {
    try {
      await writer.mutate((next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) return;
        if (kind === 'main') target.photo = null;
        else {
          const photoIndex = Number(id);
          if (!Number.isInteger(photoIndex)) return;
          target.extraPhotos = target.extraPhotos.filter(
            (_, index) => index !== photoIndex,
          );
        }
        target.updatedAt = nowIso();
      });
      toast.success('Photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeBoard() {
    if (!boardId || !confirm(`Delete ${currentDraft.assetName} and its meters and forms?`)) return;
    try {
      await writer.mutate((next) => {
        const meterIds = new Set(
          next.electricalAssets.find((item) => item.id === boardId)?.meters.map((item) => item.id) ?? [],
        );
        next.electricalAssets = next.electricalAssets.filter((item) => item.id !== boardId);
        next.electricalAssets = next.electricalAssets.map((item) => ({
          ...item,
          electricalParentId: item.electricalParentId === boardId ? null : item.electricalParentId,
          electricalParentTbc:
            item.electricalParentTbc || item.electricalParentId === boardId,
        }));
        next.siteAssets = next.siteAssets.map((item) => ({
          ...item,
          electricalBoardId: item.electricalBoardId === boardId ? null : item.electricalBoardId,
          electricalBoardTbc:
            item.electricalBoardTbc || item.electricalBoardId === boardId,
          meterSwitchboardId: item.meterSwitchboardId === boardId ? null : item.meterSwitchboardId,
          meterSwitchboardTbc:
            item.meterSwitchboardTbc ||
            (item.meterPresent && item.meterSwitchboardId === boardId),
        }));
        next.formSubmissions = next.formSubmissions.filter(
          (item) => item.boardId !== boardId && !meterIds.has(item.meterId ?? ''),
        );
      });
      toast.success('Switchboard deleted.');
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  const latest = query.data!.electricalAssets.find((item) => item.id === boardId) ?? draft;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone.zoneName, href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: mode === 'new' ? 'New switchboard' : draft.assetName || 'Switchboard' },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New switchboard' : draft.assetName || 'Switchboard'}
        subtitle="Electrical hierarchy, installed Wattwatcher meters, and switchboard evidence."
        actions={saved ? (
          <>
            <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&boardId=${boardId}`} variant="secondary">
              <Icon name="clipboard" size={17} />New field form
            </LinkButton>
            <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/new`}>
              <Icon name="plus" size={17} />Add meter
            </LinkButton>
            <Button variant="danger" onClick={() => void removeBoard()}>Delete</Button>
          </>
        ) : undefined}
      />

      <form onSubmit={(event) => void save(event)}>
        <Card className="mb-5">
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel>Board name *</FieldLabel>
              <Input value={draft.assetName} required onChange={(event) => set('assetName', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Display code *</FieldLabel>
              <Input value={draft.displayCode} required onChange={(event) => set('displayCode', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Board type *</FieldLabel>
              <Select value={draft.assetType} onChange={(event) => set('assetType', event.target.value as ElectricalAsset['assetType'])}>
                {BOARD_TYPES.map((value) => <option key={value}>{value}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Parent switchboard</FieldLabel>
              <Select
                value={draft.electricalParentId ?? ''}
                disabled={draft.electricalParentTbc}
                onChange={(event) => set('electricalParentId', event.target.value || null)}
              >
                <option value="">No parent / incoming supply</option>
                {availableParents.map((board) => <option key={board.id} value={board.id}>{board.displayCode} — {board.assetName}</option>)}
              </Select>
              <Checkbox
                label="Parent relationship to be confirmed (TBC)"
                checked={draft.electricalParentTbc}
                onChange={(checked) => {
                  set('electricalParentTbc', checked);
                  if (checked) set('electricalParentId', null);
                }}
              />
            </div>
            <div>
              <FieldLabel>Location description</FieldLabel>
              <Input value={draft.locationDescription ?? ''} onChange={(event) => set('locationDescription', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Site NMI</FieldLabel>
              <Input value={draft.siteNmi ?? ''} onChange={(event) => set('siteNmi', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Phase</FieldLabel>
              <Input value={draft.phase ?? ''} onChange={(event) => set('phase', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Amperage rating</FieldLabel>
              <Input value={draft.amperageRating ?? ''} onChange={(event) => set('amperageRating', event.target.value)} />
            </div>
          </div>
          <FieldLabel>Sub-circuits description</FieldLabel>
          <Textarea value={draft.subCircuitsDescription ?? ''} onChange={(event) => set('subCircuitsDescription', event.target.value)} />
          <FieldLabel>Comments</FieldLabel>
          <Textarea value={draft.comments ?? ''} onChange={(event) => set('comments', event.target.value)} />
          <Checkbox label="Meter present" checked={draft.meterPresent || draft.meters.length > 0} onChange={(checked) => set('meterPresent', checked)} />
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save switchboard'}</Button>
            <Button variant="secondary" onClick={() => router.back()} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </form>

      {!saved ? (
        <InlineNotice>Save the switchboard first, then add meter records, evidence, and field forms.</InlineNotice>
      ) : (
        <>
          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[var(--text)]">Meters</h2>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">Device identity, channels, verification, and commissioning.</p>
                </div>
                <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/new`}><Icon name="plus" size={16} />Add</LinkButton>
              </div>
              {latest.meters.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No meters installed.</p> : (
                <div className="space-y-2">
                  {latest.meters.map((meter) => (
                    <Link key={meter.id} href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/${meter.id}`} className="flex min-h-12 items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                      <span>
                        <span className="block text-sm font-bold text-[var(--text)]">{meter.deviceName}</span>
                        <span className="block text-xs text-[var(--text-sub)]">{meter.deviceType} · {meter.deviceId || 'No device ID'} · {meter.wwChannels?.length ?? 0} channels</span>
                      </span>
                      <Icon name="chevron-right" size={17} className="text-[var(--muted)]" />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[var(--text)]">Field forms</h2>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">Installation, ACE, and device fault records.</p>
                </div>
                <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&boardId=${boardId}`}><Icon name="plus" size={16} />Start</LinkButton>
              </div>
              {forms.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No forms linked to this board.</p> : (
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
          </div>
          <Card>
            <h2 className="font-extrabold text-[var(--text)]">Switchboard evidence</h2>
            <EvidenceField
              label="Main switchboard photo"
              items={latest.photo ? [{ id: 'main', uri: latest.photo }] : []}
              busy={uploading}
              onFiles={uploadMain}
              onRemove={latest.photo ? () => removePhoto('main') : undefined}
            />
            <EvidenceField
              label="Extra photos"
              items={latest.extraPhotos.map((uri, index) => ({ id: `${index}`, uri }))}
              busy={uploading}
              onFiles={uploadExtra}
              onRemove={latest.extraPhotos.length ? (id) => removePhoto('extra', id) : undefined}
            />
          </Card>
        </>
      )}
    </div>
  );
}
