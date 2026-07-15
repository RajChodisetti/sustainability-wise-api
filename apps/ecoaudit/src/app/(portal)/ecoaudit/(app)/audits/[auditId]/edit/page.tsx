'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getAudit, updateAudit } from '@/api/audits';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';

export default function EditAuditPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const router = useRouter();
  const toast = useToast();
  const query = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });

  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [auditDate, setAuditDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = query.data;
    if (!a) return;
    setSiteName(a.siteName);
    setSiteAddress(a.siteAddress);
    setInspectorName(a.inspectorName);
    setAuditDate(a.auditDate ?? '');
  }, [query.data]);

  if (!auditId) return <ErrorBanner message="Audit not found." />;
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  if (query.data?.status === 'Completed') return <ErrorBanner message="Completed audits cannot be edited." />;

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
      <PageHeader title="Edit audit" actions={<Link href={`/ecoaudit/audits/${auditId}`} className="text-sm text-[var(--primary)]">Back</Link>} />
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
