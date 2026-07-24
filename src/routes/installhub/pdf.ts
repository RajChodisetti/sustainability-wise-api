import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import {
  ihFormSubmissions,
  ihInstallations,
} from '../../db/schema/installhub.js';
import { pdfJobs, photoRegistry } from '../../db/schema/shared.js';
import { mergePdfBuffers } from '../../pdf/merge.js';
import { prepareCompressedPdfPhotos } from '../../pdf/photoCompression.js';
import { renderPdf } from '../../pdf/renderer.js';
import {
  completeJob,
  failJob,
  findActiveExportJob,
  markJobRunning,
  updateJobPhase,
  updateJobProgress,
  type ExportJobParams,
} from '../../services/pdfJobService.js';
import { enqueueExportTask } from '../../services/exportJobQueue.js';
import {
  makePdfStorageKeyFromName,
} from '../../services/storageNaming.js';
import {
  publicFileUrl,
  sanitizeStorageSegment,
  writeLocalFile,
} from '../../storage/localFiles.js';
import {
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import { mirrorPdfToOneDrive } from '../../onedrive/photoBackup.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { assertInstallationAccess } from './helpers.js';
import {
  buildInstallHubReportHtml,
  installHubReportNeedsChunks,
  installHubReportPhotoTotals,
  planInstallHubFormReportSlices,
  planInstallHubPackChunks,
  photosForInstallHubFormSlice,
  resolveInstallHubFormPhotos,
  visibleInstallHubReportSectionIndexes,
  type InstallHubFormReportSlice,
  type InstallHubReportAttachment,
  type InstallHubReportForm,
  type InstallHubReportInstallation,
  type InstallHubReportPhoto,
  type ResolvedInstallHubFormPhoto,
} from './reportHtml.js';
import {
  INSTALLHUB_REPORT_DEFINITION_BY_TYPE,
  INSTALLHUB_REPORT_MANIFEST_VERSION,
  type InstallHubReportFormType,
} from './reportManifest.js';

const MAX_PDF_BYTES = 300 * 1024 * 1024;
const brandLogoUrl = new URL('../../pdf/brand-logo.png', import.meta.url);
let brandLogoDataUriPromise: Promise<string> | null = null;

type InstallationRow = typeof ihInstallations.$inferSelect;
type FormRow = typeof ihFormSubmissions.$inferSelect;
type PhotoRow = typeof photoRegistry.$inferSelect;
type ReportMode = 'form' | 'installation-pack';

function loadBrandLogo(): Promise<string> {
  brandLogoDataUriPromise ??= readFile(brandLogoUrl)
    .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
    .catch((error) => {
      brandLogoDataUriPromise = null;
      throw error;
    });
  return brandLogoDataUriPromise;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function reportAttachments(value: unknown): InstallHubReportAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const attachment = item as Record<string, unknown>;
    const id = optionalText(attachment.id);
    const slot = optionalText(attachment.slot);
    const uri = optionalText(attachment.uri);
    const mimeType = optionalText(
      attachment.mimeType ?? attachment.mime_type,
    );
    const caption = optionalText(attachment.caption);
    const capturedAt = optionalText(
      attachment.capturedAt ?? attachment.captured_at,
    );
    if (!slot || !uri) return [];
    return [{
      ...(id ? { id } : {}),
      slot,
      uri,
      ...(mimeType ? { mimeType } : {}),
      ...(caption ? { caption } : {}),
      ...(capturedAt ? { capturedAt } : {}),
    }];
  });
}

