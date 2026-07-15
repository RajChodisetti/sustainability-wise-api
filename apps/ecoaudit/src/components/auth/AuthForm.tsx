'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner } from '@/components/ui/Card';
import { FieldLabel, Input } from '@/components/ui/FormFields';
import { BrandMark, Icon } from '@/components/ui/Icon';
import { API_DISPLAY_URL } from '@/lib/config';

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
  const usernameId = useId();
  const passwordId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ username: username.trim().toLowerCase(), password });
  }

  return (
    <div className="auth-grid min-h-screen bg-[var(--bg)] lg:grid lg:grid-cols-[minmax(360px,0.9fr)_1.1fr]">
      <section
        className="relative hidden overflow-hidden bg-[var(--sidebar)] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14"
        aria-label="EcoSense Portal overview"
      >
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-400/15 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-lg font-extrabold tracking-[-0.03em]">EcoSense Portal</p>
            <p className="text-xs font-semibold tracking-wide text-[var(--sidebar-muted)]">SUSTAINABILITY WISE</p>
          </div>
        </div>

        <div className="relative max-w-xl py-12">
          <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-amber-300">
            <Icon name="leaf" size={25} />
          </span>
          <h2 className="text-4xl font-extrabold leading-tight tracking-[-0.045em] xl:text-5xl">
            One clear view of your sustainability work.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-[var(--sidebar-muted)]">
            Manage energy audits, solar assessments, field photos, reports, and operational follow-up from a single secure workspace.
          </p>
          <div className="mt-8 grid gap-3 text-sm font-semibold text-[var(--sidebar-text)] sm:grid-cols-2">
            {['Energy audit workflows', 'Solar site assessments', 'Authenticated photo previews', 'PDF and ZIP exports'].map((feature) => (
              <div key={feature} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                  <Icon name="check" size={14} />
                </span>
                {feature}
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-[var(--sidebar-muted)]">Secure operations workspace · Sustainability Wise</p>
      </section>

      <main className="flex min-h-screen items-center justify-center p-4 sm:p-8 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <div>
              <p className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">EcoSense Portal</p>
              <p className="text-xs font-semibold text-[var(--text-sub)]">Sustainability Wise</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--primary)]">Welcome back</p>
            <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-[var(--text)]">Sign in to your workspace</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">Use your Eco Audit or Solar Sense account credentials.</p>
          </div>

          <Card className="!p-5 sm:!p-7">
            <form onSubmit={handleSubmit} className="space-y-1" aria-busy={busy}>
              <FieldLabel htmlFor={usernameId}>Username</FieldLabel>
              <Input
                id={usernameId}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                required
                autoComplete="username"
                autoCapitalize="none"
                placeholder="Enter your username"
              />
              <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
              <Input
                id={passwordId}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              {error ? (
                <div className="mt-4">
                  <ErrorBanner message={error} />
                </div>
              ) : null}
              <Button type="submit" className="mt-5 w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
                {!busy ? <Icon name="arrow-right" size={18} /> : null}
              </Button>
            </form>
          </Card>
          <p className="mt-5 truncate text-center text-xs text-[var(--muted)]" title={API_DISPLAY_URL}>
            Connected to {API_DISPLAY_URL}
          </p>
        </div>
      </main>
    </div>
  );
}
