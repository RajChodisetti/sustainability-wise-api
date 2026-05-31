# Phase 2 Delivery — SolarSense API + VM-Local File Storage

## Included

| Area | Detail |
|---|---|
| SolarSense users | Admin create/list/read/update/deactivate under `/v1/solarsense/users` |
| SolarSense sites | Inspector/admin CRUD, soft delete, complete gate under `/v1/solarsense/sites` |
| Rooftop assessments | Site-scoped CRUD and complete gate under `/v1/solarsense/sites/:siteId/assessments` |
| Sync | `check-photo`, `create-upload-session`, raw-byte `upload/:sessionId`, `confirm-upload`, `push`, `pull` |
| Photos | Site photo listing, ZIP export, admin delete |
| File storage | Photos and generated PDFs stored under `LOCAL_FILE_STORAGE_ROOT` on the VM |
| PDF | Basic SolarSense site-pack PDF generation with headless Chrome, stored on VM |
| Migration | `0001_local_photo_storage.sql` adds local-storage metadata columns to `photo_registry` |

## Required Deployment Dependencies

- Run `npm install` or `npm ci` after pulling because Phase 2 adds `archiver` and `puppeteer-core`.
- Run `npm run db:migrate` so `photo_registry` gets `storage_key`, `content_type`, `original_filename`, and `uploaded_at`.
- Create and permission the storage directory:

```bash
mkdir -p /var/lib/sustainability-wise-api/uploads
chown -R swapi:swapi /var/lib/sustainability-wise-api
```

- Set production env vars:

```bash
PUBLIC_BASE_URL=https://api.sustainabilitywise.com.au
LOCAL_FILE_STORAGE_ROOT=/var/lib/sustainability-wise-api/uploads
MAX_UPLOAD_BYTES=52428800
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
```

- Install Chrome/Chromium on the VM for PDF generation. Without it, all non-PDF API routes work, but `/site-pack/pdf` fails at render time.
- Phase 3 mobile changes are still required before the installed SolarSense app can sync: local `status` fields, API key setup, upload queue, checksum calculation, and raw-byte PUT to `uploadUrl`.

## VM Storage Tradeoffs

VM-local storage is fine for starting because it avoids Azure AD and OneDrive setup and keeps the upload path simple.

Main downsides:

- The current 50 GB droplet can fill quickly with real photo volume.
- Database backups alone do not protect images; snapshots or file backups are mandatory.
- Public file URLs are unguessable but not user-authenticated, so they should be treated as bearer links.
- Uploads are single-request, not resumable. Failed uploads retry from the beginning.
- Moving to multiple API servers later requires shared storage first.
- Migrating to OneDrive/object storage later requires a backfill job for existing files and URL updates.

Recommended trigger to move off VM-local storage: before `LOCAL_FILE_STORAGE_ROOT` reaches 25 GB, or before adding a second API server.
