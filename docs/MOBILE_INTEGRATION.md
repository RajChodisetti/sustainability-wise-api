# Mobile Integration Guide

Cloud sync contracts for `installhub-mobile/`, `solarsense-mobile/`, and
`ecoaudit-pro/mobile/`.

The mobile applications are sibling repositories, not folders in this Git
repository. Treat the payload, photo-field, lifecycle, and thumbnail sections
below as compatibility contracts for installed app versions. Do not modify mobile
source during an API or portal-only task unless the request explicitly includes
it.

---

## Field App Complete Mobile — Cloud Backup

Field App Complete uses user JWT authentication, not a device API key. Login sends
`app: "installhub"` to `/v1/auth/login`; access and rotated refresh tokens are
stored in iOS Keychain through Expo SecureStore. The app may restore a cached
session while offline. New-user bootstrap is available only in a controlled
migration build that supplies both
`EXPO_PUBLIC_ENABLE_LEGACY_BOOTSTRAP=true` and an app-specific
`EXPO_PUBLIC_REGISTRATION_SECRET`; normal release builds ignore the secret and
no registration credential is committed to source.

The additive `unified_users` registry contains every Eco Audit, Solar Sense, and
native Field App Complete account. Eco Audit and Solar Sense users receive
source-managed Field App Complete access with the same role and active state.
They sign in to Field App Complete through
the unchanged `/v1/auth/login` contract with their current source credential and
receive a normal `app: "installhub"` token; the response and `/v1/auth/me`
include `sourceManaged: true` and `sourceApp`. Native Field App Complete accounts keep their
existing login and return `sourceManaged: false`.

The API owns a separate namespace:

| Concern | Contract |
|---|---|
| Routes | `/v1/installhub/*` plus shared `/v1/export/jobs/*` |
| JWT app claim | `installhub` |
| API-key prefix (administrative compatibility) | `sk_ih_live_*` |
| Tables | Native accounts remain in `ih_users`; all three apps are mirrored in additive `unified_users`; Field App Complete data remains in `ih_installations`, `ih_zones`, `ih_electrical_assets`, `ih_site_assets`, and `ih_form_submissions` |
| Shared media registry | `photo_registry` rows with `app = installhub` |

### Sync endpoints

| Method and route | Purpose |
|---|---|
| `POST /v1/installhub/sync/push` | Transactionally upsert a complete installation tree |
| `GET /v1/installhub/sync/pull` | Pull owner/assignee/admin-visible trees changed since an ISO timestamp |
| `POST /v1/installhub/sync/check-photo` | Check an exact scoped SHA-256 match |
| `POST /v1/installhub/sync/create-upload-session` | Create a validated media session |
| `PUT /v1/installhub/sync/upload/:sessionId?expires=...&signature=...` | Use a short-lived app/session-bound HMAC capability, then verify size/checksum |
| `POST /v1/installhub/sync/confirm-upload` | Confirm storage and return the durable URL |

`push` requires `installation`, `zones`, `electricalAssets`, `siteAssets`, and
`formSubmissions`. It is a full-snapshot contract: an existing child omitted
from its corresponding array is soft-deleted. Every protected operation checks
the `installhub` app claim, inspector role, installation ownership, and entity
parentage. Mobile labels the pre-upload push `syncStage: "metadata"` and the
post-upload push `syncStage: "complete"`. Metadata pushes return
`versionNumber: null`; complete pushes create/deduplicate an immutable version.
For backward compatibility, an absent stage is treated as complete.

### User and installation-access endpoints

| Method and route | Access | Purpose |
|---|---|---|
| `GET /v1/installhub/users` | admin | List Field App Complete users |
| `POST /v1/installhub/users` | admin | Create an `admin` or `inspector` |
| `GET /v1/installhub/users/:id` | self or admin | Read one public user profile |
| `PATCH /v1/installhub/users/:id` | admin | Change email, name, role, or active state |
| `PATCH /v1/installhub/users/:id/password` | self or admin | Self-change with `currentPassword`, or admin reset of another user |
| `DELETE /v1/installhub/users/:id` | admin | Soft-deactivate the account and revoke refresh tokens |
| `GET /v1/installhub/installations/:installationId/access` | accessible inspector | Read the assigned inspector |
| `PATCH /v1/installhub/installations/:installationId/access` | admin | Assign one active user or clear with `assignedInspectorUserId: null` |
| `DELETE /v1/installhub/installations/:installationId` | creator or admin | Reversibly soft-remove an active Cloud Backup |
| `DELETE /v1/installhub/installations/:installationId?purge=true` | creator or admin | Permanently delete a Cloud Backup tree, unreferenced originals, report files/jobs, and versions |

