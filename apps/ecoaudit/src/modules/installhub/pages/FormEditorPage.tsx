'use client';
/* eslint-disable react-hooks/set-state-in-effect -- initializes the local autosave draft from its server query record */

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { StatusBadge } from '@/components/ui/Badges';
import { Button, LinkButton } from '@/components/ui/Button';
import {
  Card,
  ErrorBanner,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  Textarea,
} from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import { slugify } from '@/lib/download';
import {
  FORM_COMPLETION_SYNC_STAGE,
  downloadExportJob,
  findRecordVersionContainingForms,
  getAuthoritativeReportProvenance,
  getExportJobStatus,
  getLatestExportJob,
  matchesInstallHubReportProvenance,
  requireRecordVersionNumber,
  startFormPdfJob,
  uploadInstallationPhoto,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import {
  Breadcrumbs,
  DefinitionList,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { ScannerInput } from '@/modules/installhub/components/ScannerInput';
import {
  ErrorSummary,
  SaveStateNotice,
  TreeDraftNavigationGuard,
  focusWorkflowErrorTarget,
} from '@/modules/installhub/components/WorkflowUi';
import {
  FORM_DEFINITION_BY_TYPE,
  answersAfterChange,
  formValidationIssues,
  isFieldVisible,
  isSectionVisible,
  optionsForField,
  requiredProgress,
  type FormFieldDefinition,
} from '@/modules/installhub/forms/catalog';
import {
  canonicalWwBoardAnswers,
  isWwCanonicalBoardAnswer,
} from '@/modules/installhub/forms/canonicalContext';
import {
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  applyDraftFormSnapshot,
  createAmendment,
  newFormAttachment,
  nowIso,
  syncOperationalMeter,
  wwFormCompletionContextError,
} from '@/modules/installhub/lib/model';
import {
  boardElectricalSource,
  boardTypeLabel,
  displayCodeValue,
  meterDeviceName,
  meterDevices,
  syncMeterDevice,
} from '@/modules/installhub/lib/workflow';
import type {
  FormAttachment,
  FormSubmission,
  InstallHubReportProvenance,
} from '@/modules/installhub/types/domain';

type FormCompletionError = {
  id: string;
  fieldKey?: string;
  message: string;
};

function formFieldTargetId(fieldKey: string): string {
  return `form-field-${fieldKey.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function InstallHubFormEditorPage() {
  const { installationId, formId } = useParams<{
    installationId: string;
    formId: string;
  }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const writerRef = useRef(writer);
  useEffect(() => {
    writerRef.current = writer;
  }, [writer]);
  const router = useRouter();
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<FormAttachment[]>([]);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionErrors, setCompletionErrors] = useState<FormCompletionError[]>([]);

  const source = query.data?.formSubmissions.find(
    (item) => item.id === formId,
  );
  useEffect(() => {
    if (!source || initializedFor === source.id) return;
    setAnswers(canonicalWwBoardAnswers(query.data!, source, source.answers));
    setAttachments(structuredClone(source.attachments));
    setInitializedFor(source.id);
    setDirty(false);
    setCompletionErrors([]);
  }, [initializedFor, query.data, source]);

  const readOnly = source?.status === 'Completed';
  const latestDraftRef = useRef({
    answers,
    attachments,
    dirty,
    initializedFor,
    readOnly,
    tree: query.data,
    source,
  });
  useEffect(() => {
    latestDraftRef.current = {
      answers,
      attachments,
      dirty,
      initializedFor,
      readOnly,
      tree: query.data,
      source,
    };
  }, [answers, attachments, dirty, initializedFor, query.data, readOnly, source]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!latestDraftRef.current.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      const latest = latestDraftRef.current;
      if (
        !latest.dirty
        || latest.readOnly
        || latest.initializedFor !== formId
      ) {
        return;
      }
      const flushAnswers = latest.tree && latest.source
        ? canonicalWwBoardAnswers(latest.tree, latest.source, latest.answers)
        : latest.answers;
      void writerRef.current
        .mutate((tree) => {
          applyDraftFormSnapshot(
            tree,
            formId,
            flushAnswers,
            latest.attachments,
          );
        }, 'metadata')
        .catch((error) => {
          console.error(
            '[InstallHub] Failed to flush draft during navigation',
            error,
          );
        });
    };
  }, [formId]);

  useEffect(() => {
    if (!dirty || readOnly || initializedFor !== formId) return;
    const normalizedAnswers = query.data && source
      ? canonicalWwBoardAnswers(query.data, source, answers)
      : answers;
    const timeout = window.setTimeout(() => {
      setSaving(true);
      void writerRef.current
        .mutate((tree) => {
          applyDraftFormSnapshot(
            tree,
            formId,
            normalizedAnswers,
            attachments,
          );
        }, 'metadata')
        .then(() => {
          setAnswers(normalizedAnswers);
          setDirty(false);
        })
        .catch((error) =>
          toast.error(installHubConnectionErrorMessage(error)),
        )
        .finally(() => setSaving(false));
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [
    answers,
    attachments,
    dirty,
    formId,
    initializedFor,
    query.data,
    readOnly,
    source,
    toast,
  ]);

  if (query.isLoading || !source || initializedFor !== formId) {
    if (query.error) {
      return (
        <ErrorBanner
          message={installHubConnectionErrorMessage(query.error)}
        />
      );
    }
    if (!query.isLoading && query.data && !source) {
      return <ErrorBanner message="Field form not found." />;
    }
    return <Spinner label="Loading field form…" />;
  }
  const tree = query.data!;
  const currentForm = source;
  const definition = FORM_DEFINITION_BY_TYPE[source.formType];
  const progress = requiredProgress(definition, answers, attachments);
  const supportsLocation = definition.sections.some((section) =>
    section.fields.some(
      (field) =>
        field.key === 'site.latitude' || field.key === 'site.longitude',
    ),
  );
  const canonicalBoard = source.formType === 'ww-installation' && source.boardId
    ? tree.electricalAssets.find((item) => item.id === source.boardId)
    : null;
  const canonicalBoardZone = canonicalBoard
    ? tree.zones.find((item) => item.id === canonicalBoard.zoneId)
    : null;
  const canonicalMeter = source.formType === 'ww-installation' && source.meterId
    ? meterDevices(tree).find((item) => item.id === source.meterId)
    : null;
  const canonicalSupply = canonicalBoard ? boardElectricalSource(canonicalBoard) : null;
  const canonicalSupplyLabel = canonicalSupply?.kind === 'GRID'
    ? tree.gridSupplies?.find((item) => item.id === canonicalSupply.gridSupplyId)?.name || `Missing Grid supply ${canonicalSupply.gridSupplyId}`
    : canonicalSupply?.kind === 'BOARD'
      ? (() => {
          const parent = tree.electricalAssets.find((item) => item.id === canonicalSupply.boardId);
          return parent ? `${displayCodeValue(parent)} — ${parent.assetName}` : `Missing switchboard ${canonicalSupply.boardId}`;
        })()
      : 'To be confirmed';

  function change(key: string, value: string) {
    if (isWwCanonicalBoardAnswer(currentForm, key)) return;
    const result = answersAfterChange(definition, answers, key, value);
    setAnswers(result.answers);
    if (result.hiddenPhotoSlots.length) {
      const hidden = new Set(result.hiddenPhotoSlots);
      setAttachments((current) =>
        current.filter((item) => !hidden.has(item.slot)),
      );
    }
    setCompletionErrors((current) => current.filter((item) => item.fieldKey !== key));
    setDirty(true);
  }

  async function saveDraft(showToast = true) {
    if (readOnly) return;
    const normalizedAnswers = canonicalWwBoardAnswers(tree, currentForm, answers);
    setSaving(true);
    try {
      await writer.mutate((next) => {
        if (
          !applyDraftFormSnapshot(
            next,
            formId,
            normalizedAnswers,
            attachments,
          )
        ) {
          throw new Error('This form can no longer be edited.');
        }
      }, 'metadata');
      setAnswers(normalizedAnswers);
      setDirty(false);
      if (showToast) toast.success('Draft saved.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function uploadEvidence(
    field: FormFieldDefinition,
    files: File[],
  ) {
    setUploadingSlot(field.key);
    const normalizedAnswers = canonicalWwBoardAnswers(tree, currentForm, answers);
    try {
      let nextAttachments: FormAttachment[] = [];
      await writer.mutate(async (next) => {
        const target = next.formSubmissions.find(
          (item) => item.id === formId,
        );
        if (!target || target.status === 'Completed') {
          throw new Error('This form can no longer be edited.');
        }
        target.answers = structuredClone(normalizedAnswers);
        target.attachments = structuredClone(attachments);
        for (const file of files) {
          const index = target.attachments.length;
          const uri = await uploadInstallationPhoto(
            next,
            {
              installationId,
              entityType: 'form_submission',
              entityId: formId,
              fieldName: `attachments[${index}].uri`,
            },
            file,
          );
          target.attachments.push(
            newFormAttachment(field.key, uri, file),
          );
        }
        target.updatedAt = nowIso();
        nextAttachments = structuredClone(target.attachments);
      }, 'metadata');
      setAttachments(nextAttachments);
      setAnswers(normalizedAnswers);
      setCompletionErrors((current) => current.filter((item) => item.fieldKey !== field.key));
      setDirty(false);
      toast.success(
        `${files.length} evidence photo${files.length === 1 ? '' : 's'} uploaded.`,
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploadingSlot(null);
    }
  }

  async function completeForm() {
    const normalizedAnswers = canonicalWwBoardAnswers(tree, currentForm, answers);
    const candidate: FormSubmission = {
      ...source!,
      answers: normalizedAnswers,
      attachments,
    };
    const errors: FormCompletionError[] = formValidationIssues(candidate).map((issue) => ({
      id: formFieldTargetId(issue.fieldKey),
      fieldKey: issue.fieldKey,
      message: issue.message,
    }));
    const contextError = wwFormCompletionContextError(tree, candidate);
    if (contextError) {
      errors.unshift({
        id: 'form-canonical-context',
        message: contextError,
      });
    }
    setCompletionErrors(errors);
    if (errors.length) {
      window.setTimeout(() => {
        focusWorkflowErrorTarget(errors[0].id);
      }, 50);
      toast.error('Check the highlighted form fields before completion.');
      return;
    }
    setCompleting(true);
    try {
      const confirmed = await writer.mutate((next) => {
        const target = next.formSubmissions.find(
          (item) => item.id === formId,
        );
        if (!target || target.status === 'Completed') {
          throw new Error('This form is already completed.');
        }
        target.answers = structuredClone(normalizedAnswers);
        target.attachments = structuredClone(attachments);
        target.status = 'Completed';
        target.completedAt = nowIso();
        target.updatedAt = target.completedAt;
        syncOperationalMeter(next, target);
        if (target.meterId && target.boardId) {
          const board = next.electricalAssets.find((item) => item.id === target.boardId);
          const meter = board?.meters.find((item) => item.id === target.meterId);
          if (meter) syncMeterDevice(next, board!.id, meter);
        }
      }, FORM_COMPLETION_SYNC_STAGE);
      setDirty(false);
      toast.success(
        typeof confirmed.recordVersionNumber === 'number'
          ? `Form completed. Version ${confirmed.recordVersionNumber} is confirmed and the record is now read-only.`
          : 'Form completed. The record is now read-only.',
      );
      if (currentForm.formType === 'ww-installation') {
        const completed = confirmed.formSubmissions.find((item) => item.id === formId);
        const completedBoard = confirmed.electricalAssets.find(
          (item) => item.id === completed?.boardId,
        );
        if (completedBoard && completed?.meterId) {
          router.replace(`/installhub/installations/${installationId}/zones/${completedBoard.zoneId}/boards/${completedBoard.id}/meters/${completed.meterId}#meter-assignments`);
        }
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setCompleting(false);
    }
  }

  async function deleteDraft() {
    if (!window.confirm('Delete this draft and its evidence references?')) {
      return;
    }
    try {
      await writer.mutate((next) => {
        if (
          next.formSubmissions.some(
            (item) => item.supersedesId === formId,
          )
        ) {
          throw new Error(
            'This draft cannot be deleted while a later amendment refers to it.',
          );
        }
        next.formSubmissions = next.formSubmissions.filter(
          (item) => item.id !== formId,
        );
      });
      setDirty(false);
      toast.success('Draft deleted.');
      router.replace(
        `/installhub/installations/${installationId}/forms`,
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function amend() {
    try {
      let amendmentId = '';
      await writer.mutate((next) => {
        const target = next.formSubmissions.find(
          (item) => item.id === formId,
        );
        if (!target) throw new Error('Form not found.');
        const amendment = createAmendment(target);
        next.formSubmissions.push(amendment);
        amendmentId = amendment.id;
      });
      toast.success('Amendment created with the original evidence.');
      router.replace(
        `/installhub/installations/${installationId}/forms/${amendmentId}`,
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          {
            label: tree.installation.siteName,
            href: `/installhub/installations/${installationId}`,
          },
          {
            label: 'Field forms',
            href: `/installhub/installations/${installationId}/forms`,
          },
          { label: definition.shortTitle },
        ]}
      />
      <PageHeader
        title={definition.shortTitle}
        subtitle={
          readOnly
            ? `Completed ${
                source.completedAt
                  ? new Date(source.completedAt).toLocaleString()
                  : ''
              }`
            : `${progress.done} of ${progress.total} required items · ${
                saving ? 'Saving…' : dirty ? 'Changes pending' : 'Saved automatically'
              }`
        }
        actions={
          <>
            <StatusBadge status={source.status} />
            {!readOnly ? (
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void saveDraft()}
              >
                Save draft
              </Button>
            ) : null}
          </>
        }
      />

      {source.formType === 'ww-installation' ? (
        canonicalBoard ? (
          <Card id="form-canonical-context" className="mb-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-extrabold text-[var(--text)]">Canonical switchboard context</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Read-only installation identity used by this WW field record. Change the switchboard or device record—not form answers—to correct this context.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canonicalMeter ? <LinkButton href={`/installhub/installations/${installationId}/zones/${canonicalBoard.zoneId}/boards/${canonicalBoard.id}/meters/${canonicalMeter.id}#meter-assignments`}>Open meter assignments</LinkButton> : null}
                <LinkButton href={`/installhub/installations/${installationId}/zones/${canonicalBoard.zoneId}/boards/${canonicalBoard.id}`} variant="secondary">Open switchboard</LinkButton>
              </div>
            </div>
            <DefinitionList items={[
              { label: 'Switchboard', value: `${displayCodeValue(canonicalBoard)} — ${canonicalBoard.assetName}` },
              { label: 'Stable board ID', value: <span className="font-mono text-xs">{canonicalBoard.id}</span> },
              { label: 'Board type', value: boardTypeLabel(canonicalBoard) },
              { label: 'Physical zone', value: canonicalBoardZone?.zoneName || 'Unknown zone' },
              { label: 'FED_FROM source', value: canonicalSupplyLabel },
              { label: 'Meter device', value: canonicalMeter ? `${meterDeviceName(canonicalMeter)} · ${canonicalMeter.serialNumber}` : source.meterId ? `Missing device ${source.meterId}` : 'No device linked' },
            ]} />
          </Card>
        ) : (
          <div id="form-canonical-context" className="mb-5"><InlineNotice tone="warning">This WW field record has no valid canonical switchboard context. Link it from the switchboard workflow before completion.</InlineNotice></div>
        )
      ) : null}

      <ErrorSummary
        title="Complete these items before finishing the form"
        errors={completionErrors}
      />

      <div className="mb-4 flex justify-end">
        <SaveStateNotice
          state={writer.writeState}
          onRetry={() => void writer.retry().catch((error) => toast.error(installHubConnectionErrorMessage(error)))}
          onDiscard={() => void writer.discard()}
        />
      </div>
      <TreeDraftNavigationGuard
        active={dirty || writer.hasPendingTree}
        onDiscard={async () => {
          setDirty(false);
          await writer.discard();
        }}
      />

      <div className="mb-6">
        <div className="mb-2 flex justify-between text-xs font-bold text-[var(--text-sub)]">
          <span>Required-field progress</span>
          <span>
            {progress.done}/{progress.total}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--surface2)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{
              width: `${
                progress.total
                  ? (progress.done / progress.total) * 100
                  : 0
              }%`,
            }}
          />
        </div>
      </div>

      {definition.schemaVersion === 1 ? (
        <div className="mb-5">
          <InlineNotice>
            This is a legacy schema-v1 A3RM/A6M record. It remains structured,
            editable while draft, exportable, and available for amendments; new
            work uses the unified Installation Form (WW).
          </InlineNotice>
        </div>
      ) : null}

      {!readOnly && definition.schemaVersion >= 2 && supportsLocation ? (
        <Button
          variant="secondary"
          className="mb-5"
          onClick={() => {
            if (!navigator.geolocation) {
              toast.info('Enter latitude and longitude manually.');
              return;
            }
            navigator.geolocation.getCurrentPosition(
              (position) => {
                setAnswers((current) => ({
                  ...current,
                  'site.latitude': String(position.coords.latitude),
                  'site.longitude': String(position.coords.longitude),
                }));
                setDirty(true);
              },
              () => toast.info('Location was unavailable. Enter it manually.'),
            );
          }}
        >
          <Icon name="map-pin" size={17} />
          Use current location
        </Button>
      ) : null}

      {definition.sections.length ? (
        definition.sections
          .filter((section) => isSectionVisible(section, answers))
          .map((section, sectionIndex) => (
            <Card key={section.title} className="mb-5">
              <h2 className="mb-5 text-lg font-extrabold text-[var(--text)]">
                {sectionIndex + 1}. {section.title}
              </h2>
              {section.fields.map((field) =>
                isFieldVisible(field, answers) && !isWwCanonicalBoardAnswer(currentForm, field.key) ? (
                  <FormField
                    key={field.key}
                    field={field}
                    answers={answers}
                    attachments={attachments}
                    readOnly={readOnly}
                    uploading={uploadingSlot === field.key}
                    error={completionErrors.find((item) => item.fieldKey === field.key)?.message}
                    onChange={change}
                    onUpload={(files) => uploadEvidence(field, files)}
                    onCaption={(id, caption) => {
                      setAttachments((current) =>
                        current.map((item) =>
                          item.id === id
                            ? {
                                ...item,
                                caption:
                                  caption === '' ? undefined : caption,
                              }
                            : item,
                        ),
                      );
                      setDirty(true);
                    }}
                    onRemove={(id) => {
                      setAttachments((current) =>
                        current.filter((item) => item.id !== id),
                      );
                      setDirty(true);
                    }}
                  />
                ) : null,
              )}
            </Card>
          ))
      ) : (
        <LegacyFormRecord form={source} />
      )}

      {readOnly ? (
        <CompletedFormActions
          installationId={installationId}
          form={source}
          recordVersionNumber={tree.recordVersionNumber}
          onAmend={amend}
        />
      ) : (
        <Card className="mt-6">
          <InlineNotice tone="warning">
            Completing the form makes this record read-only and updates the
            operational meter registry where applicable.
          </InlineNotice>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              disabled={completing || saving}
              onClick={() => void completeForm()}
            >
              <Icon name="check" size={17} />
              {completing ? 'Completing…' : 'Complete form'}
            </Button>
            <Button
              variant="danger"
              disabled={completing || saving}
              onClick={() => void deleteDraft()}
            >
              <Icon name="trash" size={17} />
              Delete draft
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function FormField({
  field,
  answers,
  attachments,
  readOnly,
  uploading,
  error,
  onChange,
  onUpload,
  onCaption,
  onRemove,
}: {
  field: FormFieldDefinition;
  answers: Record<string, string>;
  attachments: FormAttachment[];
  readOnly: boolean;
  uploading: boolean;
  error?: string;
  onChange: (key: string, value: string) => void;
  onUpload: (files: File[]) => Promise<void>;
  onCaption: (id: string, caption: string) => void;
  onRemove: (id: string) => void;
}) {
  const label = `${field.label}${field.required ? ' *' : ''}`;
  const value = answers[field.key] ?? '';
  const fieldId = formFieldTargetId(field.key);
  const errorId = `${fieldId}-error`;
  if (field.kind === 'photo') {
    const items = attachments.filter((item) => item.slot === field.key);
    return (
      <div id={fieldId} tabIndex={-1} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}>
        <EvidenceField
          label={field.label}
          required={field.required}
          items={items}
          busy={uploading}
          readOnly={readOnly}
          onFiles={onUpload}
          onCaptionChange={
            readOnly ? undefined : (id, caption) => onCaption(id, caption)
          }
          onRemove={
            readOnly || !items.length
              ? undefined
              : (id) => {
                  if (window.confirm('Remove this evidence photo?')) {
                    onRemove(id);
                  }
                }
          }
        />
        <FieldError id={errorId} message={error} />
      </div>
    );
  }
  if (field.kind === 'yesno') {
    return (
      <fieldset id={fieldId} className="mt-5" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}>
        <legend className="mb-2 text-sm font-bold text-[var(--text)]">
          {label}
        </legend>
        <div className="flex flex-wrap gap-2">
          {[
            ['Yes', 'yes'],
            ['No', 'no'],
            ...(field.allowNotApplicable
              ? ([['Not applicable', 'not_applicable']] as const)
              : []),
          ].map(([optionLabel, optionValue]) => (
            <button
              key={optionValue}
              type="button"
              disabled={readOnly}
              aria-pressed={value === optionValue}
              onClick={() => onChange(field.key, optionValue)}
              className={`min-h-11 rounded-full border px-5 text-sm font-bold ${
                value === optionValue
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]'
                  : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--primary)]'
              } disabled:opacity-65`}
            >
              {optionLabel}
            </button>
          ))}
        </div>
        <FieldError id={errorId} message={error} />
      </fieldset>
    );
  }
  if (field.kind === 'select') {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <Select
          id={fieldId}
          value={value}
          disabled={readOnly}
          required={field.required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          <option value="">Select an option</option>
          {optionsForField(field, answers).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </Select>
        <FieldError id={errorId} message={error} />
      </div>
    );
  }
  if (field.scanModes?.length) {
    return (
      <div id={fieldId} tabIndex={-1} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}>
        <FieldLabel>{label}</FieldLabel>
        <ScannerInput
          value={value}
          disabled={readOnly}
          modes={[...field.scanModes]}
          onChange={(next) => onChange(field.key, next)}
        />
        <FieldHint>
          Scan with the browser camera or enter the value manually.
        </FieldHint>
        <FieldError id={errorId} message={error} />
      </div>
    );
  }
  return (
    <div>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      {field.kind === 'multiline' ? (
        <Textarea
          id={fieldId}
          value={value}
          disabled={readOnly}
          required={field.required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      ) : (
        <Input
          id={fieldId}
          value={value}
          disabled={readOnly}
          required={field.required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          type={field.kind === 'number' ? 'number' : 'text'}
          step={field.kind === 'number' ? 'any' : undefined}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function LegacyFormRecord({ form }: { form: FormSubmission }) {
  return (
    <Card>
      <InlineNotice>
        This schema-v1 record remains readable and exportable. New A3RM/A6M
        work uses the unified Installation Form (WW).
      </InlineNotice>
      <dl className="mt-5 grid gap-4 md:grid-cols-2">
        {Object.entries(form.answers).map(([key, value]) => (
          <div key={key}>
            <dt className="break-all text-xs font-bold text-[var(--muted)]">
              {key}
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">
              {value || '—'}
            </dd>
          </div>
        ))}
      </dl>
      {form.attachments.length ? (
        <div className="mt-6">
          <EvidenceField
            label="Legacy evidence"
            items={form.attachments}
            readOnly
            onFiles={() => undefined}
          />
        </div>
      ) : null}
    </Card>
  );
}

function CompletedFormActions({
  installationId,
  form,
  recordVersionNumber,
  onAmend,
}: {
  installationId: string;
  form: FormSubmission;
  recordVersionNumber?: number;
  onAmend: () => Promise<void>;
}) {
  const toast = useToast();
  const definition = FORM_DEFINITION_BY_TYPE[form.formType];
  const hasPinnedVersion = Number.isInteger(recordVersionNumber)
    && (recordVersionNumber ?? 0) > 0;
  const expectedReport = useRef<InstallHubReportProvenance | null>(null);

  async function selectReportProvenance(): Promise<InstallHubReportProvenance> {
    const preferredVersion = requireRecordVersionNumber(recordVersionNumber);
    const reportVersion = form.historicalMeterRemoved
      ? await findRecordVersionContainingForms(
          installationId,
          [form.id],
          preferredVersion,
        )
      : preferredVersion;
    const expected = await getAuthoritativeReportProvenance(
      installationId,
      reportVersion,
    );
    expectedReport.current = expected;
    return expected;
  }

  const pdf = useExportJob({
    scopeKey: ['installhub', installationId, 'form', form.id, String(recordVersionNumber ?? 'unversioned')],
    loadLatest: async () => (
      hasPinnedVersion
        ? getLatestExportJob(form.id, await selectReportProvenance())
        : null
    ),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id),
    fallbackFilename: `${slugify(definition.shortTitle)}.pdf`,
    matchesJob: (job) => matchesInstallHubReportProvenance(job, expectedReport.current),
  });

  return (
    <Card className="mt-6">
      <h2 className="font-extrabold text-[var(--text)]">
        Completed record
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
        {form.historicalMeterRemoved
          ? 'The commissioned meter is no longer active. This form, its original meter ID, photos, and pinned record version remain immutable historical evidence.'
          : 'Generate the original-quality API server PDF or create an editable amendment that keeps the existing evidence.'}
      </p>
      <ExportJobStatus
        job={pdf.job}
        artifactName="form PDF"
        starting={pdf.starting}
        downloading={pdf.downloading}
        onDownload={() => {
          void pdf
            .download()
            .then(() => toast.success('PDF download started.'))
            .catch((error) =>
              toast.error(installHubConnectionErrorMessage(error)),
            );
        }}
        className="mt-5"
      />
      {!hasPinnedVersion ? (
        <p className="mt-4 text-xs font-semibold text-[var(--amber)]">
          A pinned record version is required before generating this authoritative PDF.
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          disabled={pdf.starting || pdf.active || !hasPinnedVersion}
          onClick={() => {
            void (async () => {
              const expected = await selectReportProvenance();
              return pdf.start(() => startFormPdfJob(
                installationId,
                form.id,
                expected.recordVersionNumber,
              ));
            })()
              .then(() => toast.success('Form PDF generation started.'))
              .catch((error) =>
                toast.error(installHubConnectionErrorMessage(error)),
              );
          }}
        >
          <Icon name="file-text" size={17} />
          {pdf.active ? 'Preparing PDF…' : 'Generate PDF'}
        </Button>
        {!form.historicalMeterRemoved ? (
          <Button variant="secondary" onClick={() => void onAmend()}>
            Create amendment
          </Button>
        ) : null}
        <LinkButton
          variant="ghost"
          href={`/installhub/installations/${installationId}/forms`}
        >
          Back to forms
        </LinkButton>
      </div>
      {pdf.error ? (
        <div className="mt-4">
          <ErrorBanner
            message={installHubConnectionErrorMessage(pdf.error)}
          />
        </div>
      ) : null}
    </Card>
  );
}
