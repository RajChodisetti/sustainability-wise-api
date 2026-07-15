'use client';

import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner } from '@/components/ui/Card';
import { FieldLabel, Input } from '@/components/ui/FormFields';
import { API_DISPLAY_URL } from '@/lib/config';
import { useState } from 'react';

export function AuthForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (data: { username: string; password: string }) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ username: username.trim().toLowerCase(), password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-black text-[var(--primary)]">EcoSense Portal</h1>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">Sign in to continue</p>
        </div>
        <Card>
          <form onSubmit={handleSubmit} className="space-y-1">
            <FieldLabel>Username</FieldLabel>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              required
              autoComplete="username"
            />
            <FieldLabel>Password</FieldLabel>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            {error ? (
              <div className="mt-3">
                <ErrorBanner message={error} />
              </div>
            ) : null}
            <Button type="submit" className="mt-4 w-full" disabled={busy}>
              {busy ? 'Please wait…' : 'Sign In'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-[var(--muted)]">{API_DISPLAY_URL}</p>
        </Card>
      </div>
    </div>
  );
}