Native user administration remains scoped to `ih_users`. The API prevents an
administrator from demoting/deactivating their own account and prevents removal
of the last active native Field App Complete administrator. Role or active-state
changes, password changes, and deactivation revoke outstanding Field App Complete
refresh tokens.

Source-managed rows are returned by the same list/detail endpoints so installed
clients remain compatible. The public view uses the source email/name and adds
`sourceManaged`, `sourceApp`, and `sourceState`. Their profile, role, active
state, administrator password reset, and deactivation are read-only in Field App Complete and
must be changed in the source app. A source-managed user may change their own
password after confirming the current password; this updates the authoritative
source credential and revokes both source and Field App Complete refresh sessions. Active
registry-managed users remain valid installation assignees.

Assignment augments, rather than transfers, access: the creator and elevated
users retain access. The assignee can pull/import the tree and access its
originals, thumbnails, files, versions, and report source data.

Permanent Cloud Backup deletion is intentionally narrower than read/import
access: only the installation creator or an elevated user may purge it. The
purge is rejected while one of its PDF jobs is active and retains any immutable
original still referenced by another backed-up copy.

Turning backup off is a separate preference from deleting server data. Mobile
asks whether to keep the active server copy or soft-remove it. A soft-removed
tree is restored under the same IDs when backup is re-enabled. Field App Complete
backfills the retained-copy indicator for older local records from their
successful sync watermark.

### Files and immutable versions

| Method and route | Purpose |
|---|---|
| `GET /v1/installhub/installations/:installationId/files` | List accessible confirmed originals and completed Field App Complete report PDFs with storage metadata |
| `GET /v1/installhub/installations/:installationId/versions` | List immutable full-snapshot version metadata |
| `GET /v1/installhub/installations/:installationId/versions/:versionNumber` | Return one saved installation snapshot |

Each successful complete or legacy-unstaged `push` saves a new installation
version only when the stable full-snapshot payload differs from the latest
version. Metadata-stage pushes are intentionally excluded. File and version
reads apply the same creator/assigned-inspector/elevated access rule as pull.

### Form and installation-pack PDF jobs

| Method and route | Purpose |
|---|---|
| `POST /v1/installhub/installations/:installationId/forms/:formId/report/pdf/jobs` | Queue one completed backed-up form report |
| `POST /v1/installhub/installations/:installationId/report/pdf/jobs` | Queue an installation pack; optional `formSubmissionIds` selects completed forms |
| `GET /v1/export/jobs/:jobId` | Poll durable status, phase, progress, filename, and error |
| `GET /v1/export/jobs/latest?entityId=...&artifactType=pdf` | Find the current user's latest PDF job for an entity |
| `GET /v1/export/jobs/:jobId/download` | Authenticated stream of a completed PDF |

Queue responses are HTTP 202 with `{ jobId, reused }`. Equivalent active work
for the same user/entity/source revision is reused. Job status/download requires
the same app and job owner, except an admin may inspect another user's job.
Clients should persist the job ID, poll without a fixed overall timeout, and
download only after `status=complete`; the download endpoint returns 409 while
work is not ready.

The server report manifest mirrors all six schema-v2 mobile forms and the two
readable schema-v1 A3RM/A6M forms. Reports are A4, use the Sustainability Wise
logo and navy/blue field-section system, escape dynamic values, render only
visible conditional fields, preserve evidence aspect ratio, and stamp `Page X
of Y` in the repeated footer. Each
`attachments[index].uri` must resolve to its exact confirmed
`photo_registry.field_name = attachments[index].uri` original (or authorized
copy reference); missing originals fail the job rather than silently omitting
evidence.

Large reports are compressed and rendered sequentially. More than 120 evidence
photos or more than 120 MiB of raw registered evidence activates section-boundary
chunking, targeting about 50 photos per part; parts are merged into one PDF.
Form jobs and installation-pack jobs share these report rules, storage naming,
durable job lifecycle, and configured OneDrive mirroring.

### Mobile backup sequence

1. Persist edits locally and mark the installation tree dirty.
2. Push metadata with all device-only media URIs removed.
3. Discover and durably queue zone, board, embedded-meter, site-asset, and form
   attachment media.
