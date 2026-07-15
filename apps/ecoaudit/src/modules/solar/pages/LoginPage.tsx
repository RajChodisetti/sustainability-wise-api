'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { useAuth } from '@solar/contexts/AuthContext';
import { Button } from '@solar/components/ui/Button';
import { Card, ErrorBanner, Spinner } from '@solar/components/ui/Card';
import { FieldLabel, Input } from '@solar/components/ui/FormFields';
import { API_DISPLAY_URL } from '@solar/lib/config';

type AuthMode = 'login' | 'signup';

export default function LoginPage({ initialMode = 'login' }: { initialMode?: AuthMode }) {
  const { login, register, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<AuthMode>(
    initialMode === 'signup' || pathname.endsWith('/signup') ? 'signup' : 'login',
  );

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/solar');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || isAuthenticated) return <Spinner />;

  function clearError() {
    setError(null);
  }

  function validateSignup(): string | null {
    if (!fullName.trim()) return 'Full name is required.';
    if (!username.trim()) return 'Username is required.';
    if (/\s/.test(username)) return 'Username cannot contain spaces.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    if (password !== passwordConfirm) return 'Passwords do not match.';
    return null;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim().toLowerCase(), password);
      router.replace('/solar');
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateSignup();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        username: username.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
      });
      router.replace('/solar');
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-24 w-60 items-center justify-center rounded-xl border border-[var(--border)] bg-white shadow-sm">
            <h1 className="text-2xl font-black tracking-tight text-[var(--primary)]">SolarSense</h1>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">
            Rooftop Solar Assessment
          </p>
        </div>

        <Card>
          <div className="mb-5 flex rounded-lg bg-[var(--surface2)] p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${
                isLogin ? 'bg-[var(--primary)] text-[var(--primary-fg)]' : 'text-[var(--text-sub)]'
              }`}
              onClick={() => { setMode('login'); clearError(); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${
                !isLogin ? 'bg-[var(--primary)] text-[var(--primary-fg)]' : 'text-[var(--text-sub)]'
              }`}
              onClick={() => { setMode('signup'); clearError(); }}
            >
              Sign Up
            </button>
          </div>

          {isLogin ? (
            <form onSubmit={handleLogin} className="space-y-1">
              <p className="mb-4 text-sm text-[var(--text-sub)]">Sign in with your username and password.</p>
              <FieldLabel>Username</FieldLabel>
              <Input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value.toLowerCase()); clearError(); }}
                placeholder="Enter your username"
                required
                autoComplete="username"
                autoCapitalize="none"
              />
              <FieldLabel>Password</FieldLabel>
              <div className="flex gap-2">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="flex-1"
                />
                <Button type="button" variant="ghost" className="!px-3" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? 'Hide' : 'Show'}
                </Button>
              </div>
              {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
              <Button type="submit" className="mt-4 w-full" disabled={busy || !username.trim() || !password}>
                {busy ? 'Signing in…' : 'Log In'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-1">
              <p className="mb-4 text-sm text-[var(--text-sub)]">Create your SolarSense account.</p>
              <FieldLabel>Full name *</FieldLabel>
              <Input
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); clearError(); }}
                placeholder="e.g. Jane Smith"
                required
                autoComplete="name"
              />
              <FieldLabel>Username *</FieldLabel>
              <Input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value.toLowerCase()); clearError(); }}
                placeholder="e.g. jsmith"
                required
                autoComplete="username"
              />
              <FieldLabel>Password *</FieldLabel>
              <div className="flex gap-2">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  placeholder="Min. 6 characters"
                  required
                  autoComplete="new-password"
                  className="flex-1"
                />
                <Button type="button" variant="ghost" className="!px-3" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? 'Hide' : 'Show'}
                </Button>
              </div>
              <FieldLabel>Confirm password *</FieldLabel>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={passwordConfirm}
                onChange={(e) => { setPasswordConfirm(e.target.value); clearError(); }}
                placeholder="Repeat password"
                required
                autoComplete="new-password"
              />
              {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
              <Button type="submit" className="mt-4 w-full" disabled={busy}>
                {busy ? 'Creating account…' : 'Create Account'}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-xs text-[var(--muted)]">{API_DISPLAY_URL}</p>
        </Card>
      </div>
    </div>
  );
}
