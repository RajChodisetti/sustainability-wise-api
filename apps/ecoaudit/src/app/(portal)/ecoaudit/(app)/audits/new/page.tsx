'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAudit } from '@/api/audits';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
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
  const siteNameId = useId();
  const siteAddressId = useId();
  const inspectorId = useId();
  const auditDateId = useId();

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
      <PageHeader title="New audit" subtitle="Set up the core site and inspection details." actions={<LinkButton href="/ecoaudit/audits" variant="secondary">Back</LinkButton>} />
      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <FieldLabel htmlFor={siteNameId}>Site name *</FieldLabel>
          <Input id={siteNameId} value={siteName} onChange={(e) => setSiteName(e.target.value)} required />
          <FieldLabel htmlFor={siteAddressId}>Site address *</FieldLabel>
          <Textarea id={siteAddressId} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} required />
          <FieldLabel htmlFor={inspectorId}>Inspector name *</FieldLabel>
          <Input id={inspectorId} value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} required />
          <FieldLabel htmlFor={auditDateId}>Audit date</FieldLabel>
          <Input id={auditDateId} type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create audit'}</Button>
            <LinkButton href="/ecoaudit/audits" variant="secondary">Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