4. Deduplicate by scoped SHA-256, otherwise create/upload/confirm a session.
5. Push the full tree again with confirmed remote URLs.
6. Advance the local installation watermark only after the final push succeeds.

The queue survives restarts, caps automatic attempts at five, and can be reset
from Settings. Foreground activation, a 15-minute in-app timer, debounced local
changes, connectivity recovery, a Settings action, and the registered Expo
background task can trigger backup. iOS background execution is opportunistic
and requires a development/production build on a physical device; it does not
run reliably in Expo Go or the simulator.

The mobile API URL defaults to `https://api.sustainabilitywise.com.au` and can be
overridden with `EXPO_PUBLIC_SYNC_API_URL`. Release builds reject plaintext HTTP.
SecureStore keys are `ih_cloud_jwt`, `ih_cloud_refresh`, and `ih_cloud_user`.
Field App Complete exposes `/pull` only through an explicit user-driven browser/import
flow. It never silently overwrites local records: the selected tree is cloned
with fresh IDs and the next `cpN` suffix.

### Form schema compatibility

New submissions use schema version 2 and expose six form families:
`ww-installation`, `comms-fault`, `ace-switchboard`, `honeywell-q400`,
`captis-logger`, and `sums-logger`. The API continues accepting schema-v1
`a3rm-installation` and `a6m-installation` records for existing mobile data.
Completed Installation and Comms Fault submissions are rejected unless
device type, device number, device ID, and the exact type-compatible CT/Rogowski
selection are present. Scanner modality is a mobile capture concern; the API
validates the resulting identifiers and conditional values.

For Installation, A3RM exposes exactly three channels and A6M exactly six.
Every visible channel requires a `channel.N.load`. A real load requires an
A3RM Rogowski value (`3000A - 9cm`, `3000A - 20cm`, or `3000A - 29cm`) or an
A6M CT value (`60A`, `120A`, `200A`, `400A`, or `600A`). `Not Used` is a load
state and requires `channel.N.rating` to be empty; it is not a sensor option.
A3RM submissions must not carry hidden channel 4-6 load/rating values; the
mobile condition engine clears the rest of those hidden fields. Schema-v2
answers reject the legacy `not_applicable` value; yes/no fields must use `yes`
or `no`.

Completed standard forms require their ingestion identities: ACE job number and
phase A/B/C CT serials; Honeywell Q400 water-meter serial; and both meter and
logger serials for Captis and SUMS. SUMS uses the Captis answer shape. Barcode
versus QR acceptance remains a mobile scanner concern (SUMS accepts both); the
API stores and validates the resulting strings.

For schema v2, a completed metadata-stage push must contain every visible
required answer but may omit evidence while uploads are pending. A complete
push requires every visible required evidence slot. The API rejects unknown or
hidden stale answer keys, hidden evidence, invalid select/binary/numeric values,
duplicate attachment IDs, non-image attachments, malformed capture timestamps,
and non-HTTP(S) attachment URIs. Drafts remain incrementally valid and schema-v1
records keep their compatibility behavior.

### Field App Complete web portal counterpart

The EcoSense portal exposes the same server-backed Field App Complete domain under
`/installhub`. It keeps an isolated `installhub` JWT/refresh session and uses the
same pull, full-snapshot push, exact photo-field upload, access, file/version,
user, and durable PDF-job endpoints as the iOS app.

Its Field App Complete user-management page reads `/v1/portal/users`, showing
Eco Audit, Solar Sense, and Field App Complete role/status memberships from
`unified_users` in one responsive matrix. Source-managed Field App Complete
access is visible but read-only; only native Field App Complete-only rows link
to the existing editor. Every application login route
redirects to the portal's single `/login` page. The shared portal login is an
additive facade over the existing per-app sessions and falls back to the legacy
login calls only when the new endpoint is unavailable. If an Eco Audit or Solar
Sense portal session already exists, `/v1/auth/field-session` creates the
separate Field App Complete session after verifying both its source JWT and matching active
source refresh session, without displaying another login page. If both
independent source sessions are active, the portal presents an account chooser
with no password fields and exchanges only the explicitly selected source
session.

The web workspace covers installation and zone editing, switchboards, embedded
meters, site assets, all six schema-v2 form families, readable schema-v1 form
history, amendments, conditional cleanup and validation, scanner fields with a
manual fallback, TBC resolution, metering, evidence selection, client preview,
report packs, cloud history, access assignment, account security, diagnostics,
and administrator user management.

