'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '@/api/client';
import { Button, LinkButton } from '@/components/ui/Button';
import {
  Card,
  ErrorBanner,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';
import { FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { API_DISPLAY_URL } from '@/lib/config';
import { changeUserPassword, listInstallationTrees } from '@/modules/installhub/api/installhub';
import {
  getStoredJwt,
  installHubConnectionErrorMessage,
} from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  DefinitionList,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';

type HealthState = 'idle' | 'checking' | 'healthy' | 'unavailable';

export function InstallHubSettingsPage() {
  const { user, logout } = useInstallHubAuth();
  const { mode, setMode, isDark } = useTheme();
  const toast = useToast();
  const [health, setHealth] = useState<HealthState>('idle');
  const sourceLabel = user?.sourceApp === 'ecoaudit'
    ? 'Eco Audit'
    : user?.sourceApp === 'solarsense'
      ? 'Solar Sense'
      : null;

  async function testConnection() {
    setHealth('checking');
    const healthy = await checkHealth();
    setHealth(healthy ? 'healthy' : 'unavailable');
    if (healthy) toast.success('InstallHub reached the Sustainability Wise API.');
    else toast.error(`The API at ${API_DISPLAY_URL} could not be reached.`);
  }

  async function signOut() {
    await logout();
    window.location.assign('/login');
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'InstallHub', href: '/installhub/dashboard' }, { label: 'Settings' }]} />
      <PageHeader
        title="InstallHub settings"
        subtitle="Account security, cloud connection, appearance, and web-app diagnostics."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">Profile</h2>
          <div className="mt-5">
            <DefinitionList
              items={[
                { label: 'Name', value: user?.fullName || 'Not set' },
                { label: 'Email', value: user?.email },
                {
                  label: 'Role',
                  value: user?.role === 'admin' ? 'Administrator' : 'Inspector',
                },
                ...(sourceLabel
                  ? [{
                      label: 'Account source',
                      value: `${sourceLabel} (shared with Field App)`,
                    }]
                  : []),
              ]}
            />
          </div>
          {sourceLabel ? (
            <p className="mt-4 text-sm leading-6 text-[var(--text-sub)]">
              Profile, role, and active status are managed in {sourceLabel}.
            </p>
          ) : null}
          <LinkButton
            className="mt-5 w-full sm:w-auto"
            href="/installhub/settings/password"
            variant="secondary"
          >
            <Icon name="lock" size={17} />
            Change password
          </LinkButton>
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Cloud connection
          </h2>
          <p className="mt-2 break-all text-sm text-[var(--text-sub)]">
            Server: {API_DISPLAY_URL}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--text-sub)]">
            The web app is cloud-first: installation edits and original
            evidence are saved directly through the InstallHub API. Mobile
            opt-in backup queues are therefore not required here.
          </p>
          {health !== 'idle' ? (
            <p
              className={`mt-3 text-sm font-bold ${
                health === 'healthy'
                  ? 'text-[var(--green)]'
                  : health === 'unavailable'
                    ? 'text-[var(--red)]'
                    : 'text-[var(--primary)]'
              }`}
              role="status"
            >
              {health === 'checking'
                ? 'Checking connection…'
                : health === 'healthy'
                  ? 'API connection healthy'
                  : 'API connection unavailable'}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              disabled={health === 'checking'}
              onClick={() => void testConnection()}
            >
              <Icon name="wifi" size={17} />
              {health === 'checking' ? 'Testing…' : 'Test connection'}
            </Button>
            <LinkButton
              href="/installhub/installations"
              variant="secondary"
            >
              <Icon name="cloud" size={17} />
              Browse cloud installations
            </LinkButton>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Appearance
          </h2>
          <p className="mt-2 text-sm text-[var(--text-sub)]">
            Current: {mode === 'system' ? `System (${isDark ? 'dark' : 'light'})` : mode}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as const).map((option) => (
              <Button
                key={option}
                variant={mode === option ? 'primary' : 'secondary'}
                onClick={() => setMode(option)}
              >
                {option === 'light' ? (
                  <Icon name="sun" size={17} />
                ) : option === 'dark' ? (
                  <Icon name="moon" size={17} />
                ) : (
                  <Icon name="settings" size={17} />
                )}
                <span className="capitalize">{option}</span>
              </Button>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Diagnostics
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            Inspect API health, cloud entity totals, browser storage, camera
            availability, and barcode-scanner support.
          </p>
          <LinkButton
            className="mt-5 w-full sm:w-auto"
            href="/installhub/settings/diagnostics"
            variant="secondary"
          >
            <Icon name="activity" size={17} />
            Open diagnostics
          </LinkButton>
        </Card>

        {user?.role === 'admin' ? (
          <Card>
            <h2 className="text-lg font-extrabold text-[var(--text)]">
              Administration
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
              Create accounts, control roles and account status, reset
              passwords, and assign installation access.
            </p>
            <LinkButton
              className="mt-5 w-full sm:w-auto"
              href="/installhub/admin/users"
            >
              <Icon name="users" size={17} />
              Manage users
            </LinkButton>
          </Card>
        ) : null}

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">About</h2>
          <p className="mt-2 font-bold text-[var(--text)]">InstallHub Web</p>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            Responsive cloud workspace for installation hierarchy,
            commissioning forms, original evidence, report packs, and access
            management. It uses the same InstallHub API records as the iOS app.
          </p>
        </Card>
      </div>

      <Card className="mt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">Sign out</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">
              End the active portal sessions on this browser.
            </p>
          </div>
          <Button variant="danger" onClick={() => void signOut()}>
            <Icon name="log-out" size={17} />
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function InstallHubPasswordPage() {
  const { user, logout } = useInstallHubAuth();
  const router = useRouter();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const sourceLabel = user?.sourceApp === 'ecoaudit'
    ? 'Eco Audit'
    : user?.sourceApp === 'solarsense'
      ? 'Solar Sense'
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      toast.error('Sign in before changing your password.');
      return;
    }
    if (!currentPassword) {
      toast.error('Enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('The new password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('The new passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await changeUserPassword(user.id, { currentPassword, newPassword });
      window.alert(
        sourceLabel
          ? `Password changed for ${sourceLabel} and the Field App. Existing cloud refresh sessions for both apps were revoked. Sign in again with the new password.`
          : 'Password changed. Your existing Field App refresh sessions were revoked. Sign in again with the new password.',
      );
      await logout();
      router.replace('/login');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/installhub/settings' },
          { label: 'Change password' },
        ]}
      />
      <PageHeader
        title="Change your password"
        subtitle={
          sourceLabel
            ? `This Field account is managed by ${sourceLabel}. Changing it updates the shared ${sourceLabel} credential and revokes refresh sessions in both apps.`
            : 'Confirm your current password. A successful change revokes other Field App refresh sessions.'
        }
      />
      <form onSubmit={(event) => void submit(event)}>
        <Card>
          <FieldLabel htmlFor="ih-current-password">
            Current password
          </FieldLabel>
          <Input
            id="ih-current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <FieldLabel htmlFor="ih-new-password">New password</FieldLabel>
          <Input
            id="ih-new-password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <FieldLabel htmlFor="ih-confirm-password">
            Confirm new password
          </FieldLabel>
          <Input
            id="ih-confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <LinkButton
              href="/installhub/settings"
              variant="secondary"
            >
              Cancel
            </LinkButton>
            <Button type="submit" disabled={saving}>
              {saving ? 'Changing password…' : 'Change password'}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

type StorageSnapshot = {
  usage: number | null;
  quota: number | null;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

export function InstallHubDiagnosticsPage() {
  const [storage, setStorage] = useState<StorageSnapshot>({
    usage: null,
    quota: null,
  });
  const [snapshotAt, setSnapshotAt] = useState(() => new Date());
  const health = useQuery({
    queryKey: ['installhub', 'diagnostics-health'],
    queryFn: checkHealth,
  });
  const trees = useQuery({
    queryKey: ['installhub', 'diagnostics-trees'],
    queryFn: listInstallationTrees,
  });

  useEffect(() => {
    let active = true;
    if (!navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((estimate) => {
      if (!active) return;
      setStorage({
        usage: estimate.usage ?? null,
        quota: estimate.quota ?? null,
      });
    });
    return () => {
      active = false;
    };
  }, [snapshotAt]);

  const data = trees.data ?? [];
  const entities = data.reduce(
    (counts, tree) => {
      counts.zones += tree.zones.length;
      counts.boards += tree.electricalAssets.length;
      counts.siteAssets += tree.siteAssets.length;
      counts.meters += tree.electricalAssets.reduce(
        (total, board) => total + board.meters.length,
        0,
      );
      counts.forms += tree.formSubmissions.length;
      counts.attachments += tree.formSubmissions.reduce(
        (total, form) => total + form.attachments.length,
        0,
      );
      return counts;
    },
    {
      zones: 0,
      boards: 0,
      siteAssets: 0,
      meters: 0,
      forms: 0,
      attachments: 0,
    },
  );
  const barcodeSupported =
    typeof window !== 'undefined' &&
    'BarcodeDetector' in (globalThis as typeof globalThis & Record<string, unknown>);
  const cameraSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  async function refresh() {
    setSnapshotAt(new Date());
    await Promise.all([health.refetch(), trees.refetch()]);
  }

  if (trees.isLoading && !trees.data) return <Spinner label="Inspecting InstallHub…" />;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/installhub/settings' },
          { label: 'Diagnostics' },
        ]}
      />
      <PageHeader
        title="InstallHub diagnostics"
        subtitle="Live API, cloud-record, browser storage, and field-capture capability checks."
        actions={
          <Button
            variant="secondary"
            disabled={health.isFetching || trees.isFetching}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={17} />
            {health.isFetching || trees.isFetching
              ? 'Refreshing…'
              : 'Refresh diagnostics'}
          </Button>
        }
      />

      {trees.error ? (
        <ErrorBanner message={installHubConnectionErrorMessage(trees.error)} />
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-[var(--text)]">
                API connection
              </h2>
              <p className="mt-2 break-all text-sm text-[var(--text-sub)]">
                {API_DISPLAY_URL}
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                health.data
                  ? 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]'
                  : health.isLoading
                    ? 'border-[var(--border)] bg-[var(--surface2)] text-[var(--text-sub)]'
                    : 'border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]'
              }`}
            >
              {health.data
                ? 'Healthy'
                : health.isLoading
                  ? 'Checking'
                  : 'Unavailable'}
            </span>
          </div>
          <div className="mt-5">
            <DefinitionList
              items={[
                {
                  label: 'InstallHub session',
                  value: getStoredJwt() ? 'Present' : 'Missing',
                },
                {
                  label: 'Save model',
                  value: 'Cloud-first',
                },
                {
                  label: 'Last snapshot',
                  value: snapshotAt.toLocaleString(),
                },
              ]}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Browser capabilities
          </h2>
          <div className="mt-5">
            <DefinitionList
              items={[
                {
                  label: 'Camera capture',
                  value: cameraSupported ? 'Supported' : 'Unavailable',
                },
                {
                  label: 'Live barcode scan',
                  value: barcodeSupported
                    ? 'Supported'
                    : 'Manual entry fallback',
                },
                {
                  label: 'Secure context',
                  value:
                    typeof window !== 'undefined' && window.isSecureContext
                      ? 'Yes'
                      : 'No',
                },
                {
                  label: 'Browser storage used',
                  value: formatBytes(storage.usage),
                },
                {
                  label: 'Browser storage quota',
                  value: formatBytes(storage.quota),
                },
              ]}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Cloud entities
          </h2>
          <div className="mt-5">
            <DefinitionList
              items={[
                { label: 'Installations', value: data.length },
                { label: 'Zones', value: entities.zones },
                { label: 'Switchboards', value: entities.boards },
                { label: 'Site assets', value: entities.siteAssets },
                { label: 'Meters', value: entities.meters },
                { label: 'Forms', value: entities.forms },
                { label: 'Form attachments', value: entities.attachments },
              ]}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Storage and recovery
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            The browser does not hold a separate editable installation
            database, evidence queue, report cache, or imported-preview cache.
            Those iOS offline-storage controls are replaced here by live API
            saves and read-only cloud file history.
          </p>
          <div className="mt-5">
            <InlineNotice tone={health.data ? 'success' : 'warning'}>
              {health.data
                ? 'Cloud records are reachable. Open any installation and use Refresh to reload its latest server tree.'
                : 'The API is not currently reachable. Avoid closing unsaved form edits until the connection returns.'}
            </InlineNotice>
          </div>
        </Card>
      </div>
    </div>
  );
}
