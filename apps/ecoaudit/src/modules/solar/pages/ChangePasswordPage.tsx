'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@solar/contexts/AuthContext';
import { changePassword } from '@solar/api/users';
import { Button } from '@solar/components/ui/Button';
import { Card, ErrorBanner, PageHeader } from '@solar/components/ui/Card';
import { FieldLabel, Input } from '@solar/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';

import { cloudConnectionErrorMessage } from '@solar/api/client';

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
    if (newPassword.length < 8) {
      const msg = 'New password must be at least 8 characters.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (newPassword !== confirmPassword) {
      const msg = 'Passwords do not match.';
      setError(msg);
      toast.error(msg);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(user.id, currentPassword, newPassword);
      toast.success('Password updated successfully.');
      router.push('/solar/settings');
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
      <PageHeader title="Change password" actions={<Link href="/solar/settings" className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card className="max-w-md">
        <form onSubmit={handleSubmit}>
          <FieldLabel>Current password</FieldLabel>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <FieldLabel>New password</FieldLabel>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <FieldLabel>Confirm new password</FieldLabel>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</Button>
            <Button type="button" variant="secondary" onClick={() => router.push('/solar/settings')}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
