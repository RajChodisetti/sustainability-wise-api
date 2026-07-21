'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { completeSite, deleteSite, getSite } from '@solar/api/sites';
import { startPhotosZipJob } from '@solar/api/photos';
import {
  downloadExportJob,
  getExportJobStatus,
  getLatestExportJob,
  startSitePackPdfJob,
} from '@solar/api/pdf';
import { useAssessmentsForSite } from '@solar/hooks/useAssessments';
import { SitePackReportModal } from '@solar/components/reports/SitePackReportModal';
import type { SitePackReportOptions } from '@solar/lib/reportConfig';
import { slugify } from '@solar/lib/download';
import { Button, LinkButton } from '@solar/components/ui/Button';
import { DealBreakerFlag, RAGBadge, StatusBadge, ViabilityBadge } from '@solar/components/ui/Badges';
import { Card, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { Icon } from '@/components/ui/Icon';


function asId(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}


export default function SiteDetailPage() {
  const params = useParams();
  const siteId = asId(params.siteId);
  if (!siteId) return <ErrorBanner message="Site not found." />;
  return <SiteDetailContent key={siteId} siteId={siteId} />;
}

function SiteDetailContent({ siteId }: { siteId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reportOpen, setReportOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const siteQuery = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => getSite(siteId!),
    enabled: Boolean(siteId),
  });
  const assessmentsQuery = useAssessmentsForSite(siteId);
  const pdfJob = useExportJob({
    scopeKey: ['solarsense', siteId, 'site-pack-pdf'],
    loadLatest: () => getLatestExportJob(siteId, 'pdf'),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id, job.contentType),
    fallbackFilename: `${slugify(siteQuery.data?.siteName ?? 'site')}-site-pack.pdf`,
  });
  const zipJob = useExportJob({
    scopeKey: ['solarsense', siteId, 'photos-zip'],
    loadLatest: () => getLatestExportJob(siteId, 'photos-zip'),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id, job.contentType),
    fallbackFilename: `${slugify(siteQuery.data?.siteName ?? 'site')}-photos.zip`,
  });

  if (siteQuery.isLoading || assessmentsQuery.isLoading) return <Spinner />;
  if (siteQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(siteQuery.error)} />;
  const site = siteQuery.data;
  if (!site) return <ErrorBanner message="Site not found." />;
  const assessments = assessmentsQuery.data ?? [];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['site', siteId] }),
      queryClient.invalidateQueries({ queryKey: ['assessments', siteId] }),
      queryClient.invalidateQueries({ queryKey: ['sites'] }),
    ]);
  }

  async function handleComplete() {
    try {
      await completeSite(siteId!);
      await refresh();
      toast.success('Site marked as completed.');
    } catch (e) {
      const msg = cloudConnectionErrorMessage(e);
      setActionError(msg);
      toast.error(msg);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this site?')) return;
    try {
      await deleteSite(siteId!, true);
      toast.success('Site deleted successfully.');
      router.push('/solar/sites');
    } catch (e) {
      const msg = cloudConnectionErrorMessage(e);
      setActionError(msg);
      toast.error(msg);
    }
  }

  async function handleExportZip() {
    if (zipJob.starting || zipJob.active) return;
    setActionError(null);
    try {
      await zipJob.start(() => startPhotosZipJob(siteId));
      toast.success('Photo ZIP preparation started. The download will appear here when it is ready.');
    } catch (e) {
      const msg = cloudConnectionErrorMessage(e);
      setActionError(msg);
      toast.error(msg);
    }
  }

  async function handleDownloadZip() {
    setActionError(null);
    try {
      await zipJob.download();
      toast.success('Photo ZIP download started.');
    } catch (e) {
      const msg = cloudConnectionErrorMessage(e);
      setActionError(msg);
      toast.error(msg);
    }
  }

  async function handleGeneratePdf(_options: SitePackReportOptions, assessmentIds: string[]) {
    setActionError(null);
    try {
      await pdfJob.start(() => startSitePackPdfJob(siteId, assessmentIds, {
        includeRagFramework: _options.includeRagFramework,
        includeAppendix: _options.includeAppendix,
        includedPhotoUris: [..._options.includedPhotoUris],
      }));
      setReportOpen(false);
      toast.success('PDF generation started. The download will appear here when it is ready.');
    } catch (e) {
      const msg = cloudConnectionErrorMessage(e);
      setActionError(msg);
      toast.error(msg);
    }
  }

  async function handleDownloadPdf() {
    setActionError(null);
    try {
      await pdfJob.download();
      toast.success('PDF download started.');
    } catch (e) {
      const msg = cloudConnectionErrorMessage(e);
      setActionError(msg);
      toast.error(msg);
    }
  }

  return (
    <div>
      <PageHeader
        title={site.siteName}
        subtitle={site.location || 'Site details'}
        actions={
          <>
            <StatusBadge status={site.status} />
            <LinkButton href={`/solar/sites/${siteId}/edit`} variant="secondary">Edit</LinkButton>
            {site.status !== 'Completed' ? <Button variant="secondary" onClick={() => void handleComplete()}>Mark complete</Button> : null}
            <Button variant="secondary" onClick={() => setReportOpen(true)} disabled={pdfJob.starting || pdfJob.active}>
              <Icon name="file-text" size={17} />
              {pdfJob.starting || pdfJob.active ? 'Preparing PDF...' : 'Generate PDF'}
            </Button>
            <Button variant="secondary" onClick={() => void handleExportZip()} disabled={zipJob.starting || zipJob.active}>
              <Icon name="camera" size={17} />
              {zipJob.starting || zipJob.active ? 'Preparing ZIP...' : 'Export photos ZIP'}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()}>Delete</Button>
          </>
        }
      />

      <div className="mb-5 space-y-3">
        <ExportJobStatus
          job={pdfJob.job}
          artifactName="PDF"
          starting={pdfJob.starting}
          downloading={pdfJob.downloading}
          onDownload={() => void handleDownloadPdf()}
        />
        <ExportJobStatus
          job={zipJob.job}
          artifactName="photo ZIP"
          starting={zipJob.starting}
          downloading={zipJob.downloading}
          onDownload={() => void handleDownloadZip()}
        />
      </div>

      {actionError ? <div className="mb-4"><ErrorBanner message={actionError} /></div> : null}
      {!actionError && (pdfJob.error || zipJob.error) ? (
        <div className="mb-4"><ErrorBanner message={cloudConnectionErrorMessage(pdfJob.error || zipJob.error)} /></div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-[var(--text)]">Site information</h2>
          <dl className="space-y-2 text-sm">
            {[
              ['Date of assessment', site.dateOfAssessment],
              ['Classification', site.documentClassification],
              ['Electrical summary', site.electricalInfrastructureSummary],
              ['Known constraints', site.knownConstraints],
              ['Load profile / metering', site.loadProfileMeteringSummary],
              ['PPA demarcation', site.ppaAssetDemarcation],
              ['Appendix notes', site.appendixNotes],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase text-[var(--text-sub)]">{label}</dt>
                <dd className="text-[var(--text)]">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-[var(--text)]">Building assessments</h2>
            <LinkButton href={`/solar/sites/${siteId}/assessments/new`} className="!px-3 !text-xs">Add building</LinkButton>
          </div>
          {assessments.length === 0 ? (
            <p className="text-sm text-[var(--text-sub)]">No assessments yet.</p>
          ) : (
            <div className="space-y-2">
              {assessments.map((a) => (
                <Link key={a.id} href={`/solar/sites/${siteId}/assessments/${a.id}`} className="interactive-card block rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--text)]">{a.buildingIdName}</p>
                    <StatusBadge status={a.status} />
                    <ViabilityBadge value={a.viabilityStatus} />
                    <RAGBadge value={a.ragPriority} />
                    <DealBreakerFlag active={a.heritageDealBreaker} label="Heritage DB" />
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">
                    {a.pvSizeKwDc ? `${a.pvSizeKwDc} kW DC` : '—'} · {a.acExportKw ? `${a.acExportKw} kW AC` : '—'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <SitePackReportModal
        open={reportOpen}
        siteName={site.siteName}
        assessments={assessments}
        onClose={() => setReportOpen(false)}
        onGenerate={(opts, ids) => void handleGeneratePdf(opts, ids)}
        busy={pdfJob.starting}
      />
    </div>
  );
}
