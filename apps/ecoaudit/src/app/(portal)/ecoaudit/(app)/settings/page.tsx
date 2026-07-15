'use client';

import { useAuth, useRequireAdmin } from '@/contexts/AuthContext';
import { localUsernameFromCloudEmail } from '@/api/auth';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { SettingsDivider, SettingsInfoRow, SettingsMenuItem, SettingsSection } from '@/components/settings/SettingsParts';
import { PageHeader } from '@/components/ui/Card';
import { API_DISPLAY_URL } from '@/lib/config';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const isAdmin = useRequireAdmin();
  const { mode, setMode } = useTheme();
  const toast = useToast();
  const username = user?.email ? localUsernameFromCloudEmail(user.email) : '—';

  async function handleLogout() {
    if (!confirm('Log out?')) return;
    await logout();
    toast.success('Logged out.');
    window.location.assign('/login');
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <SettingsSection title="Account">
          <SettingsInfoRow label="Name" value={user?.fullName || username} />
          <SettingsDivider />
          <SettingsInfoRow label="Role" value={user?.role ?? '—'} />
          <SettingsDivider />
          <SettingsMenuItem href="/ecoaudit/settings/password" label="Change Password" icon="🔑" />
        </SettingsSection>

        <SettingsSection title="Appearance">
          <div className="px-4 py-4">
            <p className="mb-3 text-xs font-semibold text-[var(--text-sub)]">Theme</p>
            <div className="grid grid-cols-3 gap-2">
              {(['light', 'dark', 'system'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setMode(key); toast.success(`Theme: ${key}`); }}
                  className={`rounded-lg border-2 px-3 py-2.5 text-sm font-semibold capitalize ${mode === key ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]' : 'border-transparent bg-[var(--surface2)]'}`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        {isAdmin ? (
          <SettingsSection title="Administration">
            <SettingsMenuItem href="/ecoaudit/admin" label="User Management" icon="👥" />
          </SettingsSection>
        ) : null}

        <SettingsSection title="Developer">
          <SettingsMenuItem href="/ecoaudit/settings/diagnostics" label="Diagnostics" icon="🐛" />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsInfoRow label="App" value="EcoAudit Pro Web" />
          <SettingsDivider />
          <SettingsInfoRow label="API" value={API_DISPLAY_URL.replace(/^https?:\/\//, '')} />
        </SettingsSection>

        <button type="button" onClick={() => void handleLogout()} className="w-full rounded-xl border-2 border-[var(--red)] py-3.5 font-bold text-[var(--red)]">
          Log Out
        </button>
      </div>
    </div>
  );
}