The browser is deliberately cloud-first. It does not duplicate the mobile
opt-in backup queue, local `cpN` import store, generated-report cache, or
thumbnail cache. Every persisted web edit saves the current complete tree, and
web diagnostics explain this distinction. This preserves the iOS offline-first
workflow without creating a competing browser source of truth.

---

## SolarSense Mobile — Changes Summary

### New Files

| File | Purpose |
|---|---|
| `src/api/apiClient.ts` | HTTP client for API server (auth headers, typed responses) |
| `src/repositories/uploadQueueRepository.ts` | All SQL access for photo_upload_queue |
| `src/services/syncService.ts` | Core sync algorithm (push completed records → upload photos → confirm → clear) |
| `src/services/SyncStatusContext.tsx` | React context exposing sync state to all screens |
| `src/components/SyncStatusBanner.tsx` | Header banner showing upload progress / errors |
| `src/screens/SyncSetupScreen.tsx` | First-run screen to enter API URL and key |

### Modified Files

| File | Change |
|---|---|
| `src/database/migrations.ts` | Add MIGRATION_2: status cols + upload queue enhancements |
| `src/constants/version.ts` | Bump DB_VERSION |
| `src/domain/types.ts` | Add `status: 'Draft' \| 'Completed'` to Site + RooftopAssessment |
| `src/repositories/solarSenseRepository.ts` | Add status mappers + sync helper functions |
| `src/screens/SiteFormScreen.tsx` | Add "Mark as Complete" button + read-only lock |
| `src/screens/AssessmentFormScreen.tsx` | Add "Mark as Complete" button + read-only lock |
| `src/screens/SettingsScreen.tsx` | Add "Sync Configuration" row |
| `src/screens/DiagnosticsScreen.tsx` | Add "Cloud Sync" status section |
| `src/navigation/RootNavigator.tsx` | Add SyncSetupScreen to navigator |
| `src/navigation/MainTabNavigator.tsx` | Render SyncStatusBanner in header |
| `App.tsx` | Wrap root with SyncStatusProvider, register BackgroundFetch task |

---

## EcoAudit Pro Mobile — Changes Summary

### New Files

| File | Purpose |
|---|---|
| `src/api/apiClient.ts` | HTTP client (same shape as SS version, targets /v1/ecoaudit/) |
| `src/repositories/uploadQueueRepository.ts` | Queue management — handles all 9 equipment photo fields |
| `src/services/syncService.ts` | Sync algorithm — push payload includes all 9 equipment arrays |
| `src/services/SyncStatusContext.tsx` | React context (identical to SS version) |
| `src/components/SyncStatusBanner.tsx` | Header banner (identical to SS version) |
| `src/screens/SyncSetupScreen.tsx` | First-run API credentials screen |

### Modified Files

| File | Change |
|---|---|
| `src/database/migrations.ts` | Add MIGRATION_3: upload queue enhancements (attempts, checksum, session_id, etc.) |
| `src/constants/version.ts` | Bump DB_VERSION |
| `src/screens/AuditScreen.tsx` | Wire existing "Mark as Completed" button to also call triggerSync() |
| `src/screens/SettingsScreen.tsx` | Add "Sync Configuration" row |
| `src/screens/DiagnosticsScreen.tsx` | Add "Cloud Sync" status section |
| `src/navigation/RootNavigator.tsx` | Add SyncSetupScreen |
| `src/navigation/MainTabNavigator.tsx` | Render SyncStatusBanner in header |
| `App.tsx` | Wrap root with SyncStatusProvider, register BackgroundFetch task |

---

## New SQL Migrations

### SolarSense — MIGRATION_2
```sql
ALTER TABLE sites ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE rooftop_assessments ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN storage_provider TEXT DEFAULT 'local_vm';
ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
```

### EcoAudit Pro — MIGRATION_3
```sql
ALTER TABLE photo_upload_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photo_upload_queue ADD COLUMN last_error TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN storage_provider TEXT DEFAULT 'local_vm';
ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
```

---

## Upload Queue Status Lifecycle

The mobile sync service must push completed site/assessment metadata before
creating photo upload sessions. The API rejects upload sessions when the target
site or assessment is missing or still `Draft`.

