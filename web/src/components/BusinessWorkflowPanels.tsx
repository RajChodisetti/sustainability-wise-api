import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  FileSearch,
  FileText,
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
  deletePhoto,
  downloadPdfJob,
  downloadZip,
  getPdfJob,
  listPhotos,
  listStoredFiles,
  startPdfJob,
  triggerBrowserDownload,
} from '../lib/api';
import { formatBytes, formatDateTime, compactList, safeFilename } from '../lib/format';
import { useAuth } from '../lib/auth';
import { apps } from '../lib/navigation';
import type { AppId, FileTarget, PdfJob, PhotoRecord, StoredFile, StoredFileListingResponse, ZipTarget } from '../lib/types';
import {
  ecoAuditAuditConfig,
  ecoAuditEquipmentConfig,
  ecoAuditZoneConfig,
  equipmentTypes,
  solarSenseAssessmentConfig,
  solarSenseSiteConfig,
} from '../lib/entityConfigs';
import { ConfirmDialog } from './ConfirmDialog';
import { DataTable, type Column } from './DataTable';
import { PhotoUploadField, SelectField, TextField, ToggleField, RepeatedSection } from './FormControls';
import { EntityCrudPanel } from './EntityCrudPanel';

interface BusinessWorkflowPanelsProps {
  app: AppId;
  surfacePath: string;
  surfaceTitle: string;
}

type DemoStatus = 'Draft' | 'Completed';

interface DemoRecord {
  id: string;
  name: string;
  owner: string;
  status: DemoStatus;
  date: string;
  notes: string;
  priority: string;
  tags: string[];
}

const seedRecords: DemoRecord[] = [
  {
    id: 'demo-001',
    name: 'Sample site/audit record',
    owner: 'Inspector',
    status: 'Draft',
    date: new Date().toISOString().slice(0, 10),
    notes: 'Representative editable record for the shared CRUD workflow.',
    priority: 'Normal',
    tags: ['photos', 'pdf'],
  },
  {
    id: 'demo-002',
    name: 'Completed reference record',
    owner: 'Admin',
    status: 'Completed',
    date: new Date().toISOString().slice(0, 10),
    notes: 'Completed records render as locked; changes should happen through a top-level draft copy.',
    priority: 'High',
    tags: ['locked'],
  },
];

function appRecordLabel(app: AppId, surfaceTitle: string): string {
  if (surfaceTitle.includes('Equipment')) return 'equipment item';
  if (surfaceTitle.includes('Zone')) return 'zone';
  if (surfaceTitle.includes('Assessment')) return 'assessment';
  if (surfaceTitle.includes('Site')) return 'site';
  if (surfaceTitle.includes('Audit')) return 'audit';
  return app === 'solarsense' ? 'SolarSense record' : 'EcoAudit record';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return `${error.message}${error.status ? ` (${error.status})` : ''}`;
  if (error instanceof Error) return error.message;
  return fallback;
}

function StatusBadge({ status }: { status: DemoStatus | string }) {
  return <span className={`record-status ${status === 'Completed' ? 'complete' : 'draft'}`}>{status}</span>;
}

