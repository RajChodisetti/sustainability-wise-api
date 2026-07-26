'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the keyed meter editor from its server query record */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Checkbox, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, InlineNotice } from '@/modules/installhub/components/InstallHubUi';
import { ScannerInput } from '@/modules/installhub/components/ScannerInput';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createMeter, nowIso } from '@/modules/installhub/lib/model';
import type {
  Meter,
  WattwatcherCommissioning,
  WattwatcherPrestart,
  WattwatcherSwitchboard,
  WattwatcherVerification,
} from '@/modules/installhub/types/domain';
import { useToast } from '@/contexts/ToastContext';

const prestartQuestions: Array<[keyof WattwatcherPrestart, string]> = [
  ['siteInduction', 'Site induction required?'],
  ['safeAccess', 'Safe access?'],
  ['correctPpe', 'Correct PPE?'],
  ['livePointsAware', 'Aware of LIVE points?'],
  ['canIsolate', 'Can isolate power?'],
  ['additionalHazards', 'Additional hazards?'],
  ['safeToProceed', 'Safe to proceed?'],
];
const verificationQuestions: Array<[keyof WattwatcherVerification, string]> = [
  ['voltageChecked', 'Voltage checked'],
  ['polarityChecked', 'Polarity checked'],
  ['communicationsOk', 'Communications confirmed'],
];
const commissioningQuestions: Array<[keyof WattwatcherCommissioning, string]> = [
  ['deviceOnline', 'Device online'],
  ['channelsReporting', 'Channels reporting'],
  ['labeled', 'Device and channels labeled'],
  ['photosTaken', 'Commissioning photos taken'],
];
const CHANNEL_PURPOSES = [
  'MAIN_SUPPLY',
  'SUB_CIRCUIT',
  'SPARE',
] as const;
const LOAD_TYPES = [
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
  'Not Used',
] as const;
const ROGOWSKI_SIZES = [
  '3000A - 9cm',
  '3000A - 20cm',
  '3000A - 29cm',
] as const;
const CT_RATINGS = ['60A', '120A', '200A', '400A', '600A'] as const;

function withLegacyOption(
  options: readonly string[],
  current?: string,
): string[] {
  if (!current || options.includes(current)) return [...options];
  return [current, ...options];
}

