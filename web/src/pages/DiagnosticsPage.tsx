import { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { ApiError, health } from '../lib/api';
import { useAuth } from '../lib/auth';

type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; uptime: number }
  | { status: 'error'; message: string };

export function DiagnosticsPage() {
  const { session, user } = useAuth();
  const [healthState, setHealthState] = useState<HealthState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    setHealthState({ status: 'checking' });
    health()
      .then((result) => {
        if (!cancelled) setHealthState({ status: 'ok', uptime: result.uptime });
      })
      .catch((error) => {
        const message = error instanceof ApiError || error instanceof Error ? error.message : 'Health check failed';
        if (!cancelled) setHealthState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">System</p>
          <h1>Diagnostics</h1>
        </div>
      </header>

      <div className="settings-grid">
        <article className="feature-panel">
          <h2>API Health</h2>
          <div className={`health-row ${healthState.status}`}>
            {healthState.status === 'checking' && <Loader2 className="spin" aria-hidden="true" />}
            {healthState.status === 'ok' && <CheckCircle2 aria-hidden="true" />}
            {healthState.status === 'error' && <AlertCircle aria-hidden="true" />}
            <span>
              {healthState.status === 'checking'
                ? 'Checking'
                : healthState.status === 'ok'
                  ? `Online, uptime ${healthState.uptime}s`
                  : healthState.message}
            </span>
          </div>
        </article>

        <article className="feature-panel">
          <h2>Session</h2>
          <dl className="detail-list">
            <div>
              <dt>Application</dt>
              <dd>{user?.app ?? '-'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{user?.role ?? '-'}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{session ? new Date(session.issuedAt).toLocaleString() : '-'}</dd>
            </div>
          </dl>
        </article>

        <article className="feature-panel">
          <h2>Phase 1 Checks</h2>
          <ul className="check-list">
            <li><Activity aria-hidden="true" /> Login</li>
            <li><Activity aria-hidden="true" /> Token refresh</li>
            <li><Activity aria-hidden="true" /> Route guards</li>
            <li><Activity aria-hidden="true" /> Role-aware navigation</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

