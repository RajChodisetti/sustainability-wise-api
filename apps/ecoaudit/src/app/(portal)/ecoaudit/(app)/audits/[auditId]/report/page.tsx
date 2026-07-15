'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listZones } from '@/api/zones';
import { getAudit } from '@/api/audits';
import { generateReportPdfSync, pollPdfJob, startReportPdfJob, downloadPdfJob } from '@/api/pdf';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { downloadBlob, slugify } from '@/lib/download';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';

export default function ReportPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const toast = useToast();
  const [mode, setMode] = useState<'by-equipment' | 'by-zone'>('by-equipment');
  const [zoneId, setZoneId] = useState('');
  const [busy, setBusy] = useState<'sync' | 'async' | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId) });

  if (auditQuery.isLoading) return <Spinner />;
  if (auditQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditQuery.error)} />;
  const audit = auditQuery.data!;
  const zones = zonesQuery.data?.data ?? [];

  async function handleSyncPdf() {
    setBusy('sync');
    setProgress(null);
    try {
      const options = {
        mode,
        zoneIds: mode === 'by-zone' && zoneId ? [zoneId] : undefined,
      };
      const blob = await generateReportPdfSync(auditId!, options);
      downloadBlob(blob, `${slugify(audit.siteName)}-report.pdf`);
      toast.success('PDF downloaded.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAsyncPdf() {
    setBusy('async');
    try {
      const options = {
        mode,
        zoneIds: mode === 'by-zone' && zoneId ? [zoneId] : undefined,
      };
      const { jobId } = await startReportPdfJob(auditId!, options);
      await pollPdfJob(jobId, (s) => setProgress(s.phase ?? s.status));
      const blob = await downloadPdfJob(jobId);
      downloadBlob(blob, `${slugify(audit.siteName)}-report.pdf`);
      toast.success('PDF generated and downloaded.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <div>
      <PageHeader title="Generate report" subtitle="Choose the report structure, then use either the immediate or background PDF workflow." actions={<LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>} />
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
        {progress ? <p className="mt-4 rounded-lg bg-[var(--primary-soft)] px-3 py-2 text-sm font-semibold text-[var(--primary)]" role="status">{progress}</p> : null}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
          <Button onClick={() => void handleSyncPdf()} disabled={busy != null}>
            {busy === 'sync' ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                Downloading PDF…
              </>
            ) : (
              <><Icon name="file-text" size={18} />Download PDF (sync)</>
            )}
          </Button>
          <Button variant="secondary" onClick={() => void handleAsyncPdf()} disabled={busy != null}>
            {busy === 'async' ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                Generating PDF…
              </>
            ) : (
              <><Icon name="cloud" size={18} />Generate PDF (async)</>
            )}
          </Button>
        </div>
        {audit.reportPdfRemoteUrl ? (
          <p className="mt-4 text-xs text-[var(--text-sub)]">Last report URL on file.</p>
        ) : null}
      </Card>
    </div>
  );
}
