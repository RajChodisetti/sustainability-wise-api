'use client';

import Link from 'next/link';
import { useAuth } from '@solar/contexts/AuthContext';
import { localUsernameFromCloudEmail } from '@solar/api/auth';
import { SettingsDivider, SettingsInfoRow, SettingsSection } from '@solar/components/settings/SettingsParts';
import { PageHeader } from '@solar/components/ui/Card';
import { LinkButton } from '@solar/components/ui/Button';
import { API_DISPLAY_URL } from '@solar/lib/config';

export default function ScaffoldPage() {
  const { user } = useAuth();
  const username = user?.email ? localUsernameFromCloudEmail(user.email) : '—';

  return (
    <div className="max-w-2xl">
      <PageHeader title="Scaffold Info" actions={<LinkButton href="/solar/settings" variant="secondary">Settings</LinkButton>} />

      <div className="mb-6 text-center">
        <p className="text-3xl font-black text-[var(--primary)]">SolarSense</p>
      </div>

      <div className="space-y-4">
        <SettingsSection title="Session">
          <SettingsInfoRow label="Signed in as" value={user?.fullName || username} />
        </SettingsSection>

        <SettingsSection title="Application">
          <SettingsInfoRow label="Phase" value="Production Web" />
          <SettingsDivider />
          <SettingsInfoRow label="Version" value="1.0.0 (Web)" />
          <SettingsDivider />
          <SettingsInfoRow label="Platform" value="Web · Online first · API sync" />
        </SettingsSection>

        <SettingsSection title="API">
          <SettingsInfoRow label="Server" value={API_DISPLAY_URL} />
          <SettingsDivider />
          <SettingsInfoRow label="Status" value="Connected" />
        </SettingsSection>

        <Link
          href="/solar/settings/diagnostics"
          className="block rounded-xl bg-[var(--primary)] py-3.5 text-center text-[15px] font-bold text-[var(--primary-fg)]"
        >
          Open Diagnostics
        </Link>
      </div>
    </div>
  );
}
