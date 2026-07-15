'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getAudit, updateAudit } from '@/api/audits';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import type { Audit } from '@/types/domain';

export default function EditAuditPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const query = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });

  if (!auditId) return <ErrorBanner message="Audit not found." />;
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  if (query.data?.status === 'Completed') return <ErrorBanner message="Completed audits cannot be edited." />;
  if (!query.data) return <ErrorBanner message="Audit not found." />;

  return <EditAuditForm key={query.data.id} auditId={auditId} audit={query.data} />;
}

function EditAuditForm({ auditId, audit }: { auditId: string; audit: Audit }) {
  const router = useRouter();
  const toast = useToast();
  const [siteName, setSiteName] = useState(audit.siteName);
  const [siteAddress, setSiteAddress] = useState(audit.siteAddress);
  const [inspectorName, setInspectorName] = useState(audit.inspectorName);
  const [auditDate, setAuditDate] = useState(audit.auditDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateAudit(auditId!, { siteName, siteAddress, inspectorName, auditDate: auditDate || null });
      toast.success('Audit updated.');
      router.push(`/ecoaudit/audits/${auditId}`);
    } catch (err) {
      const msg = cloudConnectionErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Edit audit" actions={<LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>} />
      <Card className="max-w-xl">
        <form onSubmit={handleSubmit}>
          <FieldLabel>Site name</FieldLabel>
          <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} required />
          <FieldLabel>Site address</FieldLabel>
          <Textarea value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} required />
          <FieldLabel>Inspector name</FieldLabel>
          <Input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} required />
          <FieldLabel>Audit date</FieldLabel>
          <Input type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <Button type="submit" className="mt-4" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </form>
      </Card>
    </div>
  );
}
