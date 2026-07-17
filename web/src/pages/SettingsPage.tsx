import { KeyRound, ServerCog, Settings, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth';

interface SettingsPageProps {
  mode?: 'settings' | 'api-keys' | 'system';
}

export function SettingsPage({ mode = 'settings' }: SettingsPageProps) {
  const { user } = useAuth();
  const title = mode === 'api-keys' ? 'API Keys' : mode === 'system' ? 'System' : 'Settings';
  const Icon = mode === 'api-keys' ? KeyRound : mode === 'system' ? ServerCog : Settings;

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>{title}</h1>
        </div>
      </header>

      <div className="settings-grid">
        <article className="feature-panel primary-panel">
          <div className="panel-icon">
            <Icon aria-hidden="true" />
          </div>
          <div>
            <h2>{title}</h2>
            <p>{mode === 'settings' ? 'Account and app preferences' : 'Admin workspace'}</p>
          </div>
        </article>

        <article className="feature-panel">
          <h2>Current User</h2>
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{user?.fullName || '-'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user?.email || '-'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{user?.role || '-'}</dd>
            </div>
          </dl>
        </article>

        <article className="feature-panel">
          <h2>Access</h2>
          <div className="user-access">
            <UserRound aria-hidden="true" />
            <span>{user?.app ?? '-'} namespace</span>
          </div>
        </article>
      </div>
    </section>
  );
}

