'use client';

import { useAuth, useRequireAdmin } from '@solar/contexts/AuthContext';
import { localUsernameFromCloudEmail } from '@solar/api/auth';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import {
  SettingsDivider,
  SettingsInfoRow,
  SettingsMenuItem,
  SettingsSection,
} from '@solar/components/settings/SettingsParts';
import { PageHeader } from '@solar/components/ui/Card';
import { API_DISPLAY_URL } from '@solar/lib/config';

type ThemeMode = 'light' | 'dark' | 'system';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const isAdmin = useRequireAdmin();
  const { mode, setMode } = useTheme();
  const toast = useToast();

  const username = user?.email ? localUsernameFromCloudEmail(user.email) : '—';
  const displayName = user?.fullName || username;
  const initial = (displayName[0] ?? 'U').toUpperCase();

  const themeModes: Array<{ key: ThemeMode; label: string }> = [
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
    { key: 'system', label: 'System' },
  ];

  async function handleLogout() {
    if (!confirm('Are you sure you want to log out?')) return;
    try {
      await logout();
      toast.success('Logged out successfully.');
      window.location.assign('/login');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Logout failed.');
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />

      <div className="space-y-5">
        <SettingsSection title="Account">
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary)] text-lg font-bold text-[var(--primary-fg)]">
              {initial}
            </div>
            <div>
              <p className="font-semibold text-[var(--text)]">{displayName}</p>
              <p className="text-sm capitalize text-[var(--text-sub)]">{user?.role}</p>
            </div>
          </div>
          <SettingsDivider />
          <SettingsMenuItem href="/solar/settings/password" label="Change Password" icon="🔑" />
        </SettingsSection>

        <SettingsSection title="Appearance">
          <div className="px-4 py-4">
            <p className="mb-3 text-xs font-semibold text-[var(--text-sub)]">Theme</p>
            <div className="grid grid-cols-3 gap-2">
              {themeModes.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setMode(key);
                    toast.success(`Theme set to ${label}.`);
                  }}
                  className={`rounded-lg border-2 px-3 py-2.5 text-sm font-semibold transition ${
                    mode === key
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]'
                      : 'border-transparent bg-[var(--surface2)] text-[var(--text-sub)] hover:border-[var(--border)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="Storage">
          <SettingsInfoRow label="Data store" value="Cloud · Online first" />
          <SettingsDivider />
          <SettingsInfoRow label="Photos" value="Server hosted" />
          <SettingsDivider />
          <SettingsInfoRow label="PDF Reports" value="Server generated" />
          <SettingsDivider />
          <SettingsInfoRow label="Sync" value="Automatic when online" />
        </SettingsSection>

        <SettingsSection title="Administration">
          {isAdmin ? (
            <SettingsMenuItem href="/solar/admin" label="User Management" icon="👥" />
          ) : (
            <SettingsMenuItem
              label="User Management"
              icon="👥"
              onClick={() => toast.info('Admin access required. Contact your administrator.')}
            />
          )}
          <SettingsDivider />
          <SettingsMenuItem href="/solar/settings/cloud-backup" label="Cloud Backup" icon="☁" />
        </SettingsSection>

        {isAdmin ? (
          <SettingsSection title="Developer">
            <SettingsMenuItem href="/solar/settings/diagnostics" label="Database Diagnostics" icon="🐛" />
            <SettingsDivider />
            <SettingsMenuItem href="/solar/settings/scaffold" label="Scaffold Info" icon="📋" />
          </SettingsSection>
        ) : null}

        <SettingsSection title="About">
          <SettingsInfoRow label="Version" value="1.0.0 (Web)" />
          <SettingsDivider />
          <SettingsInfoRow label="Platform" value="Web · Online first" />
          <SettingsDivider />
          <SettingsInfoRow label="API" value={API_DISPLAY_URL.replace(/^https?:\/\//, '')} />
        </SettingsSection>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--red)] py-3.5 text-[15px] font-bold text-[var(--red)] transition hover:bg-[var(--red)]/10"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
