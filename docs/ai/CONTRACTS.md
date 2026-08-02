# Cross-System Contracts

These are the contracts most likely to cause an existing feature regression.

## Photo Metadata

EcoAudit photo captions and PDF sizing are one value represented as:

```ts
type PhotoMetadata = { name?: string; largeInPdf?: boolean };
type PhotoMetadataMap = Record<string, PhotoMetadata>;
```

- Public/API model: `photoDescs`.
- Database column: `photo_descs`, mapped by Drizzle as `photoDescs`.
- Scalar metadata key: the canonical mobile photo field name.
- Array metadata key: `fieldName.index`.
- Upload/registry array field: `fieldName[index]`.
- Portal authority: `apps/ecoaudit/src/lib/photoMetadata.ts`.
- API authority: `src/routes/ecoaudit/helpers.ts` and field-specific canonical
  helpers such as `lightingPhotoField.ts`.
- PDF authority: the record's canonical `photoDescs`; the PDF must not maintain a
  second caption or sizing field.
- Completed EcoAudit records remain immutable except for an authenticated
  `photoDescs`-only update. That exception may change photo captions/PDF sizing
  but no business fields, and an older mobile sync must not overwrite newer
  server-side photo metadata.

The lighting controls image is canonically `switchboardControlsPhoto`.
`switchboardPhotoNotes` is a legacy compatibility alias only. A rename must cover
the equipment JSON metadata, `photo_registry.field_name`, and
`photo_copy_references.target_field_name`, then retain only the minimum read/sync
alias required for installed clients.

## Photos and Copies

`photo_registry` identifies stored originals. `photo_copy_references` grants a
copied record access to an immutable original without duplicating bytes. Keep the
original URL/checksum as the durable reference; thumbnails are previews and must
not replace original references used by PDF or sync. Reconciliation must remain
app-, parent-, entity-, and ownership-scoped.

## Export Jobs

PDF and photo ZIP exports share the `pdf_jobs` table and generic export job API.
The artifact discriminator is `pdf` or `photos-zip`.

- Queue expensive work through `src/services/exportJobQueue.ts`.
- Persist state through `src/services/pdfJobService.ts`.
- Expose status/latest/download through `src/routes/pdfJobs.ts`.
- Portal workflows use `useExportJob` and `ExportJobStatus` so progress survives
  navigation and completed downloads remain available.
- Do not open all object-storage streams at once. Consume each stream before
  requesting the next and upload large artifacts from a file/stream with known
  length.
- Do not impose a fixed browser timeout on server work. Show durable progress and
  let the user leave the page.
- Keep direct endpoints used by mobile clients compatible until mobile versions
  have been migrated and the deprecation is explicit.

EcoAudit photo ZIP paths follow the mobile report inventory hierarchy. The
`by-zone` mode is `Zone / Report section / Item / Photo caption`, while
`by-equipment` is `Report section / Zone / Item / Photo caption`. Folder names
come from zone and equipment records, never entity UUIDs. Duplicate captions get
deterministic numeric suffixes and all path segments are archive-safe.

### Field App Complete PDF jobs

Field App Complete queues reports through:

```text
POST /v1/installhub/installations/:installationId/forms/:formId/report/pdf/jobs
POST /v1/installhub/installations/:installationId/report/pdf/jobs
     body: { formSubmissionIds?: string[] }
GET  /v1/export/jobs/latest?entityId=<id>&artifactType=pdf
GET  /v1/export/jobs/:jobId
GET  /v1/export/jobs/:jobId/download
```

The two start routes require a completed, backed-up form source and installation
access and return HTTP 202 `{ jobId, reused }`. The installation route includes
all completed forms when `formSubmissionIds` is omitted. Status/download is
app-scoped and owner-scoped, with admin override; download returns 409 until the
job is complete. Active equivalent work is reused, and clients persist/poll the
job instead of applying a fixed overall timeout.

The versioned Field App Complete report manifest is the shared source for server form
labels, order and conditional visibility across the six schema-v2 form families
and the readable schema-v1 A3RM/A6M forms. Server reports use the Sustainability
Wise A4 theme and confirmed original evidence. Resolve every attachment by its
exact `attachments[index].uri` registry identity; never guess by filename or
slot, substitute a thumbnail, or silently omit a missing original.

