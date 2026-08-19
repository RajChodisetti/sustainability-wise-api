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
     body: {
       formSubmissionIds?: string[],
       detailMode?: "by-zone" | "by-electrical-hierarchy",
       recordVersionNumber?: number,
       liveMode?: true
     }
GET  /v1/export/jobs/latest?entityId=<id>&artifactType=pdf&reportVariantKey=<key>
GET  /v1/export/jobs/:jobId
GET  /v1/export/jobs/:jobId/download
```

The two start routes require installation access and a completed form source and
return HTTP 202 with durable job identity, provenance, detail mode, and report
variant fields. Authoritative reports use an eligible immutable
`recordVersionNumber`. An explicit `liveMode: true` preserves the legacy mobile
diagnostic path and produces a visibly non-authoritative report from one captured
tree revision; it must fail instead of mixing revisions if the live tree changes
after queueing. The portal offers live diagnostics for Draft installations and
requires an eligible pinned version for Completed installations. Supplying both
source modes, or neither, is invalid.

The installation route includes all completed forms when `formSubmissionIds` is
omitted. It always embeds the electrical map generated from the exact same
canonical or captured live tree and supports detail sections grouped either by
physical zone or by electrical hierarchy. Zone grouping must include shared or
unassigned infrastructure exactly once. Sustainability Wise branding, A4 page
frames, evidence handling, section-boundary pagination, and page stamping follow
the same PDF rules as SolarSense and EcoAudit. Equivalent work is isolated by a
fixed-length digest of the normalized form selection plus renderer, source, and
detail-mode identity; raw form IDs must not be placed in the latest-job query.

Status/download is app-scoped and owner-scoped, with admin override; download
returns 409 until the job is complete. Active equivalent work is reused, and
clients persist/poll the job instead of applying a fixed overall timeout.

The versioned Field App Complete report manifest is the shared source for server form
labels, order and conditional visibility across the six schema-v2 form families
and the readable schema-v1 A3RM/A6M forms. Server reports use the Sustainability
Wise A4 theme and confirmed original evidence. Resolve every attachment by its
exact `attachments[index].uri` registry identity; never guess by filename or
slot, or substitute a thumbnail. Unresolved optional evidence is omitted before
the canonical-v2.8 snapshot is pinned. Once a confirmed attachment is included
in that immutable snapshot, a missing original is an integrity error and must
not be silently ignored.

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
GET /v1/installhub/installations/:installationId/meters/:meterId/history
POST /v1/installhub/installations/:installationId/meters/:meterId/history/rollback
```

Files include accessible confirmed originals and completed Field App Complete report
artifacts. Versions are immutable canonical-v2.8 full sync snapshots; unresolved
optional evidence is omitted, while included confirmed media retains its exact
registry identity. Versions are added
only when a complete or legacy-unstaged push differs from the latest stable
snapshot; metadata-stage pushes are excluded. File, version, and meter-history
reads use creator, assigned-inspector, or elevated access.

Meter history is an additive projection over the same immutable installation
versions. A completed comms replacement pins its preimage before changing
device identity and appends provenance for the resulting version. The
completion boundary requires an A3RM/A6M model, a non-empty replacement serial,
and a model-valid sensor rating, and it may not change the meter's current
assignments or the metering state of affected assets. Save intended mapping
changes in a metadata stage first. In particular, an A6M-to-A3RM replacement
must clear or migrate assignments on channels 4–6 before the replacement form
can be completed; the server rejects the combined destructive transition with
`comms_replacement_mapping_changed`. Rollback
requires `targetRecordVersionNumber`, the current `baseTreeRevision`, a reason,
and an `idempotencyKey`; it rejects Completed installations, stale revisions,
wrong installation/meter scope, and channel layouts that cannot retain current
live assignments. It never deletes completed forms or prior versions, never
moves the meter between switchboards, and appends a new version/event even when
restoring a state that was active earlier.

### Field App Complete portal

The portal workspace lives under `/installhub` and uses the `installhub` auth
namespace and separate `ih_web_jwt`/`ih_web_refresh` browser keys. Portal
installation edits write a complete cloud tree through the same sync contract
used by mobile; evidence uploads retain the exact entity/field identities used
by iOS. Dynamic form visibility, allowed selections, hidden-value cleanup,
optional capture/evidence policy, TBC-only completion rules, legacy read-only forms, amendment
provenance, and scanner modes must remain aligned with the mobile form catalog.

The portal is cloud-first. It may expose files, immutable versions, reports,
access assignment, and administrative user controls, but must not present
browser cache as the iOS local working copy or silently implement the mobile
pull/import flow. Self-service password changes require the current password;
an administrator may reset another user's password without it.

## Scheduler internal active-time evidence

