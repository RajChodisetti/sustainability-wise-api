export type OneDriveBackupPolicy = {
  enabled: boolean;
  backupRequired: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  userEmail: string;
  photosFolder: string;
};

/**
 * QA may deliberately disable the secondary OneDrive mirror. A required
 * production mirror must instead fail closed at process startup, before the
 * API accepts evidence that it cannot guarantee will reach both destinations.
 */
export function assertOneDriveBackupPolicy(policy: OneDriveBackupPolicy): void {
  if (!policy.backupRequired) return;
  if (!policy.enabled) {
    throw new Error('OneDrive backup cannot be required while mirroring is disabled');
  }

  const required = [
    ['AZURE_TENANT_ID', policy.tenantId],
    ['AZURE_CLIENT_ID', policy.clientId],
    ['AZURE_CLIENT_SECRET', policy.clientSecret],
    ['ONEDRIVE_USER_EMAIL', policy.userEmail],
    ['ONEDRIVE_PHOTOS_FOLDER', policy.photosFolder],
  ] as const;
  const missing = required
    .filter(([, value]) => !value.trim())
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `Required OneDrive backup is missing environment variables: ${missing.join(', ')}`,
    );
  }
}