More than 120 photos or more than 120 MiB raw evidence activates semantic
section-boundary chunking with a target of about 50 photos per rendered part.
Compress originals, render parts sequentially, and merge them into one PDF.
Individual forms and installation packs must follow the same manifest, evidence,
branding, storage, and durable-job rules.

Field App Complete stored-artifact and snapshot reads are:

```text
GET /v1/installhub/installations/:installationId/files
GET /v1/installhub/installations/:installationId/versions
GET /v1/installhub/installations/:installationId/versions/:versionNumber
```

Files include accessible confirmed originals and completed Field App Complete report
artifacts. Versions are immutable complete full sync snapshots and are added
only when a complete or legacy-unstaged push differs from the latest stable
snapshot; metadata-stage pushes are excluded. All three routes use creator,
assigned-inspector, or elevated access.

### Field App Complete portal

The portal workspace lives under `/installhub` and uses the `installhub` auth
namespace and separate `ih_web_jwt`/`ih_web_refresh` browser keys. Portal
installation edits write a complete cloud tree through the same sync contract
used by mobile; evidence uploads retain the exact entity/field identities used
by iOS. Dynamic form visibility, allowed selections, hidden-value cleanup,
required evidence, completion rules, legacy read-only forms, amendment
provenance, and scanner modes must remain aligned with the mobile form catalog.

The portal is cloud-first. It may expose files, immutable versions, reports,
access assignment, and administrative user controls, but must not present
browser cache as the iOS local working copy or silently implement the mobile
pull/import flow. Self-service password changes require the current password;
an administrator may reset another user's password without it.

## Authentication and Ownership

Every protected domain route uses `authenticate`, `requireApp(product)`, and the
minimum role. Role hierarchy does not replace the app boundary. Non-elevated
sync and CRUD operations cannot assign another creator or access another user's
parent. Fleet viewer access is read-only; collector ingestion requires
`service_account`; user administration requires `admin`.

Field App Complete account and access endpoints are part of that boundary:

```text
GET    /v1/installhub/users                         admin
POST   /v1/installhub/users                         admin
GET    /v1/installhub/users/:id                     self or admin
PATCH  /v1/installhub/users/:id                     admin
PATCH  /v1/installhub/users/:id/password            self or admin reset of another user
DELETE /v1/installhub/users/:id                     admin deactivation
DELETE /v1/installhub/installations/:installationId?purge=true   creator or elevated
GET    /v1/installhub/installations/:installationId/access   creator, assignee or elevated
PATCH  /v1/installhub/installations/:installationId/access   admin
```

The access patch assigns one active Field App Complete user or clears the assignment
with `assignedInspectorUserId: null`; it does not transfer ownership. User
mutations cannot remove the last active admin or let an admin demote/deactivate
themself. Password, role, active-state and deactivation changes revoke affected
Field App Complete refresh tokens.

Assigned-only access does not authorize permanent Cloud Backup deletion. Purge
must reject active PDF jobs, release copied-parent references, preserve
originals still referenced by another backed-up copy, and remove the
installation tree, unreferenced originals, completed report files/jobs, and
record versions.

## Sync and Lifecycle

Mobile sync payloads are compatibility contracts. Completed records are eligible
for sync and photo upload; draft records are not. Preserve stable completion
timestamps and idempotent upsert behavior. Copy/import and sync endpoints must
apply the same canonical field normalization as portal CRUD.

Field App Complete uses one complete installation tree per push. Mobile backup is opt-in per installation;
new and migrated local records are not eligible until the user enables it. Pull/import visibility
is creator, assigned inspector, or elevated access. Imports are fresh-ID local copies with
deterministic `cpN` names and immutable original media URLs; only 400 px authenticated thumbnails
are cached. Backing up an imported copy reconciles shared photo-copy references instead of copying
bytes. The four child arrays
(`zones`, `electricalAssets`, `siteAssets`, and `formSubmissions`) are required;
omitting a previously stored child from the snapshot soft-deletes it. The mobile
client must push sanitized metadata before creating upload sessions, confirm
every media upload, replace local-only URIs with confirmed remote URLs, and push
the final snapshot before advancing its local backup watermark. The first push
uses `syncStage: "metadata"` and never creates a record version; the final push
uses `syncStage: "complete"` and is versioned. An absent `syncStage` remains a
versioned legacy-complete push. Before each attempt, mobile reconciles its
durable media queue to the current exact installation references so removed or
replaced failed uploads cannot block the final snapshot. A `file://` or
`content://` URI must never be persisted by the API.

