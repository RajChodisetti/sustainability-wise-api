import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createResource,
  deleteResource,
  listResource,
  patchAction,
  updateResource,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../lib/auth';
import { ConfirmDialog } from './ConfirmDialog';
import { DataTable, type Column } from './DataTable';
import { SelectField, TextField, ToggleField } from './FormControls';

export type EntityRecord = Record<string, unknown>;
export type EntityContext = Record<string, string>;
export type FieldKind = 'text' | 'multiline' | 'number' | 'date' | 'select' | 'boolean' | 'array' | 'json';

export interface EntityField {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
  readOnly?: boolean;
  createOnly?: boolean;
  section?: string;
  hint?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface EntityContextField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface EntityConfig {
  id: string;
  title: string;
  description: string;
  entityLabel: string;
  contextFields?: EntityContextField[];
  fields: EntityField[];
  listColumns: Array<{ key: string; label: string; fallback?: string }>;
  listPath: (context: EntityContext) => string | null;
  createPath: (context: EntityContext) => string | null;
  copyPath?: (record: EntityRecord, context: EntityContext) => string | null;
  updatePath: (record: EntityRecord, context: EntityContext) => string | null;
  deletePath: (record: EntityRecord, context: EntityContext) => string | null;
  completePath?: (record: EntityRecord, context: EntityContext) => string | null;
  filterRecords?: (records: EntityRecord[], context: EntityContext) => EntityRecord[];
  defaultValues?: (context: EntityContext) => EntityRecord;
  beforeCreate?: (record: EntityRecord, context: EntityContext) => EntityRecord;
  beforeUpdate?: (record: EntityRecord, context: EntityContext) => EntityRecord;
  displayName: (record: EntityRecord) => string;
}

interface EntityCrudPanelProps {
  config: EntityConfig;
}

type Mode = 'view' | 'create' | 'edit' | 'copy';

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return `${error.message}${error.status ? ` (${error.status})` : ''}`;
  if (error instanceof Error) return error.message;
  return fallback;
}

function statusClass(value: unknown): string {
  return value === 'Completed' ? 'complete' : 'draft';
}

function asInputValue(value: unknown, kind: FieldKind): string {
  if (value === null || value === undefined) return '';
  if (kind === 'array') return Array.isArray(value) ? value.join('\n') : String(value);
  if (kind === 'json') return JSON.stringify(value, null, 2);
  if (kind === 'date') return String(value).slice(0, 10);
  return String(value);
}