Scheduler finance summaries are restricted to active canonical global
administrators. Product work-session rows are the sole authority for app-active
time. Aggregate active time by the resolved named actor. This field remains
internal evidence and must not feed billing or cost hours, labour calculations,
invoice DTOs, invoice authoring UI, or PDFs. Billing hours remain a separately
audited, editable non-negative integer.

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
(`zones`, `electricalAssets`, `siteAssets`, and `formSubmissions`) are structurally
required by the full-snapshot transport; this is not a business-field
completeness rule. Omitting a previously stored child from the snapshot
soft-deletes it. Business capture fields and evidence are optional. The mobile
client must push sanitized metadata before creating upload sessions, confirm
each optional media item it elects to retain, replace its local-only URI with the
confirmed remote URL, and omit any still-unresolved optional evidence from the
final canonical-v2.8 snapshot before advancing its local backup watermark. The first push
uses `syncStage: "metadata"` and never creates a record version; the final push
uses `syncStage: "complete"` and is versioned. An absent `syncStage` remains a
versioned legacy-complete push. Before each attempt, mobile reconciles its
durable media queue to the current exact installation references so removed or
replaced failed uploads cannot block the final snapshot. A `file://` or
`content://` URI must never be persisted by the API.

Newly unclaimed boards, site assets, and meter devices use canonical naming
rule 4. Each zone has a persisted, installation-unique `zoneCode`
(1–16 uppercase letters/numbers in hyphen-separated groups). A generated board
identity is `INSTALLATION-ZONE-NN-TYPE-SWITCHBOARD_NAME`. Generated site-asset and meter identities are
`INSTALLATION-ZONE-NN-TYPE-HUMAN_NAME`; when the normalized human name already
contains the complete type segment, the type is not duplicated. Identities are
capped at 64 characters, with one retained sequence shared by every entity kind
in that zone. Sequence claims are never reused after soft deletion.
Board/site-asset `assetName` and meter `customName` remain separately editable;
they seed the suffix before the first server claim. An explicit portal edit to a
generated rule-3/4 switchboard name or type refreshes that claim in place under
rule 4 while retaining its zone and sequence. Site-asset and meter claims do not
refresh. Offline client values remain provisional until sync. Existing rule-1,
rule-2, and explicit override claims are immutable compatibility identities and
must round-trip unchanged.

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
compatibility but are not new-form choices. Device IDs/numbers, serials, sensor
ratings, job numbers, CT serials, logger details, and other business answers are
optional in every lifecycle state and do not gate completion. Device number
remains distinct from serial, and WW Installation retains the optional
switchboard address/map locator.

When a business value is supplied, its serialized type and enclosing object
shape still apply; no companion business answer becomes mandatory. New A3RM
records present `10cm-200A`, `10cm-333mV`, `20cm-3000A`,
`30cm-3000A`, `45cm-3000A`, and `Not Used`; new A6M records present `CT-60A`,
`CT-120A`, `CT-250A`, `CT-400A`, `CT-600A`, and `Not Used`. Historical sensor
strings remain accepted and visible for installed-client compatibility but are
not offered as new-record defaults. `Not Used` remains a legacy load-only
compatibility signal rather than a current load choice.

Adding a meter from a switchboard or in-progress site asset still branches by
device family. A3RM/A6M opens the WW Installation form, while `Other` opens the
canonical meter editor. Human name, manufacturer, model, serial, channels, and
capabilities are optional business capture. Any entity or channel that is
present must retain its stable ID, installation parentage, valid ordinal, and
structural object shape. The A3RM/A6M Comms Fault workflow is not offered for
`Other` meters.

Completion/readiness is blocked only by an explicit `TBC` electrical supply,
asset metering state, or measurement target. `UNMETERED` is a resolved state and
does not block. A missing optional assignment or channel target is not converted
into a readiness issue; cross-installation IDs, contradictory discriminated
union fields, and malformed relationship objects remain write-boundary
structural errors. Coverage projections keep declared state and calculated
coverage separate, and an explicitly `SPARE` channel requires no target.

WW Installation exposes three channels for A3RM and six for A6M, but purpose,
load, custom load, rating, description, evidence, and commissioning values are
optional. The editor guides purpose/load pairs through the controlled catalog,
and `Spare / unused` clears hidden channel values; these UI rules do not create
completion requirements. Current editors also clear hidden channel 4-6 values
when A3RM is selected. Load-only and legacy answer shapes from
installed clients remain syncable through compatibility projection on a
temporary validation copy; the stored or returned snapshot is never rewritten.

Form answers and attachments remain structurally validated when present:
object/array and value types, stable IDs, unique attachment IDs, image media
shape, capture timestamps, and HTTP(S) URI syntax still apply. Omitting an
optional answer or evidence item is valid. Unresolved optional evidence is left
out of the immutable canonical-v2.8 snapshot, while confirmed media that is
included remains exact and immutable. This server-side policy preserves
installed mobile payloads and aliases and requires no coordinated client or
database migration.

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