Field App Complete deduplication is exact and scoped by app, installation, entity type,
entity ID, field name, and SHA-256 checksum. Upload-session creation and
confirmation require owner access to both the installation and referenced
entity. The raw upload URL carries a short-lived HMAC capability bound to app,
session UUID, and expiry; the session UUID alone is never authorization. Its
bytes must match both the declared size and checksum.

Stored originals and report artifacts under `/v1/files/*` require either a
bearer token with exact app/parent authorization or a short-lived server-issued
file capability. Stable `remoteUrl` values are references, not public access
grants. Never log a capability query string.

Object writes support `legacy`, `dual`, and `isolated` modes. In isolated mode
Eco Audit, Solar Sense, and Field App Complete must use distinct roots/buckets and
least-privilege credentials. Migration is copy-first and SHA-256 verified; read
fallback keeps rollback possible. Derived thumbnails use app-scoped v2 keys.

Field App Complete has six user-facing schema-v2 form families: WW Installation,
Comms Fault, ACE Switchboard, Honeywell Q400, Captis Logger, and SUMS
Logger. Schema-v1 A3RM/A6M installation types remain accepted for installed-data
compatibility but are not new-form choices. Completed WW and Communications
Fault submissions require device number, device ID, A3RM/A6M type, and matching
sensor selection. A3RM accepts only the three documented 3000A Rogowski sizes;
A6M accepts only 60A, 120A, 200A, 400A, or 600A.

WW Installation exposes three channels for A3RM and six for A6M. Every visible
current channel requires an explicit `channel.N.purpose`. `Main board supply`
permits only the `Mains Supply` load. `Sub-circuit / asset` requires an active
downstream load from HVAC, Lighting, Solar PV, Forklift Charger, Hot Water,
General Power, or `Other`; selecting `Other` also requires a non-empty
`channel.N.custom_load_type`. `Spare / unused` hides and clears that channel's
load, custom load, rating, and description, and suppresses its load evidence and
commissioning polarity/current in the app and report. An active channel requires
the exact device-compatible rating. A3RM payloads cannot retain hidden channel
4-6 values; the mobile condition engine clears their other hidden fields.

Current schema-v2 purpose/custom-load payloads are strict: they cannot use
purpose-incompatible loads or omit the custom label for `Other`. Load-only
schema-v2 Drafts from installed clients remain syncable through validation-only
inference when the entire purpose/custom-load shape is absent. A load-only
Completed form may use that projection only when the same ID is already
persisted as immutable Completed, or when readiness/reporting validates that
persisted row. Fresh Completed forms and Draft-to-Completed transitions remain
strict. The inference operates on a temporary copy and never mutates the stored
or returned snapshot. `Not Used` remains a legacy load-only compatibility signal
and is not a current load option. Schema-v2 answers reject the legacy
`not_applicable` value. Because form answers are already stored as JSON and
compatibility is applied only at the validation boundary, this contract change
requires no new database migration.

Completed ACE requires job number and all three phase CT serials; Honeywell Q400
requires the water-meter serial; Captis and SUMS require meter and logger
serials. SUMS retains the Captis field shape while the mobile scanner accepts
both barcode and QR values.

## Database Changes

- Add a new numbered migration; never rewrite an applied migration.
- Schema and migration must agree in the same change.
- Renames require data movement and compatibility handling, not just a TypeScript
  rename.
- JSON migrations preserve canonical values when both keys exist.
- Shared-table changes require EcoAudit, SolarSense, Field App Complete, and Fleet impact
  review.
- Production deploy order is migration first only when old code tolerates the
  new schema; otherwise use an expand/migrate/contract sequence across releases.
