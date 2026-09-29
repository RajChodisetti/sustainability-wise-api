'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { updateAudit } from '@/api/audits';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import type { Audit, AuditTree, AuditWriteGuard } from '@/types/domain';
import { useAuditAuthority } from '@/hooks/useAuditAuthority';
import { AuditAuthorityBanner } from '@/components/audits/AuditAuthorityBanner';
import { auditProtocolErrorMessage } from '@/lib/auditProtocol';

export default function EditAuditPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const authority = useAuditAuthority(auditId);

  if (!auditId) return <ErrorBanner message="Audit not found." />;
  if (authority.query.error) return <ErrorBanner message={cloudConnectionErrorMessage(authority.query.error)} />;
  if (!authority.authoritativeReady) return <Spinner label="Checking editing access…" />;
  if (!authority.audit || !authority.state) return <ErrorBanner message="Audit not found." />;

  return (
    <div>
      <PageHeader title="Edit audit" actions={<LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>} />
      <AuditAuthorityBanner
        state={authority.state}
        lease={authority.audit.editLease}
        changedSinceOpen={authority.changedSinceOpen}
        onRefresh={() => void authority.refreshAndAccept()}
        refreshing={authority.query.isFetching}
      />
      {authority.guard ? (
        <EditAuditForm
          key={`${authority.audit.id}-${authority.openedRevision}`}
          auditId={auditId}
          audit={authority.audit}
          guard={authority.guard}
          onMutationAccepted={authority.refreshAndAccept}
        />
      ) : null}
    </div>
  );
}

function EditAuditForm({
  auditId,
  audit,
  guard,
  onMutationAccepted,
}: {
  auditId: string;
  audit: Audit;
  guard: AuditWriteGuard;
  onMutationAccepted: () => Promise<AuditTree | null>;
}) {
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
      await updateAudit(auditId!, { siteName, siteAddress, inspectorName, auditDate: auditDate || null }, guard);
      if (!await onMutationAccepted()) {
        throw new Error('The audit was saved, but the latest cloud revision could not be accepted. Refresh before continuing.');
      }
      toast.success('Audit updated.');
      router.push(`/ecoaudit/audits/${auditId}`);
    } catch (err) {
      const msg = auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}
