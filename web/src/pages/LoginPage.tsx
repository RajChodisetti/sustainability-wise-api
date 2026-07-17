import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { appOrder, apps } from '../lib/navigation';
import type { AppId } from '../lib/types';

interface LoginPageProps {
  initialApp: AppId;
}

export function LoginPage({ initialApp }: LoginPageProps) {
  const { login, sessions, switchApp } = useAuth();
  const [app, setApp] = useState<AppId>(initialApp);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setApp(initialApp);
  }, [initialApp]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(app, email, password);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Invalid credentials for the selected app.');
      } else if (caught instanceof Error) {
        setError(caught.message);
      } else {
        setError('Login failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="brand-mark large">SW</div>
          <div>
            <p className="eyebrow">Sustainability Wise</p>
            <h1 id="login-title">SustainabilityWiseUI</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <fieldset className="segmented-control">
            <legend>Application</legend>
            {appOrder.map((appId) => (
              <button
                key={appId}
                className={app === appId ? 'active' : ''}
                type="button"
                onClick={() => setApp(appId)}
              >
                {apps[appId].label}
              </button>
            ))}
          </fieldset>

          <label className="field">
            <span>Email or username</span>
            <input
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="password-field">
              <input
                autoComplete="current-password"
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
          </label>

          {error && (
            <div className="form-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button className="button primary submit-button" type="submit" disabled={loading}>
            {loading ? <Loader2 className="spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            Sign in
          </button>
        </form>

        <div className="stored-sessions">
          {appOrder.map((appId) => (
            sessions[appId] ? (
              <button key={appId} className="session-button" type="button" onClick={() => void switchApp(appId)}>
                <LockKeyhole aria-hidden="true" />
                Continue to {apps[appId].label}
              </button>
            ) : null
          ))}
        </div>
      </section>
    </main>
  );
}