export function InstallHubMeterPage({ mode }: { mode: 'new' | 'edit' }) {
  const { installationId, zoneId, boardId, meterId } = useParams<{
    installationId: string;
    zoneId: string;
    boardId: string;
    meterId?: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Meter | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const board = query.data?.electricalAssets.find((item) => item.id === boardId);
  const source = board?.meters.find((item) => item.id === meterId);
  useEffect(() => {
    if (mode === 'new') setDraft((current) => current ?? createMeter());
    else if (source) setDraft(structuredClone(source));
  }, [mode, source]);

  if (query.isLoading || !draft) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!board) return <ErrorBanner message="Switchboard not found." />;
  if (mode === 'edit' && !source) return <ErrorBanner message="Meter not found." />;
  const tree = query.data!;
  const zone = tree.zones.find((item) => item.id === zoneId);
  const saved = mode === 'edit';
  const currentDraft = draft;
  const latestBoard = tree.electricalAssets.find((item) => item.id === boardId)!;
  const latest = latestBoard.meters.find((item) => item.id === meterId) ?? draft;

  function set<K extends keyof Meter>(key: K, value: Meter[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function setPrestart(key: keyof WattwatcherPrestart, value: boolean) {
    set('wwPrestart', { ...currentDraft.wwPrestart, [key]: value });
  }

  function setSwitchboard(key: keyof WattwatcherSwitchboard, value: string) {
    set('wwSwitchboard', { ...currentDraft.wwSwitchboard, [key]: value });
  }

  function setVerification(key: keyof WattwatcherVerification, value: boolean | string) {
    set('wwVerification', { ...currentDraft.wwVerification, [key]: value });
  }

  function setCommissioning(key: keyof WattwatcherCommissioning, value: boolean | string) {
    set('wwCommissioning', { ...currentDraft.wwCommissioning, [key]: value });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!currentDraft.deviceName.trim() || !currentDraft.deviceId.trim()) {
      toast.error('Device name and Device ID are required.');
      return;
    }
    setBusy(true);
    try {
      await writer.mutate((next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const value = structuredClone(currentDraft);
        const index = targetBoard.meters.findIndex((item) => item.id === value.id);
        if (index >= 0) targetBoard.meters[index] = value;
        else targetBoard.meters.push(value);
        targetBoard.meterPresent = true;
        targetBoard.updatedAt = nowIso();
      });
      toast.success(saved ? 'Meter saved.' : 'Meter added.');
      if (!saved) {
        router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}/meters/${currentDraft.id}`);
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadSingle(
    slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling',
    files: File[],
  ) {
    const file = files[0];
    if (!file || !meterId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const meterIndex = targetBoard.meters.findIndex((item) => item.id === meterId);
        if (meterIndex < 0) throw new Error('Meter not found.');
        const targetMeter = targetBoard.meters[meterIndex];
        targetMeter.wwPhotos = targetMeter.wwPhotos ?? { extra: [] };
        targetMeter.wwPhotos[slot] = await uploadInstallationPhoto(next, {
          installationId,
          entityType: 'electrical_asset',
          entityId: boardId,
          fieldName: `meters[${meterIndex}].wwPhotos.${slot}`,
        }, file);
        targetBoard.updatedAt = nowIso();
      });
      toast.success('Meter evidence uploaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function uploadExtra(files: File[]) {
    if (!meterId) return;
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const targetBoard = next.electricalAssets.find((item) => item.id === boardId);
        if (!targetBoard) throw new Error('Switchboard not found.');
        const meterIndex = targetBoard.meters.findIndex((item) => item.id === meterId);
        if (meterIndex < 0) throw new Error('Meter not found.');
        const targetMeter = targetBoard.meters[meterIndex];
        targetMeter.wwPhotos = targetMeter.wwPhotos ?? { extra: [] };
        targetMeter.wwPhotos.extra = targetMeter.wwPhotos.extra ?? [];
        for (const file of files) {
          const photoIndex = targetMeter.wwPhotos.extra.length;
          targetMeter.wwPhotos.extra.push(await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'electrical_asset',
            entityId: boardId,
            fieldName: `meters[${meterIndex}].wwPhotos.extra[${photoIndex}]`,
          }, file));
        }
        targetBoard.updatedAt = nowIso();
      });
      toast.success(`${files.length} meter photo${files.length === 1 ? '' : 's'} uploaded.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling' | 'extra') {
    try {
      await writer.mutate((next) => {
        const target = next.electricalAssets
          .find((item) => item.id === boardId)
          ?.meters.find((item) => item.id === meterId);
        if (!target?.wwPhotos) return;
        if (slot === 'extra') target.wwPhotos.extra?.pop();
        else target.wwPhotos[slot] = null;
      });
      toast.success('Meter photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeMeter() {
    if (!meterId || !confirm(`Delete ${currentDraft.deviceName} and linked fault forms?`)) return;
    try {
      await writer.mutate((next) => {
        const target = next.electricalAssets.find((item) => item.id === boardId);
        if (!target) return;
        target.meters = target.meters.filter((item) => item.id !== meterId);
        target.meterPresent = target.meters.length > 0;
        target.updatedAt = nowIso();
        next.formSubmissions = next.formSubmissions.filter((item) => item.meterId !== meterId);
      });
      toast.success('Meter deleted.');
      router.replace(`/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  const photoFields: Array<{
    slot: 'deviceInstalled' | 'switchboardOverview' | 'labeling';
    label: string;
  }> = [
    { slot: 'deviceInstalled', label: 'Installed device' },
    { slot: 'switchboardOverview', label: 'Switchboard overview' },
    { slot: 'labeling', label: 'Device and channel labeling' },
  ];

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: zone?.zoneName ?? 'Zone', href: `/installhub/installations/${installationId}/zones/${zoneId}` },
        { label: board.assetName, href: `/installhub/installations/${installationId}/zones/${zoneId}/boards/${boardId}` },
        { label: mode === 'new' ? 'New meter' : draft.deviceName },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New Wattwatcher meter' : draft.deviceName}
        subtitle="Device identity, safety, switchboard, channels, verification, commissioning, and evidence."
        actions={saved ? (
          <>
            <LinkButton href={`/installhub/installations/${installationId}/forms/new?zoneId=${zoneId}&boardId=${boardId}&meterId=${meterId}`}>
              <Icon name="tool" size={17} />Comms fault form
            </LinkButton>
            <Button variant="danger" onClick={() => void removeMeter()}>Delete</Button>
          </>
        ) : undefined}
      />

      <form onSubmit={(event) => void save(event)} className="space-y-5">
        <Card>
          <h2 className="font-extrabold text-[var(--text)]">Device identity</h2>
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel>Device name *</FieldLabel>
              <Input value={draft.deviceName} required onChange={(event) => set('deviceName', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Device type *</FieldLabel>
              <Select
                value={draft.deviceType}
                onChange={(event) => {
                  const type = event.target.value as Meter['deviceType'];
                  set('deviceType', type);
                  if (type === 'A3RM' || type === 'A6M') {
                    const count = type === 'A3RM' ? 3 : 6;
                    set('wwChannels', Array.from({ length: count }, (_, index) => draft.wwChannels?.[index] ?? {}));
                  }
                }}
              >
                <option>A3RM</option>
                <option>A6M</option>
                <option>Other</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Device ID / serial *</FieldLabel>
              <ScannerInput value={draft.deviceId} onChange={(value) => set('deviceId', value)} modes={['barcode', 'qr']} />
            </div>
            <div>
              <FieldLabel>Device number</FieldLabel>
              <ScannerInput value={draft.deviceNumber ?? ''} onChange={(value) => set('deviceNumber', value)} modes={['barcode', 'qr']} />
            </div>
            <div>
              <FieldLabel>Classification</FieldLabel>
              <Input value={draft.classification ?? ''} onChange={(event) => set('classification', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Coverage</FieldLabel>
              <Input value={draft.coverage ?? ''} onChange={(event) => set('coverage', event.target.value)} />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="font-extrabold text-[var(--text)]">Pre-start safety</h2>
          <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
            {prestartQuestions.map(([key, label]) => (
              <Checkbox key={key} label={label} checked={Boolean(draft.wwPrestart?.[key])} onChange={(checked) => setPrestart(key, checked)} />
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-extrabold text-[var(--text)]">Switchboard details</h2>
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div>
              <FieldLabel>Switchboard name</FieldLabel>
              <Input value={draft.wwSwitchboard?.name ?? ''} onChange={(event) => setSwitchboard('name', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Location</FieldLabel>
              <Input value={draft.wwSwitchboard?.location ?? ''} onChange={(event) => setSwitchboard('location', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Auditor serial (optional)</FieldLabel>
              <ScannerInput
                value={draft.wwSwitchboard?.deviceSerial ?? ''}
                onChange={(value) => setSwitchboard('deviceSerial', value)}
                modes={['barcode', 'qr']}
              />
            </div>
            <div>
              <FieldLabel>Firmware</FieldLabel>
              <Input value={draft.wwSwitchboard?.firmware ?? ''} onChange={(event) => setSwitchboard('firmware', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Antenna</FieldLabel>
              <Input value={draft.wwSwitchboard?.antennaType ?? ''} onChange={(event) => setSwitchboard('antennaType', event.target.value)} />
            </div>
            <div>
              <FieldLabel>Signal</FieldLabel>
              <Input value={draft.wwSwitchboard?.signalStrength ?? ''} onChange={(event) => setSwitchboard('signalStrength', event.target.value)} />
            </div>
          </div>
          <FieldLabel>Notes</FieldLabel>
          <Textarea value={draft.wwSwitchboard?.notes ?? ''} onChange={(event) => setSwitchboard('notes', event.target.value)} />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Channels</h2>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Three channels for A3RM, six for A6M.</p>
            </div>
            {draft.deviceType === 'Other' ? (
              <Button variant="secondary" onClick={() => set('wwChannels', [...(draft.wwChannels ?? []), {}])}><Icon name="plus" size={16} />Add channel</Button>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            {(draft.wwChannels ?? []).map((channel, index) => (
              <div key={index} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[var(--text)]">Channel {index + 1}</h3>
                  {draft.deviceType === 'Other' ? (
                    <Button variant="ghost" className="text-[var(--red)]" onClick={() => set('wwChannels', draft.wwChannels?.filter((_, itemIndex) => itemIndex !== index))}><Icon name="trash" size={16} />Remove</Button>
                  ) : null}
                </div>
                <div className="grid gap-x-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <FieldLabel>Purpose</FieldLabel>
                    <Select
                      value={channel.purpose || 'SPARE'}
                      onChange={(event) => {
                        const next = [...(draft.wwChannels ?? [])];
                        next[index] = {
                          ...channel,
                          purpose: event.target.value,
                        };
                        set('wwChannels', next);
                      }}
                    >
                      {withLegacyOption(
                        CHANNEL_PURPOSES,
                        channel.purpose,
                      ).map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </Select>
                  </div>
                  {channel.purpose !== 'SPARE' ? (
                    <>
                      <div>
                        <FieldLabel>Load type</FieldLabel>
                        <Select
                          value={channel.loadType || 'Not Used'}
                          onChange={(event) => {
                            const next = [...(draft.wwChannels ?? [])];
                            next[index] = {
                              ...channel,
                              loadType: event.target.value,
                            };
                            set('wwChannels', next);
                          }}
                        >
                          {withLegacyOption(
                            LOAD_TYPES,
                            channel.loadType,
                          ).map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </Select>
                      </div>
                      {draft.deviceType === 'A6M' ? (
                        <div>
                          <FieldLabel>CT rating</FieldLabel>
                          <Select
                            value={channel.ctRatio ?? ''}
                            onChange={(event) => {
                              const next = [...(draft.wwChannels ?? [])];
                              next[index] = {
                                ...channel,
                                ctRatio: event.target.value,
                              };
                              set('wwChannels', next);
                            }}
                          >
                            <option value="">Select an option</option>
                            {withLegacyOption(
                              CT_RATINGS,
                              channel.ctRatio,
                            ).map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                      {draft.deviceType === 'A3RM' ? (
                        <div>
                          <FieldLabel>Rogowski coil</FieldLabel>
                          <Select
                            value={channel.rogowskiSize ?? ''}
                            onChange={(event) => {
                              const next = [...(draft.wwChannels ?? [])];
                              next[index] = {
                                ...channel,
                                rogowskiSize: event.target.value,
                              };
                              set('wwChannels', next);
                            }}
                          >
                            <option value="">Select an option</option>
                            {withLegacyOption(
                              ROGOWSKI_SIZES,
                              channel.rogowskiSize,
                            ).map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                      <div>
                        <FieldLabel>Description</FieldLabel>
                        <Input
                          value={channel.description ?? ''}
                          onChange={(event) => {
                            const next = [...(draft.wwChannels ?? [])];
                            next[index] = {
                              ...channel,
                              description: event.target.value,
                            };
                            set('wwChannels', next);
                          }}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-extrabold text-[var(--text)]">Verification & commissioning</h2>
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-sub)]">Verification</h3>
              {verificationQuestions.map(([key, label]) => (
                <Checkbox key={key} label={label} checked={Boolean(draft.wwVerification?.[key])} onChange={(checked) => setVerification(key, checked)} />
              ))}
              <FieldLabel>Verification notes</FieldLabel>
              <Textarea value={draft.wwVerification?.notes ?? ''} onChange={(event) => setVerification('notes', event.target.value)} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-sub)]">Commissioning</h3>
              {commissioningQuestions.map(([key, label]) => (
                <Checkbox key={key} label={label} checked={Boolean(draft.wwCommissioning?.[key])} onChange={(checked) => setCommissioning(key, checked)} />
              ))}
              <FieldLabel>Commissioning notes</FieldLabel>
              <Textarea value={draft.wwCommissioning?.notes ?? ''} onChange={(event) => setCommissioning('notes', event.target.value)} />
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save meter'}</Button>
          <Button variant="secondary" onClick={() => router.back()} disabled={busy}>Cancel</Button>
        </div>
      </form>

      {!saved ? (
        <InlineNotice>Save the meter first, then capture evidence and create communications fault records.</InlineNotice>
      ) : (
        <Card className="mt-5">
          <h2 className="font-extrabold text-[var(--text)]">Meter evidence</h2>
          {photoFields.map(({ slot, label }) => {
            const uri = latest.wwPhotos?.[slot];
            return (
              <EvidenceField
                key={slot}
                label={label}
                items={uri ? [{ id: slot, uri }] : []}
                busy={uploading}
                onFiles={(files) => uploadSingle(slot, files)}
                onRemoveLast={uri ? () => removePhoto(slot) : undefined}
              />
            );
          })}
          <EvidenceField
            label="Extra meter photos"
            items={(latest.wwPhotos?.extra ?? []).map((uri, index) => ({ id: `${index}`, uri }))}
            busy={uploading}
            onFiles={uploadExtra}
            onRemoveLast={latest.wwPhotos?.extra?.length ? () => removePhoto('extra') : undefined}
          />
        </Card>
      )}
    </div>
  );
}