function CrudFoundationPanel({ app, surfaceTitle }: { app: AppId; surfaceTitle: string }) {
  const recordLabel = appRecordLabel(app, surfaceTitle);
  const [records, setRecords] = useState<DemoRecord[]>(seedRecords);
  const [selected, setSelected] = useState<DemoRecord>(seedRecords[0]);
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [files, setFiles] = useState<File[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DemoRecord | null>(null);

  const locked = selected.status === 'Completed';
  const editable = mode === 'create' || mode === 'edit';

  const columns: Column<DemoRecord>[] = [
    { key: 'name', header: 'Record', render: (row) => <button className="link-button" type="button" onClick={() => { setSelected(row); setMode('view'); }}>{row.name}</button> },
    { key: 'owner', header: 'Owner', render: (row) => row.owner },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'date', header: 'Date', render: (row) => row.date },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="row-actions">
          <button className="icon-button" type="button" aria-label={`Delete ${row.name}`} onClick={() => setDeleteTarget(row)}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  function updateSelected(patch: Partial<DemoRecord>) {
    setSelected((current) => ({ ...current, ...patch }));
  }

  function saveRecord() {
    if (mode === 'create') {
      setRecords((current) => [{ ...selected, id: selected.id || `demo-${Date.now()}` }, ...current]);
    } else if (mode === 'edit') {
      setRecords((current) => current.map((record) => (record.id === selected.id ? selected : record)));
    }
    setMode('view');
    setFiles([]);
  }

  function createDraft() {
    setSelected({
      id: `demo-${Date.now()}`,
      name: '',
      owner: '',
      status: 'Draft',
      date: new Date().toISOString().slice(0, 10),
      notes: '',
      priority: 'Normal',
      tags: [],
    });
    setMode('create');
    setFiles([]);
  }

  return (
    <section className="workflow-panel" aria-labelledby="crud-foundation-title">
      <header className="workflow-panel-header">
        <div>
          <h2 id="crud-foundation-title">Record Workflow</h2>
          <p>Shared list, create, edit, delete, completed-lock, repeated-section, and photo-field controls.</p>
        </div>
        <button className="button primary icon-text" type="button" onClick={createDraft}>
          <Plus aria-hidden="true" />
          New {recordLabel}
        </button>
      </header>

      <div className="workflow-grid">
        <DataTable columns={columns} rows={records} rowKey={(row) => row.id} />

        <form className="editor-panel" onSubmit={(event) => { event.preventDefault(); saveRecord(); }}>
          <header className="editor-header">
            <div>
              <h3>{mode === 'create' ? 'Create' : mode === 'edit' ? 'Edit' : 'View'} {recordLabel}</h3>
              {locked && <span className="lock-note">Completed record locked</span>}
            </div>
            <div className="editor-actions">
              {mode === 'view' && (
                <button className="button secondary icon-text" type="button" onClick={() => setMode('edit')} disabled={locked}>
                  <PenLine aria-hidden="true" />
                  Edit
                </button>
              )}
              {editable && (
                <button className="button primary icon-text" type="submit">
                  <Save aria-hidden="true" />
                  Save
                </button>
              )}
            </div>
          </header>

          <div className="form-grid">
            <TextField label="Name" value={selected.name} onChange={(name) => updateSelected({ name })} disabled={!editable} />
            <TextField label="Owner" value={selected.owner} onChange={(owner) => updateSelected({ owner })} disabled={!editable} />
            <TextField label="Date" type="date" value={selected.date} onChange={(date) => updateSelected({ date })} disabled={!editable} />
            <SelectField
              label="Priority"
              value={selected.priority}
              disabled={!editable}
              onChange={(priority) => updateSelected({ priority })}
              options={[
                { label: 'Normal', value: 'Normal' },
                { label: 'High', value: 'High' },
                { label: 'Urgent', value: 'Urgent' },
              ]}
            />
            <SelectField
              label="Status"
              value={selected.status}
              disabled={!editable}
              onChange={(status) => updateSelected({ status: status as DemoStatus })}
              options={[
                { label: 'Draft', value: 'Draft' },
                { label: 'Completed', value: 'Completed' },
              ]}
            />
            <TextField label="Notes" value={selected.notes} onChange={(notes) => updateSelected({ notes })} multiline disabled={!editable} />
          </div>

          <RepeatedSection
            title="Repeated Data"
            items={selected.tags}
            addLabel="Add row"
            onAdd={() => updateSelected({ tags: [...selected.tags, 'new row'] })}
            onRemove={(index) => updateSelected({ tags: selected.tags.filter((_, itemIndex) => itemIndex !== index) })}
            renderItem={(tag, index) => (
              <TextField
                label={`Row ${index + 1}`}
                value={tag}
                onChange={(nextTag) => updateSelected({ tags: selected.tags.map((item, itemIndex) => itemIndex === index ? nextTag : item) })}
                disabled={!editable}
              />
            )}
          />

          <PhotoUploadField
            label="Photo field"
            hint="Shared preview control; entity phases wire this to upload sessions."
            files={files}
            multiple
            disabled={!editable}
            onChange={setFiles}
          />
        </form>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete record?"
        destructive
        confirmLabel="Delete"
        description={<span>This removes the selected {recordLabel} from this workflow view.</span>}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            setRecords((current) => current.filter((record) => record.id !== deleteTarget.id));
            if (selected.id === deleteTarget.id) setSelected(records.find((record) => record.id !== deleteTarget.id) ?? seedRecords[0]);
          }
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}

function targetForApp(app: AppId, targetType: string, ref: string): FileTarget | null {
  if (!ref.trim()) return null;
  if (app === 'solarsense') {
    return targetType === 'assessment'
      ? { app, type: 'assessment', ref }
      : { app, type: 'site', ref };
  }
  return { app, type: 'audit', ref };
}

function zipTargetForApp(app: AppId, ref: string): ZipTarget | null {
  if (!ref.trim()) return null;
  return app === 'solarsense' ? { app, siteRef: ref } : { app, auditRef: ref };
}

function FileBrowserPanel({ app }: { app: AppId }) {
  const { session, user } = useAuth();
  const [targetType, setTargetType] = useState(app === 'solarsense' ? 'site' : 'audit');
  const [recordRef, setRecordRef] = useState('');
  const [listing, setListing] = useState<StoredFileListingResponse | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PhotoRecord | null>(null);

  useEffect(() => {
    setTargetType(app === 'solarsense' ? 'site' : 'audit');
    setRecordRef('');
    setListing(null);
    setPhotos([]);
    setError(null);
  }, [app]);

  async function loadFiles() {
    if (!session) return;
    const target = targetForApp(app, targetType, recordRef);
    if (!target) {
      setError('Enter a record name or ID.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [fileResult, photoResult] = await Promise.all([
        listStoredFiles(target, session.accessToken),
        target.type === 'assessment'
          ? Promise.resolve(null)
          : listPhotos(zipTargetForApp(app, recordRef) as ZipTarget, session.accessToken),
      ]);
      setListing(fileResult);
      setPhotos(photoResult?.data ?? []);
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to load files.'));
      setListing(null);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }

  const fileColumns: Column<StoredFile>[] = [
    { key: 'name', header: 'File', render: (row) => <a href={row.downloadUrl} target="_blank" rel="noreferrer">{row.originalFilename || row.storageKey}</a> },
    { key: 'field', header: 'Field', render: (row) => row.fieldName ?? '-' },
    { key: 'source', header: 'Source', render: (row) => row.source },
    { key: 'size', header: 'Size', align: 'right', render: (row) => formatBytes(row.sizeBytes) },
  ];

  const photoColumns: Column<PhotoRecord>[] = [
    { key: 'name', header: 'Photo', render: (row) => row.remoteUrl ? <a href={row.remoteUrl} target="_blank" rel="noreferrer">{row.originalFilename || row.id}</a> : row.originalFilename || row.id },
    { key: 'field', header: 'Field', render: (row) => row.fieldName },
    { key: 'entity', header: 'Entity', render: (row) => row.entityType },
    { key: 'size', header: 'Size', align: 'right', render: (row) => formatBytes(row.fileSizeBytes) },
    {
      key: 'delete',
      header: 'Delete',
      align: 'right',
      render: (row) => user?.role === 'admin'
        ? (
          <button className="icon-button" type="button" aria-label={`Delete ${row.originalFilename || row.id}`} onClick={() => setDeleteTarget(row)}>
            <Trash2 aria-hidden="true" />
          </button>
        )
        : <span className="muted-text">Admin</span>,
    },
  ];

  return (
    <section className="workflow-panel" aria-labelledby="file-browser-title">
      <header className="workflow-panel-header">
        <div>
          <h2 id="file-browser-title">Files and Photos</h2>
          <p>Browse stored files using record name or ID, then download or delete permitted photos.</p>
        </div>
      </header>

      <div className="record-ref-form">
        <SelectField
          label="Record type"
          value={targetType}
          onChange={setTargetType}
          options={app === 'solarsense'
            ? [{ label: 'SolarSense site', value: 'site' }, { label: 'SolarSense assessment', value: 'assessment' }]
            : [{ label: 'EcoAudit audit', value: 'audit' }]}
        />
        <TextField
          label="Record name or ID"
          value={recordRef}
          onChange={setRecordRef}
          placeholder={app === 'solarsense' ? 'Site name, site ID, or assessment ID' : 'Audit site name or audit ID'}
        />
        <button className="button primary icon-text" type="button" onClick={() => void loadFiles()} disabled={loading}>
          {loading ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          Load
        </button>
      </div>

      {error && <div className="inline-error"><AlertCircle aria-hidden="true" /> {error}</div>}

      {listing && (
        <div className="result-stack">
          <div className="result-summary">
            <FileSearch aria-hidden="true" />
            <span>{listing.prefix || 'Storage prefix not returned'}</span>
          </div>
          <DataTable
            columns={fileColumns}
            rows={listing.files}
            rowKey={(row) => row.storageKey}
            emptyTitle="No stored files found"
            emptyDescription="This record may not have synced photos or generated PDFs yet."
          />
          {targetType !== 'assessment' && (
            <DataTable
              columns={photoColumns}
              rows={photos}
              rowKey={(row) => row.id}
              emptyTitle="No photo registry rows found"
              emptyDescription="The storage listing may still include PDFs or non-photo files."
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete photo?"
        destructive
        confirmLabel="Delete photo"
        description={<span>This deletes the selected photo from storage and the photo registry.</span>}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget || !session) return;
          setLoading(true);
          deletePhoto(app, deleteTarget.id, session.accessToken)
            .then(() => loadFiles())
            .catch((caught) => setError(errorMessage(caught, 'Unable to delete photo.')))
            .finally(() => {
              setDeleteTarget(null);
              setLoading(false);
            });
        }}
      />
    </section>
  );
}

function ZipDownloadPanel({ app }: { app: AppId }) {
  const { session } = useAuth();
  const [recordRef, setRecordRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const label = app === 'solarsense' ? 'Site name or ID' : 'Audit name or ID';

  async function onDownload() {
    if (!session) return;
    const target = zipTargetForApp(app, recordRef);
    if (!target) {
      setMessage(`Enter a ${label.toLowerCase()}.`);
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const blob = await downloadZip(target, session.accessToken);
      triggerBrowserDownload(blob, `${apps[app].shortLabel.toLowerCase()}-${safeFilename(recordRef, 'photos')}-photos.zip`);
      setMessage('ZIP download started.');
    } catch (caught) {
      setMessage(errorMessage(caught, 'ZIP download failed.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="workflow-panel" aria-labelledby="zip-title">
      <header className="workflow-panel-header">
        <div>
          <h2 id="zip-title">Photo ZIP Download</h2>
          <p>Download all photos for a SolarSense site or EcoAudit audit using name or ID.</p>
        </div>
      </header>
      <div className="record-ref-form">
        <TextField label={label} value={recordRef} onChange={setRecordRef} />
        <button className="button primary icon-text" type="button" onClick={() => void onDownload()} disabled={loading}>
          {loading ? <Loader2 className="spin" aria-hidden="true" /> : <FileArchive aria-hidden="true" />}
          Download ZIP
        </button>
      </div>
      {message && <div className="result-summary"><Download aria-hidden="true" /> {message}</div>}
    </section>
  );
}

function PdfJobPanel({ app }: { app: AppId }) {
  const { session } = useAuth();
  const [recordId, setRecordId] = useState('');
  const [assessmentIds, setAssessmentIds] = useState('');
  const [zoneIds, setZoneIds] = useState('');
  const [mode, setMode] = useState('by-equipment');
  const [includeRag, setIncludeRag] = useState(true);
  const [includeAppendix, setIncludeAppendix] = useState(true);
  const [job, setJob] = useState<PdfJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !job || !['queued', 'running'].includes(job.status)) return;
    const interval = window.setInterval(() => {
      getPdfJob(job.id, session.accessToken)
        .then(setJob)
        .catch((caught) => setError(errorMessage(caught, 'Unable to poll PDF job.')));
    }, 2000);
    return () => window.clearInterval(interval);
  }, [job, session]);

  async function onStart() {
    if (!session) return;
    if (!recordId.trim()) {
      setError(app === 'solarsense' ? 'Enter a site ID.' : 'Enter an audit ID.');
      return;
    }

    setLoading(true);
    setError(null);
    setJob(null);
    try {
      const result = await startPdfJob(
        app === 'solarsense'
          ? {
            app,
            siteId: recordId,
            assessmentIds: compactList(assessmentIds),
            options: { includeRagFramework: includeRag, includeAppendix },
          }
          : {
            app,
            auditId: recordId,
            mode: mode === 'by-zone' ? 'by-zone' : 'by-equipment',
            zoneIds: compactList(zoneIds),
          },
        session.accessToken,
      );
      setJob(await getPdfJob(result.jobId, session.accessToken));
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to start PDF job.'));
    } finally {
      setLoading(false);
    }
  }

  async function onDownload() {
    if (!session || !job) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await downloadPdfJob(job.id, session.accessToken);
      triggerBrowserDownload(blob, `${apps[app].shortLabel.toLowerCase()}-${safeFilename(recordId, 'report')}.pdf`);
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to download PDF.'));
    } finally {
      setLoading(false);
    }
  }

  const progress = job?.progressTotal
    ? Math.round(((job.progressCurrent ?? 0) / job.progressTotal) * 100)
    : null;

  return (
    <section className="workflow-panel" aria-labelledby="pdf-title">
      <header className="workflow-panel-header">
        <div>
          <h2 id="pdf-title">PDF Job</h2>
          <p>Start an async PDF job, poll progress, and download the completed report.</p>
        </div>
      </header>

      <div className="record-ref-form pdf-form">
        <TextField
          label={app === 'solarsense' ? 'Site ID' : 'Audit ID'}
          value={recordId}
          onChange={setRecordId}
          hint="PDF generation currently requires the server ID."
        />
        {app === 'solarsense' ? (
          <>
            <TextField label="Assessment IDs" value={assessmentIds} onChange={setAssessmentIds} hint="Optional, comma separated." />
            <ToggleField label="Include RAG framework" checked={includeRag} onChange={setIncludeRag} />
            <ToggleField label="Include appendix" checked={includeAppendix} onChange={setIncludeAppendix} />
          </>
        ) : (
          <>
            <SelectField
              label="Layout"
              value={mode}
              onChange={setMode}
              options={[
                { label: 'By equipment', value: 'by-equipment' },
                { label: 'By zone', value: 'by-zone' },
              ]}
            />
            <TextField label="Zone IDs" value={zoneIds} onChange={setZoneIds} hint="Optional, comma separated." />
          </>
        )}
        <button className="button primary icon-text" type="button" onClick={() => void onStart()} disabled={loading}>
          {loading ? <Loader2 className="spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
          Start PDF
        </button>
      </div>

      {error && <div className="inline-error"><AlertCircle aria-hidden="true" /> {error}</div>}
      {job && (
        <article className="job-card">
          <header>
            <div>
              <strong>{job.status}</strong>
              <span>{job.phase ?? 'No phase returned'}</span>
            </div>
            {job.status === 'complete' && (
              <button className="button secondary icon-text" type="button" onClick={() => void onDownload()} disabled={loading}>
                <Download aria-hidden="true" />
                Download PDF
              </button>
            )}
          </header>
          <div className="progress-track">
            <span style={{ width: `${progress ?? (job.status === 'complete' ? 100 : 20)}%` }} />
          </div>
          <dl className="detail-list compact">
            <div><dt>Job ID</dt><dd>{job.id}</dd></div>
            <div><dt>Updated</dt><dd>{formatDateTime(job.updatedAt)}</dd></div>
            <div><dt>Error</dt><dd>{job.error ?? '-'}</dd></div>
          </dl>
        </article>
      )}
    </section>
  );
}

function OverviewPhasePanel({ app }: { app: AppId }) {
  return (
    <section className="workflow-panel" aria-labelledby="phase2-title">
      <header className="workflow-panel-header">
        <div>
          <h2 id="phase2-title">Phase 2 Workflow Foundation</h2>
          <p>Shared workflow components are now available for the business feature phases.</p>
        </div>
        <span className="status-pill">
          <CheckCircle2 aria-hidden="true" />
          Phase 2
        </span>
      </header>
      <div className="surface-list compact-surfaces">
        {['Record CRUD', 'Dynamic forms', 'Photo fields', 'File browser', 'ZIP downloads', 'PDF jobs'].map((item) => (
          <article className="surface-item" key={item}>
            <span className="surface-dot" style={{ background: apps[app].accent }} />
            <strong>{item}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function EcoAuditEquipmentPanel() {
  const [equipmentType, setEquipmentType] = useState(equipmentTypes[0].value);
  const config = useMemo(() => ecoAuditEquipmentConfig(equipmentType), [equipmentType]);

  return (
    <div className="entity-stack">
      <section className="workflow-panel">
        <header className="workflow-panel-header">
          <div>
            <h2>Equipment Category</h2>
            <p>Select one of the nine EcoAudit equipment categories before loading records.</p>
          </div>
        </header>
        <div className="record-ref-form single-action">
          <SelectField
            label="Equipment Type"
            value={equipmentType}
            options={equipmentTypes}
            onChange={setEquipmentType}
          />
        </div>
      </section>
      <EntityCrudPanel key={equipmentType} config={config} />
    </div>
  );
}

export function BusinessWorkflowPanels({ app, surfacePath, surfaceTitle }: BusinessWorkflowPanelsProps) {
  if (surfacePath === '/solarsense/sites') return <EntityCrudPanel config={solarSenseSiteConfig} />;
  if (surfacePath === '/solarsense/assessments') return <EntityCrudPanel config={solarSenseAssessmentConfig} />;
  if (surfacePath === '/ecoaudit/audits') return <EntityCrudPanel config={ecoAuditAuditConfig} />;
  if (surfacePath === '/ecoaudit/zones') return <EntityCrudPanel config={ecoAuditZoneConfig} />;
  if (surfacePath === '/ecoaudit/equipment') return <EcoAuditEquipmentPanel />;
  if (surfacePath.endsWith('/photos')) return <FileBrowserPanel app={app} />;
  if (surfacePath.endsWith('/exports')) return <ZipDownloadPanel app={app} />;
  if (surfacePath.endsWith('/reports')) return <PdfJobPanel app={app} />;
  if (surfacePath === `/${app}`) return <OverviewPhasePanel app={app} />;
  return <CrudFoundationPanel app={app} surfaceTitle={surfaceTitle} />;
}
