# OneDrive Photo Backup

The API can optionally mirror confirmed photo uploads and generated PDFs to OneDrive using Microsoft Graph. Local disk or DigitalOcean Spaces remains the source of truth for app download URLs; OneDrive is a secondary copy.

## Field App Environment Policy

Field App evidence follows the same shared upload pipeline as EcoAudit and
SolarSense, while retaining the `installhub` application boundary:

| Environment | Primary evidence storage | OneDrive mirror |
| --- | --- | --- |
| QA | Dedicated VM-local InstallHub root with `STORAGE_WRITE_MODE=isolated` and `INSTALLHUB_STORAGE_PROVIDER=local`; storage keys remain prefixed by `installhub/` | Disabled |
| Production | Dedicated InstallHub Spaces bucket and least-privilege access key with `STORAGE_WRITE_MODE=isolated` | Enabled and required |

Production Field App paths remain visibly segregated beneath both destinations,
for example `installhub/site-name/zone/zone-name/photos-0/...jpg` in Spaces and
`SustainabilityWise/photos/installhub/site-name/...` in OneDrive. A required
mirror fails the confirmation request when Graph is unavailable, leaving the
durable upload retryable instead of marking evidence fully backed up. QA must
keep `ONEDRIVE_PHOTO_BACKUP_ENABLED=false` and
`ONEDRIVE_BACKUP_REQUIRED=false`.

For QA, give EcoAudit, SolarSense, and InstallHub distinct local roots. For
example, the Field App lane can use
`INSTALLHUB_LOCAL_FILE_STORAGE_ROOT=/var/lib/sustainability-wise-api-lanes/field-qa/installhub`.
The existing storage startup policy rejects reused roots in isolated mode.

## Required Azure App Settings

The app registration needs Microsoft Graph application permission to write files, for example `Files.ReadWrite.All`, with admin consent granted for the tenant.

Set these environment variables:

```bash
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
ONEDRIVE_USER_EMAIL=backups@example.com
ONEDRIVE_PHOTO_BACKUP_ENABLED=false
ONEDRIVE_PHOTOS_FOLDER=SustainabilityWise/photos
ONEDRIVE_INVOICES_FOLDER=SustainabilityWise/invoices
ONEDRIVE_BACKUP_REQUIRED=false
```

`ONEDRIVE_PHOTOS_FOLDER` is the single OneDrive subfolder where mirrored app photos are written. The API keeps the storage key path underneath it, for example:

```text
SustainabilityWise/photos/solarsense/site-id/rooftop_assessment/assessment-id/field-name/photo.jpg
```

Generated PDFs are written under the same app parent folder:

```text
SustainabilityWise/photos/solarsense/site-id/pdfs/site-pack-pdf-uuid.pdf
SustainabilityWise/photos/ecoaudit/audit-id/pdfs/audit-pdf-uuid.pdf
```

Scheduler invoice PDFs use a separate lazy hierarchy:

```text
SustainabilityWise/invoices/<client>/<invoice-and-job-name>-v1.pdf
SustainabilityWise/invoices/<client>/<invoice-and-job-name>-v2.pdf
```

The `invoices` and client folders are created only while uploading a generated
invoice PDF. Merely creating a client or invoice draft does not create folders.

## Smoke Test

Run the upload/download smoke test before enabling this in production:

```bash
npm run onedrive:smoke -- --file /path/to/test-photo.jpg
```

If you keep production env values in `.env.production`, run:

```bash
DOTENV_CONFIG_PATH=.env.production npm run onedrive:smoke -- --file /path/to/test-photo.jpg
```

The script uploads one image under `${ONEDRIVE_PHOTOS_FOLDER}/_smoke`, downloads it back, and compares SHA-256 checksums.

After the smoke test succeeds, set:

```bash
ONEDRIVE_PHOTO_BACKUP_ENABLED=true
ONEDRIVE_BACKUP_REQUIRED=true
```

Then restart the API. New confirmed photo uploads and generated PDFs will be mirrored to OneDrive.
Use the required setting when both primary storage and the mirror are release
requirements; an optional mirror remains available only for an explicitly
approved best-effort policy.

## Existing Data Backfill

Automatic backup only runs for new confirmed uploads and newly generated PDFs. To copy existing confirmed photos and existing generated PDFs, run the one-time backfill command.

Dry run first:

```bash
DOTENV_CONFIG_PATH=.env.production npm run onedrive:backfill -- --dry-run
```

Then run the backfill:

```bash
DOTENV_CONFIG_PATH=.env.production npm run onedrive:backfill
```

On the production Droplet, where env vars are stored in `/opt/sw-api/.env`, run:

```bash
cd /opt/sw-api
DOTENV_CONFIG_PATH=/opt/sw-api/.env npm run onedrive:backfill -- --dry-run
DOTENV_CONFIG_PATH=/opt/sw-api/.env npm run onedrive:backfill
```

The command is idempotent. Photo paths are derived from each existing storage key, so rerunning it writes to the same OneDrive path and updates `photo_registry.onedrive_item_id`; it does not create duplicate photo copies. By default it skips photo rows that already have a OneDrive item id. Use `--force` only when you intentionally want to re-upload every confirmed photo.

Useful options:

```bash
--photos-only
--pdfs-only
--dry-run
--force
--limit 25
--fail-fast
```

## Name-Based Folder Migration

New uploads use human-readable storage and OneDrive folders:

```text
SustainabilityWise/photos/solarsense/site-name/rooftop_assessment/building-name/field-name/file.jpg
SustainabilityWise/photos/ecoaudit/audit-site-name/zone/zone-name/field-name/file.jpg
SustainabilityWise/photos/ecoaudit/audit-site-name/pdfs/audit-pdf-uuid.pdf
```

Existing UUID-based folders can be migrated with:

```bash
DOTENV_CONFIG_PATH=.env.production npm run storage:rename-to-names -- --dry-run
DOTENV_CONFIG_PATH=.env.production npm run storage:rename-to-names
```

On production:

```bash
cd /opt/sw-api
DOTENV_CONFIG_PATH=/opt/sw-api/.env npm run storage:rename-to-names -- --dry-run
DOTENV_CONFIG_PATH=/opt/sw-api/.env npm run storage:rename-to-names
```

The migration copies each object to its name-based key, uploads the new OneDrive copy, updates database URLs and OneDrive item ids, deletes the old storage object, and removes old UUID-named OneDrive parent folders after a zero-failure run.
