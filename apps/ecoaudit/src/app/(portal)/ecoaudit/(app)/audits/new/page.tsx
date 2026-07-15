'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createAudit } from '@/api/audits';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';

export default function NewAuditPage() {
  const router = useRouter();
  const toast = useToast();
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [auditDate, setAuditDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const audit = await createAudit({ siteName, siteAddress, inspectorName, auditDate: auditDate || null });
      toast.success('Audit created successfully.');
      router.push(`/ecoaudit/audits/${audit.id}`);
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
      <PageHeader title="New audit" actions={<Link href="/ecoaudit/audits" className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card className="max-w-xl">
        <form onSubmit={handleSubmit}>
          <FieldLabel>Site name *</FieldLabel>
          <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} required />
          <FieldLabel>Site address *</FieldLabel>
          <Textarea value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} required />
          <FieldLabel>Inspector name *</FieldLabel>
          <Input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} required />
          <FieldLabel>Audit date</FieldLabel>
          <Input type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create audit'}</Button>
            <Link href="/ecoaudit/audits"><Button type="button" variant="secondary">Cancel</Button></Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