function parseFieldValue(value: unknown, field: EntityField): unknown {
  const kind = field.kind ?? 'text';
  if (field.readOnly) return undefined;
  if (kind === 'boolean') return Boolean(value);
  const text = String(value ?? '');
  if (kind === 'number') return text.trim() === '' ? null : Number(text);
  if (kind === 'array') {
    return text
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (kind === 'json') {
    if (!text.trim()) {
      if (['switchboards', 'otherConsiderations', 'additionalPhotos', 'appendixItems'].includes(field.key)) return [];
      return {};
    }
    return JSON.parse(text);
  }
  return text.trim() === '' ? null : text;
}

function recordFromFields(record: EntityRecord, fields: EntityField[], mode: Mode): EntityRecord {
  const payload: EntityRecord = {};
  for (const field of fields) {
    if (field.readOnly) continue;
    if (mode === 'edit' && (field.createOnly || field.key === 'status')) continue;
    const parsed = parseFieldValue(record[field.key], field);
    if (parsed !== undefined) payload[field.key] = parsed;
  }
  return payload;
}

function strippedCopy(record: EntityRecord, config: EntityConfig, context: EntityContext): EntityRecord {
  const clone: EntityRecord = { ...(config.defaultValues?.(context) ?? {}), ...record };
  clone.__copySourceId = record.id;
  for (const key of [
    'id',
    'serverId',
    'syncStatus',
    'updatedAt',
    'deletedAt',
    'createdAt',
    'createdByUserId',
    'reportPdfLocalPath',
    'reportPdfRemoteUrl',
  ]) {
    delete clone[key];
  }
  if ('status' in clone) clone.status = 'Draft';
  const firstName = config.listColumns[0]?.key;
  if (firstName && typeof clone[firstName] === 'string') {
    clone[firstName] = `${clone[firstName]} ${Math.random().toString(36).slice(2, 6)}`;
  }
  return clone;
}

function isContextReady(config: EntityConfig, context: EntityContext): boolean {
  return (config.contextFields ?? []).every((field) => !field.required || Boolean(context[field.key]?.trim()));
}

function initialContext(config: EntityConfig): EntityContext {
  return Object.fromEntries((config.contextFields ?? []).map((field) => [field.key, field.options?.[0]?.value ?? '']));
}

function normalizeRecord(record: EntityRecord, config: EntityConfig, context: EntityContext): EntityRecord {
  return {
    ...(config.defaultValues?.(context) ?? {}),
    ...record,
  };
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? `${value.length} item${value.length === 1 ? '' : 's'}` : '-';
  if (typeof value === 'object') return 'Data';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTime(text);
  return text;
}

export function EntityCrudPanel({ config }: EntityCrudPanelProps) {
  const { session } = useAuth();
  const [context, setContext] = useState<EntityContext>(() => initialContext(config));
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [selected, setSelected] = useState<EntityRecord | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EntityRecord | null>(null);

  useEffect(() => {
    setContext(initialContext(config));
    setRecords([]);
    setSelected(null);
    setMode('view');
    setMessage(null);
    setError(null);
    setQuery('');
  }, [config.id]);

  async function loadRecords() {
    if (!session) return;
    if (!isContextReady(config, context)) {
      setError('Enter the required parent record information first.');
      return;
    }
    const path = config.listPath(context);
    if (!path) {
      setError('This workflow is missing a list endpoint.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await listResource<EntityRecord>(path, session.accessToken);
      const loadedRecords = config.filterRecords?.(result.data ?? [], context) ?? result.data ?? [];
      setRecords(loadedRecords);
      setSelected(loadedRecords[0] ?? null);
      setMode('view');
    } catch (caught) {
      setError(errorMessage(caught, `Unable to load ${config.entityLabel}s.`));
      setRecords([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if ((config.contextFields ?? []).length === 0) void loadRecords();
  }, [config.id, session?.accessToken]);

  function beginCreate() {
    setSelected(normalizeRecord({}, config, context));
    setMode('create');
    setError(null);
    setMessage(null);
  }

  function beginCopy(record: EntityRecord) {
    setSelected(strippedCopy(record, config, context));
    setMode('copy');
    setError(null);
    setMessage(null);
  }

  async function saveSelected() {
    if (!session || !selected) return;
    const isCreate = mode === 'create' || mode === 'copy';
    const isServerCopy = mode === 'copy' && Boolean(config.copyPath);
    let payload: EntityRecord;
    try {
      const rawPayload = recordFromFields(selected, config.fields, mode);
      payload = isCreate
        ? config.beforeCreate?.(rawPayload, context) ?? rawPayload
        : config.beforeUpdate?.(rawPayload, context) ?? rawPayload;
    } catch (caught) {
      setError(errorMessage(caught, 'Fix invalid form values before saving.'));
      return;
    }

    const path = isServerCopy
      ? config.copyPath?.(selected, context)
      : isCreate
        ? config.createPath(context)
        : config.updatePath(selected, context);
    if (!path) {
      setError('This workflow is missing a save endpoint.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const saved = isCreate
        ? await createResource<EntityRecord>(path, session.accessToken, payload)
        : await updateResource<EntityRecord>(path, session.accessToken, payload);
      setMessage(`${config.entityLabel} saved.`);
      await loadRecords();
      setSelected(saved);
      setMode('view');
    } catch (caught) {
      setError(errorMessage(caught, `Unable to save ${config.entityLabel}.`));
    } finally {
      setLoading(false);
    }
  }

  async function completeSelected(record: EntityRecord) {
    if (!session || !config.completePath) return;
    const path = config.completePath(record, context);
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await patchAction<EntityRecord>(path, session.accessToken);
      setMessage(`${config.entityLabel} completed.`);
      await loadRecords();
      setSelected(updated);
      setMode('view');
    } catch (caught) {
      setError(errorMessage(caught, `Unable to complete ${config.entityLabel}.`));
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected(record: EntityRecord) {
    if (!session) return;
    const path = config.deletePath(record, context);
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      await deleteResource(path, session.accessToken);
      setMessage(`${config.entityLabel} deleted.`);
      setDeleteTarget(null);
      await loadRecords();
    } catch (caught) {
      setError(errorMessage(caught, `Unable to delete ${config.entityLabel}.`));
    } finally {
      setLoading(false);
    }
  }

  const columns: Column<EntityRecord>[] = [
    ...config.listColumns.map((column) => ({
      key: column.key,
      header: column.label,
      render: (row: EntityRecord) => {
        const value = row[column.key] ?? (column.fallback ? row[column.fallback] : undefined);
        const isPrimary = column.key === config.listColumns[0]?.key;
        const content = isPrimary && (value === null || value === undefined || value === '')
          ? config.displayName(row)
          : renderCell(value);
        return isPrimary
          ? <button className="link-button" type="button" onClick={() => { setSelected(normalizeRecord(row, config, context)); setMode('view'); }}>{content}</button>
          : content;
      },
    })),
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="row-actions">
          {config.copyPath && (
            <button className="icon-button" type="button" aria-label={`Copy ${config.displayName(row)}`} onClick={() => beginCopy(row)}>
              <ClipboardCopy aria-hidden="true" />
            </button>
          )}
          <button className="icon-button" type="button" aria-label={`Delete ${config.displayName(row)}`} onClick={() => setDeleteTarget(row)}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => JSON.stringify(record).toLowerCase().includes(needle));
  }, [records, query]);

  const editable = mode === 'create' || mode === 'edit' || mode === 'copy';
  const completed = selected?.status === 'Completed';
  const canEdit = Boolean(selected) && !completed;

  return (
    <section className="workflow-panel" aria-labelledby={`${config.id}-title`}>
      <header className="workflow-panel-header">
        <div>
          <h2 id={`${config.id}-title`}>{config.title}</h2>
          <p>{config.description}</p>
        </div>
        <div className="editor-actions">
          <button className="button secondary icon-text" type="button" onClick={() => void loadRecords()} disabled={loading}>
            {loading ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Load
          </button>
          <button className="button primary icon-text" type="button" onClick={beginCreate}>
            <Plus aria-hidden="true" />
            New {config.entityLabel}
          </button>
        </div>
      </header>

      {(config.contextFields ?? []).length > 0 && (
        <div className="record-ref-form">
          {config.contextFields?.map((field) => (
            field.options ? (
              <SelectField
                key={field.key}
                label={field.label}
                value={context[field.key] ?? ''}
                options={field.options}
                onChange={(value) => setContext((current) => ({ ...current, [field.key]: value }))}
              />
            ) : (
              <TextField
                key={field.key}
                label={field.label}
                value={context[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(value) => setContext((current) => ({ ...current, [field.key]: value }))}
              />
            )
          ))}
          <button className="button primary icon-text" type="button" onClick={() => void loadRecords()} disabled={loading}>
            {loading ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
            Load
          </button>
        </div>
      )}

      <div className="record-ref-form single-action">
        <TextField label="Search loaded records" value={query} onChange={setQuery} />
      </div>

      {error && <div className="inline-error"><AlertCircle aria-hidden="true" /> {error}</div>}
      {message && <div className="result-summary"><CheckCircle2 aria-hidden="true" /> {message}</div>}

      <div className="workflow-grid">
        <DataTable
          columns={columns}
          rows={visibleRecords}
          rowKey={(row) => String(row.id ?? config.displayName(row))}
          emptyTitle={`No ${config.entityLabel}s loaded`}
          emptyDescription="Load records or create a new one."
        />

        <form className="editor-panel" onSubmit={(event) => { event.preventDefault(); void saveSelected(); }}>
          <header className="editor-header">
            <div>
              <h3>{selected ? `${mode === 'copy' ? 'Copy' : mode === 'create' ? 'Create' : mode === 'edit' ? 'Edit' : 'View'} ${config.entityLabel}` : `No ${config.entityLabel} selected`}</h3>
              {completed && <span className="lock-note">Completed record locked. Copy the top-level resource to make changes.</span>}
            </div>
            <div className="editor-actions">
              {selected && mode === 'view' && (
                <button className="button secondary icon-text" type="button" onClick={() => setMode('edit')} disabled={!canEdit}>
                  <PenLine aria-hidden="true" />
                  Edit
                </button>
              )}
              {selected && config.completePath && mode === 'view' && selected.status !== 'Completed' && (
                <button className="button secondary icon-text" type="button" onClick={() => void completeSelected(selected)}>
                  <CheckCircle2 aria-hidden="true" />
                  Complete
                </button>
              )}
              {editable && (
                <button className="button primary icon-text" type="submit" disabled={loading}>
                  {loading ? <Loader2 className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                  Save
                </button>
              )}
            </div>
          </header>

          {!selected ? (
            <div className="table-empty">
              <strong>Select or create a record</strong>
              <span>The form appears here.</span>
            </div>
          ) : (
            <div className="sectioned-form">
              {Array.from(new Set(config.fields.map((field) => field.section ?? 'Details'))).map((section) => (
                <section className="form-section" key={section}>
                  <h4>{section}</h4>
                  <div className="form-grid">
                    {config.fields.filter((field) => (field.section ?? 'Details') === section).map((field) => {
                      const kind = field.kind ?? 'text';
                      const disabled = field.readOnly || !editable;
                      const rawValue = selected[field.key];
                      if (kind === 'boolean') {
                        return (
                          <ToggleField
                            key={field.key}
                            label={field.label}
                            hint={field.hint}
                            checked={Boolean(rawValue)}
                            disabled={disabled}
                            onChange={(value) => setSelected((current) => ({ ...(current ?? {}), [field.key]: value }))}
                          />
                        );
                      }
                      if (kind === 'select') {
                        return (
                          <SelectField
                            key={field.key}
                            label={field.label}
                            hint={field.hint}
                            value={String(rawValue ?? '')}
                            options={field.options ?? [{ label: '-', value: '' }]}
                            disabled={disabled}
                            onChange={(value) => setSelected((current) => ({ ...(current ?? {}), [field.key]: value }))}
                          />
                        );
                      }
                      return (
                        <TextField
                          key={field.key}
                          label={field.label}
                          hint={field.hint}
                          type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
                          multiline={kind === 'multiline' || kind === 'array' || kind === 'json'}
                          value={asInputValue(rawValue, kind)}
                          disabled={disabled}
                          onChange={(value) => setSelected((current) => ({ ...(current ?? {}), [field.key]: value }))}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </form>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${config.entityLabel}?`}
        destructive
        confirmLabel="Delete"
        description={<span>This removes {deleteTarget ? config.displayName(deleteTarget) : `the selected ${config.entityLabel}`} from the app data.</span>}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteSelected(deleteTarget);
        }}
      />
    </section>
  );
}
