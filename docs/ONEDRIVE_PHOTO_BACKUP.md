# OneDrive Photo Backup

The API can optionally mirror confirmed photo uploads and generated PDFs to OneDrive using Microsoft Graph. Local disk or DigitalOcean Spaces remains the source of truth for app download URLs; OneDrive is a secondary copy.

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
```

Then restart the API. New confirmed photo uploads and generated PDFs will be mirrored to OneDrive.

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
