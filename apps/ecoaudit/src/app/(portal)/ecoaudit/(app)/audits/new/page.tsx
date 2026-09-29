'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAudit } from '@/api/audits';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import {
  auditProtocolErrorMessage,
  beginPendingAuditCreateCommand,
  clearPendingAuditCommand,
  getPendingAuditCreateCommand,
  isDefinitiveAuditCommandRejection,
  storeAuditLeaseDurably,
  type PendingAuditCreateCommand,
} from '@/lib/auditProtocol';

export default function NewAuditPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [auditDate, setAuditDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingAuditCreateCommand | null>(null);
  const resumeActorUserId = useRef<string | null>(null);
  const activeActorUserId = useRef<string | null>(user?.id ?? null);
  const inFlightCommandId = useRef<string | null>(null);
  const siteNameId = useId();
  const siteAddressId = useId();
  const inspectorId = useId();
  const auditDateId = useId();

  useLayoutEffect(() => {
    activeActorUserId.current = user?.id ?? null;
  }, [user?.id]);

  const executeCreateCommand = useCallback(async (command: PendingAuditCreateCommand) => {
    if (
      activeActorUserId.current !== command.actorUserId
      || inFlightCommandId.current === command.idempotencyKey
    ) return;
    inFlightCommandId.current = command.idempotencyKey;
    setPendingCommand(command);
    setBusy(true);
    setError(null);
    try {
      const result = await createAudit(command);
      if (activeActorUserId.current !== command.actorUserId) {
        throw new Error('The signed-in account changed while the saved command was running. Sign back into the original account to recover it safely.');
      }
      const leaseStored = storeAuditLeaseDurably({
        auditId: result.audit.id,
        clientInstanceId: command.clientInstanceId,
        leaseToken: result.leaseToken,
        editFence: result.editFence,
      });
      if (!leaseStored) {
        throw new Error('The audit was created, but this browser could not save its editing access. The saved command will retry safely.');
      }
      if (!clearPendingAuditCommand(command)) {
        throw new Error('The audit was created, but the saved command could not be cleared. Retry to finish safely.');
      }
      setPendingCommand(null);
      toast.success('Audit created successfully.');
      router.push(`/ecoaudit/audits/${result.audit.id}`);
    } catch (err) {
      if (isDefinitiveAuditCommandRejection(err) && clearPendingAuditCommand(command)) {
        setPendingCommand(null);
      }
      const msg = auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      if (inFlightCommandId.current === command.idempotencyKey) {
        inFlightCommandId.current = null;
        setBusy(false);
      }
    }
  }, [router, toast]);

  useEffect(() => {
    const actorUserId = user?.id ?? null;
    const scope = actorUserId ?? 'signed-out';
    if (resumeActorUserId.current === scope) return;
    resumeActorUserId.current = scope;
    const command = actorUserId ? getPendingAuditCreateCommand(actorUserId) : null;
    const timer = window.setTimeout(() => {
      setPendingCommand(command);
      if (!command) {
        setSiteName('');
        setSiteAddress('');
        setInspectorName('');
        setAuditDate('');
        return;
      }
      setSiteName(command.body.siteName);
      setSiteAddress(command.body.siteAddress);
      setInspectorName(command.body.inspectorName);
      setAuditDate(command.body.auditDate ?? '');
      void executeCreateCommand(command);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [executeCreateCommand, user?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!user?.id) throw new Error('Sign in before creating an audit.');
      const command = beginPendingAuditCreateCommand({
        siteName,
        siteAddress,
        inspectorName,
        auditDate: auditDate || null,
      }, user.id);
      await executeCreateCommand(command);
    } catch (err) {
      const msg = auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err);
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <div>
      <PageHeader title="New audit" subtitle="Set up the core site and inspection details." actions={<LinkButton href="/ecoaudit/audits" variant="secondary">Back</LinkButton>} />
      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <FieldLabel htmlFor={siteNameId}>Site name *</FieldLabel>
          <Input id={siteNameId} value={siteName} onChange={(e) => setSiteName(e.target.value)} required disabled={busy || pendingCommand !== null} />
          <FieldLabel htmlFor={siteAddressId}>Site address *</FieldLabel>
          <Textarea id={siteAddressId} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} required disabled={busy || pendingCommand !== null} />
          <FieldLabel htmlFor={inspectorId}>Inspector name *</FieldLabel>
          <Input id={inspectorId} value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} required disabled={busy || pendingCommand !== null} />
          <FieldLabel htmlFor={auditDateId}>Audit date</FieldLabel>
          <Input id={auditDateId} type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} disabled={busy || pendingCommand !== null} />
          {pendingCommand ? (
            <p className="mt-3 text-sm text-[var(--text-sub)]">
              A saved create request is pending. Retries use its exact details so a lost response cannot create a duplicate audit.
            </p>
          ) : null}
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : pendingCommand ? 'Retry saved audit' : 'Create audit'}</Button>
            <LinkButton href="/ecoaudit/audits" variant="secondary">Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
