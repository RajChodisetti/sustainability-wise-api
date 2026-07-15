'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { changePassword } from '@/api/users';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader } from '@/components/ui/Card';
import { FieldLabel, Input } from '@/components/ui/FormFields';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (newPassword.length < 6) { setError('Min 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await changePassword(user.id, currentPassword, newPassword);
      toast.success('Password updated.');
      router.push('/ecoaudit/settings');
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
      <PageHeader title="Change password" actions={<Link href="/ecoaudit/settings" className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card className="max-w-md">
        <form onSubmit={handleSubmit}>
          <FieldLabel>Current password</FieldLabel>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <FieldLabel>New password</FieldLabel>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <FieldLabel>Confirm</FieldLabel>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <Button type="submit" className="mt-4" disabled={busy}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