function reportForm(row: FormRow): InstallHubReportForm {
  if (!(row.formType in INSTALLHUB_REPORT_DEFINITION_BY_TYPE)) {
    throw new Error(`Unsupported InstallHub report type: ${row.formType}`);
  }
  return {
    id: row.id,
    installationId: row.installationId,
    formType: row.formType as InstallHubReportFormType,
    schemaVersion: row.schemaVersion,
    status: row.status,
    answers: row.answers,
    attachments: reportAttachments(row.attachments),
    completedAt: row.completedAt,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function reportInstallation(row: InstallationRow): InstallHubReportInstallation {
  return {
    id: row.id,
    clientName: row.clientName,
    siteName: row.siteName,
    siteAddress: row.siteAddress,
    inspectorName: row.inspectorName,
    auditDate: row.auditDate,
    status: row.status,
  };
}

function reportPhoto(row: PhotoRow): InstallHubReportPhoto {
  return {
    id: row.id,
    entityId: row.entityId,
    fieldName: row.fieldName,
    storageKey: row.storageKey,
    remoteUrl: row.remoteUrl,
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt,
  };
}

async function loadInstallation(installationId: string): Promise<InstallationRow> {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(
      eq(ihInstallations.id, installationId),
      isNull(ihInstallations.deletedAt),
    ))
    .limit(1);
  if (!installation) throw notFound('Installation');
  return installation;
}

async function loadCompletedForms(
  installationId: string,
  formIds?: string[],
): Promise<FormRow[]> {
  const conditions = [
    eq(ihFormSubmissions.installationId, installationId),
    isNull(ihFormSubmissions.deletedAt),
  ];
  if (formIds) {
    if (formIds.length === 0) return [];
    conditions.push(inArray(ihFormSubmissions.id, formIds));
  } else {
    conditions.push(eq(ihFormSubmissions.status, 'Completed'));
  }
  const forms = await db
    .select()
    .from(ihFormSubmissions)
    .where(and(...conditions))
    .orderBy(asc(ihFormSubmissions.createdAt));

  if (formIds && forms.length !== formIds.length) {
    throw badRequest('One or more selected form submissions were not found');
  }
  const incomplete = forms.find((form) => form.status !== 'Completed');
  if (incomplete) {
    throw badRequest(`Form ${incomplete.id} must be Completed before PDF generation`);
  }
  return forms;
}

function uniquePhotoRows(rows: PhotoRow[]): PhotoRow[] {
  const byId = new Map<string, PhotoRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

function selectedResolvedPhotos(
  formsById: Map<string, InstallHubReportForm>,
  resolvedByForm: Map<string, ResolvedInstallHubFormPhoto[]>,
  slices: InstallHubFormReportSlice[],
): Map<string, ResolvedInstallHubFormPhoto[]> {
  const selected = new Map<string, ResolvedInstallHubFormPhoto[]>();
  for (const slice of slices) {
    const form = formsById.get(slice.formId);
    if (!form) continue;
    const photos = photosForInstallHubFormSlice(
      form,
      resolvedByForm.get(form.id) ?? [],
      slice.sectionIndexes,
    );
    const existing = selected.get(form.id) ?? [];
    const seen = new Set(existing.map((item) => item.attachmentIndex));
    for (const photo of photos) {
      if (!seen.has(photo.attachmentIndex)) existing.push(photo);
    }
    selected.set(form.id, existing);
  }
  return selected;
}

async function compressResolvedPhotos(
  selected: Map<string, ResolvedInstallHubFormPhoto[]>,
  scopedPhotoRows: PhotoRow[],
): Promise<Map<string, ResolvedInstallHubFormPhoto[]>> {
  const photoIds = new Set(
    [...selected.values()].flatMap((photos) =>
      photos.map((photo) => photo.photo.id),
    ),
  );
  const raw = uniquePhotoRows(
    scopedPhotoRows.filter((photo) => photoIds.has(photo.id)),
  );
  const compressed = await prepareCompressedPdfPhotos(raw);
  const compressedById = new Map(compressed.map((photo) => [photo.id, photo]));
  const result = new Map<string, ResolvedInstallHubFormPhoto[]>();

  for (const [formId, photos] of selected) {
    result.set(formId, photos.map((resolved) => {
      const replacement = compressedById.get(resolved.photo.id);
      if (!replacement?.remoteUrl?.startsWith('data:image/')) {
        throw new Error(
          `Original evidence ${resolved.photo.id} could not be prepared for PDF rendering`,
        );
      }
      return {
        ...resolved,
        photo: reportPhoto(replacement),
      };
    }));
  }
  return result;
}

function allFormSlices(
  forms: InstallHubReportForm[],
  resolvedByForm: Map<string, ResolvedInstallHubFormPhoto[]>,
): InstallHubFormReportSlice[] {
  return forms.map((form) => ({
    formId: form.id,
    sectionIndexes: visibleInstallHubReportSectionIndexes(form),
    continuation: false,
    photoCount: resolvedByForm.get(form.id)?.length ?? 0,
  }));
}

async function renderInstallHubReport(args: {
  installation: InstallationRow;
  formRows: FormRow[];
  mode: ReportMode;
  onPhase?: (phase: string) => void | Promise<void>;
  onProgress?: (current: number, total: number) => void | Promise<void>;
}): Promise<Buffer> {
  const installation = reportInstallation(args.installation);
  const forms = args.formRows.map(reportForm);
  const formsById = new Map(forms.map((form) => [form.id, form]));
  const formIds = new Set(forms.map((form) => form.id));
  const scopedPhotoRows = (await loadPhotosForParent({
    app: 'installhub',
    parentId: installation.id,
  })).filter((photo) => formIds.has(photo.entityId));
  const reportPhotoRows = scopedPhotoRows.map(reportPhoto);
  const resolvedByForm = new Map(
    forms.map((form) => [
      form.id,
      resolveInstallHubFormPhotos(form, reportPhotoRows),
    ]),
  );
  const totals = installHubReportPhotoTotals(
    [...resolvedByForm.values()].flat(),
  );
  const chunked = installHubReportNeedsChunks(totals);
  const chunks: InstallHubFormReportSlice[][] =
    chunked
      ? args.mode === 'form' && forms[0]
        ? planInstallHubFormReportSlices(
            forms[0],
            resolvedByForm.get(forms[0].id) ?? [],
          ).map((slice) => [slice])
        : planInstallHubPackChunks(forms, resolvedByForm)
      : [allFormSlices(forms, resolvedByForm)];

  await args.onPhase?.(
    chunked
      ? `Rendering large PDF in ${chunks.length} part${chunks.length === 1 ? '' : 's'}`
      : `Rendering PDF (${totals.count} photo${totals.count === 1 ? '' : 's'})`,
  );

  const logoDataUri = await loadBrandLogo();
  const generatedLabel = `Generated ${new Date().toLocaleDateString('en-AU')}`;
  const parts: Buffer[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const slices = chunks[index];
    const selected = selectedResolvedPhotos(
      formsById,
      resolvedByForm,
      slices,
    );
    const compressed = await compressResolvedPhotos(selected, scopedPhotoRows);
    const html = buildInstallHubReportHtml({
      mode: args.mode,
      installation,
      forms,
      slices,
      resolvedByForm: compressed,
      logoDataUri,
      includeIntro: index === 0,
      includeEnd: index === chunks.length - 1,
      generatedLabel,
      summaryPhotoCount: totals.count,
    });
    parts.push(await renderPdf(html));
    await args.onProgress?.(index + 1, chunks.length);
  }
  return mergePdfBuffers(parts);
}

function reportFilename(
  installation: InstallationRow,
  form?: FormRow,
): string {
  const base = form
    ? INSTALLHUB_REPORT_DEFINITION_BY_TYPE[
        form.formType as InstallHubReportFormType
      ]?.shortTitle ?? 'form'
    : 'installation-pack';
  return `${sanitizeStorageSegment(installation.siteName)}-${sanitizeStorageSegment(base)}.pdf`;
}

async function saveInstallHubReport(args: {
  installation: InstallationRow;
  formRows: FormRow[];
  mode: ReportMode;
  onPhase?: (phase: string) => void | Promise<void>;
  onProgress?: (current: number, total: number) => void | Promise<void>;
}): Promise<{ storageKey: string; remoteUrl: string }> {
  const pdf = await renderInstallHubReport(args);
  if (pdf.byteLength > MAX_PDF_BYTES) {
    console.warn('[pdf] InstallHub PDF exceeded preferred size limit', {
      installationId: args.installation.id,
      actualSizeBytes: pdf.byteLength,
      preferredMaxSizeBytes: MAX_PDF_BYTES,
    });
  }
  await args.onPhase?.('Saving PDF');
  const filename = reportFilename(
    args.installation,
    args.mode === 'form' ? args.formRows[0] : undefined,
  );
  const storageKey = makePdfStorageKeyFromName({
    app: 'installhub',
    parentName: args.installation.siteName,
    fieldName:
      args.mode === 'form'
        ? `form-${args.formRows[0]?.id ?? 'report'}-pdf`
        : 'installation-pack-pdf',
    sessionId: randomUUID(),
    filename,
  });
  await writeLocalFile(storageKey, pdf);
  await mirrorPdfToOneDrive({
    filename,
    storageKey,
    body: pdf,
  });
  return { storageKey, remoteUrl: publicFileUrl(storageKey) };
}

async function runInstallHubPdfJob(args: {
  jobId: string;
  installationId: string;
  formIds: string[];
  mode: ReportMode;
}): Promise<void> {
  try {
    await markJobRunning(args.jobId, 'Starting');
    const installation = await loadInstallation(args.installationId);
    // The authenticated route has already established access. Background
    // reconciliation may remap existing trusted grants but cannot create one.
    await reconcilePhotoCopyReferencesForParent({
      app: 'installhub',
      parentId: installation.id,
    });
    const forms = await loadCompletedForms(
      installation.id,
      args.mode === 'form' ? args.formIds : (args.formIds.length ? args.formIds : undefined),
    );
    const result = await saveInstallHubReport({
      installation,
      formRows: forms,
      mode: args.mode,
      onPhase: (phase) => updateJobPhase(args.jobId, phase),
      onProgress: (current, total) =>
        updateJobProgress(
          args.jobId,
          `Rendering PDF part ${current} of ${total}`,
          current,
          total,
        ),
    });
    await completeJob(args.jobId, result.remoteUrl, result.storageKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(args.jobId, message);
    console.error('[pdf-job] InstallHub job failed', {
      jobId: args.jobId,
      installationId: args.installationId,
      error: message,
    });
  }
}

function sourceUpdatedAt(
  installation: InstallationRow,
  forms: FormRow[],
): string {
  const [latest] = [
    installation.updatedAt,
    ...forms.map((form) => form.updatedAt),
  ].sort((left, right) => right.getTime() - left.getTime());
  return (latest ?? installation.updatedAt).toISOString();
}

async function queueInstallHubPdfJob(args: {
  request: FastifyRequest;
  installation: InstallationRow;
  forms: FormRow[];
  mode: ReportMode;
}) {
  const entityId =
    args.mode === 'form'
      ? args.forms[0]?.id
      : args.installation.id;
  if (!entityId) throw badRequest('A form is required for form PDF generation');
  const formIds = args.forms.map((form) => form.id);
  const params: ExportJobParams = {
    artifactType: 'pdf',
    filename: reportFilename(
      args.installation,
      args.mode === 'form' ? args.forms[0] : undefined,
    ),
    contentType: 'application/pdf',
    reportMode: args.mode,
    rendererVersion: INSTALLHUB_REPORT_MANIFEST_VERSION,
    formIds,
    sourceUpdatedAt: sourceUpdatedAt(args.installation, args.forms),
  };
  const active = await findActiveExportJob({
    app: 'installhub',
    entityId,
    userId: args.request.user.userId,
    params,
  });
  if (active) return { jobId: active.id, reused: true };

  const jobId = randomUUID();
  await db.insert(pdfJobs).values({
    id: jobId,
    app: 'installhub',
    entityId,
    entityType:
      args.mode === 'form' ? 'form_submission' : 'installation',
    userId: args.request.user.userId,
    params,
    status: 'queued',
    phase: 'Queued',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  void enqueueExportTask(() =>
    runInstallHubPdfJob({
      jobId,
      installationId: args.installation.id,
      formIds,
      mode: args.mode,
    }),
  ).catch((error) => {
    console.error('[pdf-job] InstallHub queue failed', {
      jobId,
      installationId: args.installation.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return { jobId, reused: false };
}

const protectedPdfRoute = [
  authenticate,
  requireApp('installhub'),
  requireRole('inspector'),
];

export async function installhubPdfRoutes(app: FastifyInstance): Promise<void> {
  app.post('/installations/:installationId/forms/:formId/report/pdf/jobs', {
    schema: {
      tags: ['InstallHub PDF'],
      summary: 'Start an async InstallHub form PDF job',
      description:
        'Queues a Sustainability Wise form PDF from a completed, backed-up InstallHub form.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['installationId', 'formId'],
        properties: {
          installationId: { type: 'string' },
          formId: { type: 'string' },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            reused: { type: 'boolean' },
          },
        },
      },
    },
    preHandler: protectedPdfRoute,
  }, async (request, reply) => {
    const { installationId, formId } = request.params as {
      installationId: string;
      formId: string;
    };
    const installation = await loadInstallation(installationId);
    assertInstallationAccess(installation, request.user);
    const forms = await loadCompletedForms(installation.id, [formId]);
    await reconcilePhotoCopyReferencesForParent({
      app: 'installhub',
      parentId: installation.id,
      actor: request.user,
    });
    return reply.status(202).send(await queueInstallHubPdfJob({
      request,
      installation,
      forms,
      mode: 'form',
    }));
  });

  app.post('/installations/:installationId/report/pdf/jobs', {
    schema: {
      tags: ['InstallHub PDF'],
      summary: 'Start an async InstallHub installation-pack PDF job',
      description:
        'Queues an installation summary and selected or all completed form submissions.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['installationId'],
        properties: {
          installationId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          formSubmissionIds: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            reused: { type: 'boolean' },
          },
        },
      },
    },
    preHandler: protectedPdfRoute,
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = (request.body ?? {}) as { formSubmissionIds?: unknown };
    const selectedIds = Array.isArray(body.formSubmissionIds)
      ? [...new Set(
          body.formSubmissionIds.filter(
            (value): value is string =>
              typeof value === 'string' && value.trim().length > 0,
          ),
        )]
      : undefined;
    const installation = await loadInstallation(installationId);
    assertInstallationAccess(installation, request.user);
    const forms = await loadCompletedForms(installation.id, selectedIds);
    await reconcilePhotoCopyReferencesForParent({
      app: 'installhub',
      parentId: installation.id,
      actor: request.user,
    });
    return reply.status(202).send(await queueInstallHubPdfJob({
      request,
      installation,
      forms,
      mode: 'installation-pack',
    }));
  });
}