```
pending
  │
  ├── check-photo returns exists:true  → uploaded (skip upload) → cleared
  │
  └── create-upload-session
        │
        └── uploading
              │
              ├── PUT uploadUrl raw bytes → API stores file on VM
              │
              ├── confirm-upload success → uploaded → cleared
              │
              └── network error → failed (attempts < 5: back to pending after backoff)
                                         (attempts >= 5: stays failed, shown in UI)
```

## Imported-copy thumbnail contract

Imported copies keep each original `remoteUrl` (and its checksum/hash) as the
canonical photo reference. They must not replace it with a downloaded local path.
For preview caching, replace `/v1/files/` with `/v1/thumbnails/` and download that
URL with the current Bearer token. The endpoint returns a cached JPEG no wider
than 400px and never sends the original photo bytes to the mobile client.

Thumbnail work is durable background work: persist one job per original reference,
retry with backoff, and resume after process/network interruption. Do not surface
individual download failures as import errors. An imported copy becomes openable
only after every required preview job is complete. PDF requests continue to use
the original URL/checksum, not the preview cache file.

Original `/v1/files/*` reads are never public. A mobile original download sends
the current bearer token; completed export links may instead use a short-lived
HMAC capability generated by the API. Thumbnails are app-namespaced under
`<app>/_thumbnails/v2` and remain bearer-authorized.

Field App Complete follows the same contract. Backup is opt-in per installation. A selected server tree is
cloned locally with fresh IDs and a deterministic `<site> cpN` name, remains local-only by default,
and is hidden from the main list until every required preview is ready. Creator, assigned inspector,
or elevated access is required for both tree reads and thumbnail downloads. If an imported copy is
later opted into backup, `photo_copy_references` preserves the original bytes and authorization.

## Photo Fields Covered Per App

### SolarSense (`rooftop_assessments`)
```
aerial_photo_uri
msb_photo_uri
switchboards[n].photoUri
other_considerations[n].photoUris[]
additional_photos[]
sites.appendix_items[n].uri  (type='image')
```

### EcoAudit Pro (across 9 equipment tables)
```
zones.photos[]
main_switchboards:        photo, extra_photos[]
additional_switchboards:  photo, extra_photos[]
hvac_units:               photo, nameplate_photos, indoor_unit_nameplate_photo,
                          controller_photo, extra_photos[]
lighting_systems:         photo, fixtures_photo, mounting_constraints_photo,
                          sensors_photo, extra_photos[]
solar_pv:                 roof_photo, inverter_label_photo, electricity_meter_photo,
                          additional_solar_space_photo, switchboard_photo, extra_photos[]
forklift_chargers:        charger_photo, charger_label_photo, electric_connection_photo,
                          charger_space_photo, socket_connection_photo, extra_photos[]
hot_water_systems:        photo, additional_photo, extra_photos[]
general_water:            photos[], extra_photos[]
general_electricity:      photos[], extra_photos[]
```

---

## SecureStore Keys

### SolarSense
| Key | Value |
|---|---|
| `ss_cloud_jwt` | Short-lived Solar Sense access JWT |
| `ss_cloud_refresh` | Rotating Solar Sense refresh token |
| `ss_cloud_local_owner` | Local user ID bound to the token pair |
| `ss_last_synced_at` | ISO8601 timestamp of last successful sync |

### EcoAudit Pro
| Key | Value |
|---|---|
| `ea_cloud_jwt` | Short-lived Eco Audit access JWT |
| `ea_cloud_refresh` | Rotating Eco Audit refresh token |
| `ea_cloud_local_owner` | Local user ID bound to the token pair |
| `ea_last_synced_at` | ISO8601 timestamp |

---

## Sync Trigger Points

| Event | Action |
|---|---|
| App comes to foreground (AppState → active) | `runSync()` |
| Inspector taps "Mark as Complete" | `runSync()` |
| Every 15 minutes while app is open | `runSync()` |
| Background fetch (iOS / Android WorkManager) | `runSync()` (silent, no progress UI) |
| "Run Sync Now" button in DiagnosticsScreen | `runSync()` |
| "Retry" button in SyncStatusBanner | `resetFailedForRetry()` then `runSync()` |

---

## New App Dependencies Required

Both apps need these additional packages:

```bash
npx expo install expo-background-fetch expo-task-manager
```

`expo-crypto` (for SHA-256) and `expo-file-system` are already installed in both apps.
`expo-secure-store` is already installed in both apps (used by authRepository).
