'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listZones } from '@/api/zones';
import { getAudit } from '@/api/audits';
import {
  downloadExportJob,
  getExportJobStatus,
  getLatestExportJob,
  startReportPdfJob,
} from '@/api/pdf';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { slugify } from '@/lib/download';
import { useExportJob } from '@/hooks/useExportJob';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';

export default function ReportPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const toast = useToast();
  const [mode, setMode] = useState<'by-equipment' | 'by-zone'>('by-equipment');
  const [zoneId, setZoneId] = useState('');

  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId) });
  const reportJob = useExportJob({
    scopeKey: ['ecoaudit', auditId ?? '', 'report-pdf'],
    loadLatest: () => getLatestExportJob(auditId!, 'pdf'),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id, job.contentType),
    fallbackFilename: `${slugify(auditQuery.data?.siteName ?? 'audit')}-report.pdf`,
  });

  if (auditQuery.isLoading || zonesQuery.isLoading) return <Spinner />;
  if (auditQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditQuery.error)} />;
  if (zonesQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(zonesQuery.error)} />;
  const zones = zonesQuery.data?.data ?? [];

  async function handleGeneratePdf() {
    try {
      const options = {
        mode,
        zoneIds: mode === 'by-zone' && zoneId ? [zoneId] : undefined,
      };
      await reportJob.start(() => startReportPdfJob(auditId!, options));
      toast.success('PDF generation started. The download will appear here when it is ready.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  async function handleDownloadPdf() {
    try {
      await reportJob.download();
      toast.success('PDF download started.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader title="Generate report" subtitle="Choose how audit information is organised in the report." actions={<LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>} />
      <Card className="max-w-2xl">
        <FieldLabel htmlFor="report-mode">Report mode</FieldLabel>
        <Select id="report-mode" value={mode} onChange={(e) => setMode(e.target.value as 'by-equipment' | 'by-zone')}>
          <option value="by-equipment">By equipment</option>
          <option value="by-zone">By zone</option>
        </Select>
        {mode === 'by-zone' ? (
          <>
            <FieldLabel htmlFor="report-zone">Zone filter (optional)</FieldLabel>
            <Select id="report-zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">All zones</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.zoneName}</option>)}
            </Select>
          </>
        ) : null}
        <ExportJobStatus
          job={reportJob.job}
          artifactName="PDF"
          starting={reportJob.starting}
          downloading={reportJob.downloading}
          onDownload={() => void handleDownloadPdf()}
          className="mt-5"
        />
        {reportJob.error ? <div className="mt-4"><ErrorBanner message={cloudConnectionErrorMessage(reportJob.error)} /></div> : null}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
          <Button onClick={() => void handleGeneratePdf()} disabled={reportJob.starting || reportJob.active} aria-busy={reportJob.starting || reportJob.active}>
            {reportJob.starting || reportJob.active ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                Preparing PDF...
              </>
            ) : (
              <><Icon name="file-text" size={18} />{reportJob.job?.status === 'complete' ? 'Generate new PDF' : 'Generate PDF'}</>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
