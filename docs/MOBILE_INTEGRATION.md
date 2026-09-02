# Mobile Integration Guide

Cloud sync contracts for `installhub-mobile/`, `solarsense-mobile/`, and
`ecoaudit-pro/mobile/`.

The mobile applications are sibling repositories, not folders in this Git
repository. Treat the payload, photo-field, lifecycle, and thumbnail sections
below as compatibility contracts for installed app versions. Do not modify mobile
source during an API or portal-only task unless the request explicitly includes
it.

---

## Scheduler push notifications

Approved leave is enforced by the unified Scheduler API before a planned or
in-progress assignment can be created, moved, reassigned, or reactivated. The
mobile job and sync payloads remain additive compatibility consumers: they do
not need new leave fields, and they must not be used to bypass the Scheduler's
canonical assignment decision. The admin leaderboard label **Working hours on
site** continues to mean the existing persisted app-active milliseconds from
mobile work sessions; no new attendance capture is required.

After login and notification permission, each app obtains its Expo push token
and stores it with the authenticated app-scoped JWT:

```http
PUT /v1/notifications/devices/:stableDeviceId
Authorization: Bearer <app JWT>
Content-Type: application/json

{
  "expoPushToken": "ExpoPushToken[...]",
  "platform": "ios",
  "projectId": "<EAS project UUID>",
  "registrationGeneration": 7
}
```

Persist `registrationGeneration` with the device's local authentication state.
Increment it once when a new provider/login lifecycle begins; reuse the same
value for token rollover and foreground refreshes within that login. Call PUT
after login, foreground token refresh, or user change; it atomically transfers
a device/token away from stale credentials. Before clearing local credentials
on logout, call the ownership-scoped, idempotent
`DELETE /v1/notifications/devices/:stableDeviceId?registrationGeneration=7`.
The server durably revokes that account/device generation, so even a delayed
in-flight PUT from the logged-out lifecycle receives 409 and cannot re-enable
notifications. A new login must first persist an incremented generation. A
stale DELETE from a prior account/generation cannot disable the current owner.
If Expo reports `DeviceNotRegistered`, the API disables that exact token but
keeps the current lifecycle usable; register a replacement Expo token with the
same `registrationGeneration`. Only logout or account transfer revokes it.

Scheduler pushes are normal visible notifications. Under the current Scheduler
visibility policy, only Field App Complete jobs receive them, using Android
channel `scheduler`. The lock-screen title/body is deliberately generic (for
example, “New job assigned” / “You were assigned a scheduled job”) and never
contains an event title, site/client data, address, description, email,
credential, or token. The navigation payload is:

```json
{
  "type": "scheduler",
  "notificationKind": "assigned | changed | assignment_removed | cancelled | manual_reminder | one_day_before | one_hour_before | day_of",
  "eventId": "...",
  "sourceApp": "installhub",
  "sourceType": "installation",
  "sourceId": "...",
  "scheduledStartAt": "2026-08-20T09:00:00.000Z"
}
```

The data object is reserved routing metadata for future use. Current clients
show the operating-system popup only: they do not keep a notification history
or deep-link a notification tap into the work record. A normal app launch/list
and subsequent API/sync response remain authoritative for access.

For an active linked Field App installation, `/v1/installhub/sync/pull` also
adds `scheduleEventId`, `scheduledStartAt`, `scheduledEndAt`, `deadlineAt`, and
`scheduleStatus` to the returned installation object. These are additive,
read-only Scheduler projections used by the mobile job list and pre-start
summary; they are not canonical installation fields and must not be pushed back.
Every Scheduler mutation that changes the linked installation projection or one
of its projected job-detail fields advances `ih_installations.tree_revision`
and `updated_at` in the same transaction so installed clients never observe
changed assigned-work metadata at an unchanged CAS revision.

Linked Field App Complete installations are Scheduler notification targets.
EcoAudit and SolarSense records remain valid product-sync and active-time
records, but hidden Scheduler rows for those products do not queue new pushes.
Custom events and rows without a linked source ID also do not produce mobile
pushes. Active linked Field work queues generic reminders 24 hours before, one
hour before, and at the scheduled start. A trigger already due when work is
linked or rescheduled is not replayed. Delivery rechecks the live scheduler row,
linked Draft assignment, visibility policy, and automatic trigger timestamp at
the Expo send boundary, so a completed, deleted, rescheduled, cancelled,
reassigned, or hidden job cannot emit a stale active-work reminder. Recovered
24-hour and one-hour reminders expire at the scheduled start; the start-time
reminder expires at the scheduled end or 24 hours after start, whichever comes
first.

## Active foreground audit time

Time tracking is silent operational telemetry; no session history or running
timer needs to be shown. Count time only while the app is foreground-active and
the inspector is viewing or editing one specific audit unit. The tracked unit is
an EcoAudit audit, a SolarSense rooftop assessment, or a Field App Complete
installation. Stop accumulating immediately when the app backgrounds, the user
navigates away, another audit becomes active, or the unit is marked Completed.

Persist a stable device-generated session ID and cumulative checkpoint locally:

```json
{
  "revision": 4,
  "activeMilliseconds": 93000,
  "startedAt": "2026-08-15T10:00:00.000Z",
  "lastActiveAt": "2026-08-15T10:03:10.000Z",
  "endedAt": null
}
```

Use the product route for the active unit:

| App | PUT endpoint |
|---|---|
| EcoAudit Pro | `/v1/ecoaudit/audits/:id/active-time/sessions/:sessionId` |
| SolarSense | `/v1/solarsense/sites/:siteId/assessments/:id/active-time/sessions/:sessionId` |
| Field App Complete | `/v1/installhub/installations/:installationId/active-time/sessions/:sessionId` |

Increment `revision` for each cumulative advance. Keep `startedAt` fixed, advance
`lastActiveAt` and `activeMilliseconds` only for foreground-active intervals,
and send `endedAt: null` while open. On pause, navigation, backgrounding, or
completion, durably close the session with a non-null `endedAt` before starting a
new session later. Queue checkpoints for retry across restarts and connectivity
loss. A successful response always returns the authoritative row plus
`applied`; `false` means the server already has the same or a newer revision, so
the queued item can be acknowledged using the returned revision.

The API requires the parent to exist in cloud storage and applies normal product
ownership. Field App Complete installations with backup disabled therefore keep
their session checkpoints queued locally until the installation is backed up.
The checkpoint endpoint deliberately does not change parent sync watermarks,
tree revisions, record versions, or full-snapshot payloads.

These hours remain immutable app evidence when Scheduler finance reads them;
they are never assumed to be billable or cost hours. Effective commercial hours
default to zero, including an explicit migration reset for existing jobs, and an
administrator may edit the separate audited commercial value. App evidence may
remain fractional, but Billing hours accept only non-negative whole hours. The
portal's app-hours shortcut rounds the evidence to the nearest whole hour
(`0.5` rounds up) and clamps it at zero for Billing hours, while Cost hours keeps
the exact value. Billing hours accept typed digits only; arrow keys and
wheel/trackpad gestures do not step the value. Customer labour uses the
canonical nullable per-user billing rate configured in the portal; a
missing rate is reported for administrator setup and is never inferred by a
mobile client or from the job duration.

Completed units never resume counting merely because they are opened in the app.
A deliberate lifecycle transition back to `Draft` starts a fresh session; it
never reopens the prior closed session. The API rejects open or new
post-completion activity with 409. It accepts one delayed closed
offline checkpoint only when its start, last-active, and end timestamps all
precede the authoritative completion boundary (EcoAudit/Field `completedAt`;
SolarSense the earliest server-owned `completedAt` among a Completed assessment
and Completed parent site). SolarSense clients must not attempt to reopen records
through generic sync; a future reopen flow requires an explicit lifecycle API.
A completion conflict must never reopen a timer or block normal content
synchronization; clients may retain the rejected checkpoint while reconciling
parent state, but cannot add it to the completed unit.

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

`global_users` owns one canonical Eco Audit, Solar Sense, and Field App Complete
identity; `unified_users` retains one compatibility membership for each product.
A user created in any one app can sign into all three through the unchanged
`/v1/auth/login` contract with the same credential. The server returns a normal
app-scoped JWT whose user ID is the target product's projection ID, so installed
ownership checks and local IDs remain valid. Role, active state, profile,
password changes, and deactivation propagate to all three projections. Field
login and `/v1/auth/me` return the editable `ih_users` projection with
`sourceManaged: false` and `sourceApp: null`.

Deployment ordering is database first, API second: back up/export the three
legacy user tables and review equal normalized local usernames, apply all
migrations through 0030, then roll out the API binary. 0030 takes a short write
lock across identity and Field-subject reference tables, creates missing
projections, and remaps old Field owner/assignee/actor IDs atomically. It aborts
for same-product duplicate login keys, conflicting active states, or lifecycle
idempotency collisions; reconcile those diagnostics instead of bypassing them.
Existing mobile binaries require no coordinated release. A remapped Field
refresh token is intentionally revoked, so the next app session asks the user
to sign in again with the same credential.

The API owns a separate namespace:

| Concern | Contract |
|---|---|
| Routes | `/v1/installhub/*` plus shared `/v1/export/jobs/*` |
| JWT app claim | `installhub` |
| API-key prefix (administrative compatibility) | `sk_ih_live_*` |
| Tables | Product IDs remain in `ea_users`, `ss_users`, and `ih_users`; `global_users` owns identity/role/state, `global_user_credentials` preserves migrated credentials, and `unified_users` maps all three projections to one Field subject |
| Shared media registry | `photo_registry` rows with `app = installhub` |

### Daily route suggestions

Field App Complete can request the signed-in user's advisory daily route with a
normal human session:

```http
POST /v1/installhub/route-suggestions
Authorization: Bearer <installhub inspector-or-admin JWT>
Content-Type: application/json

{
  "date": "2026-08-24",
  "currentLocation": {
    "latitude": -33.8688,
    "longitude": 151.2093,
    "accuracyMeters": 15,
    "capturedAt": "2026-08-24T08:15:00.000Z"
  }
}
```

Alternatively, address mode sends the user-entered text in the same
authenticated POST body for server-side Australian geocoding:

```json
{
  "date": "2026-08-24",
  "startingAddress": "Flinders Street Station, Melbourne VIC 3000"
}
```

This route is self-only: it rejects API keys, other application namespaces, and
an `assigneeFieldUserId` request field. The authenticated user's saved IANA
timezone defines the local calendar day. The response uses the shared Scheduler
route-suggestion shape: optimized planned/in-progress Field jobs, unroutable
jobs, per-leg and total distance/time estimates, the optimization mode, and
warnings. `googleMapsUrl` remains `null`; clients must not add map, navigation,
or turn-by-turn behavior.

Capture location only after an explicit foreground action. Send `capturedAt`
for a device location so the API can enforce freshness. Address mode may reuse
an unchanged selected suggestion's Australian coordinates without
`capturedAt`; otherwise send a trimmed `startingAddress` of 3–300 characters.
Suggestions are optional, and the API resolves free-form text through its
Australia-filtered server-side geocoder. Exactly one of `currentLocation` or
`startingAddress` is accepted.
The API does not persist the origin,
provider geocodes, or optimized order. It can forward the selected origin and
job coordinates to the configured OSRM-compatible router, whose approved
privacy, retention, and logging policy therefore applies. Precise coordinates
belong in this authenticated POST body; clients and the API must not add them to
URLs, notifications, or application logs.

### Installation lifecycle endpoints

| Method and route | Purpose |
|---|---|
| `POST /v1/installhub/installations/:installationId/complete` | Atomically complete a ready canonical installation, pin its immutable version, and reconcile linked Scheduler work |
| `POST /v1/installhub/installations/:installationId/reopen` | Reopen the live installation as Draft while retaining its completed immutable version |

Completion requires `baseTreeRevision` and `idempotencyKey`, and accepts optional
nullable camelCase `completionNotes`. Notes are trimmed, blank input becomes
`null`, and meaningful text is limited to 2,000 characters. The exact normalized
value participates in the idempotency fingerprint, is stored in the completed
snapshot/report, and is cleared only from the live row when that installation is
reopened. Generic sync cannot create the first Draft-to-Completed transition.

### Sync endpoints

| Method and route | Purpose |
|---|---|
| `POST /v1/installhub/sync/push` | Transactionally upsert a complete installation tree |
| `GET /v1/installhub/sync/pull` | Pull owner/assignee/admin-visible trees changed since an ISO timestamp |
| `POST /v1/installhub/sync/check-photo` | Check an exact scoped SHA-256 match |
| `POST /v1/installhub/sync/create-upload-session` | Create a validated media session |
| `PUT /v1/installhub/sync/upload/:sessionId?expires=...&signature=...` | Use a short-lived app/session-bound HMAC capability, then verify size/checksum |
| `POST /v1/installhub/sync/confirm-upload` | Confirm storage and return the durable URL |

### Installation lifecycle endpoints

| Method and route | Purpose |
|---|---|
| `POST /v1/installhub/installations/:installationId/complete` | Atomically complete a ready canonical installation, pin its immutable version, and reconcile linked Scheduler work |
| `POST /v1/installhub/installations/:installationId/reopen` | Reopen the live installation as Draft while retaining its completed immutable version |

Completion requires `baseTreeRevision` and `idempotencyKey`, and accepts optional
nullable camelCase `completionNotes`. Notes are trimmed, blank input becomes
`null`, and meaningful text is limited to 2,000 characters. The exact normalized
value participates in the idempotency fingerprint, is stored in the completed
snapshot/report, and is cleared only from the live row when that installation is
reopened. Generic sync cannot create the first Draft-to-Completed transition.

`push` structurally requires `installation`, `zones`, `electricalAssets`,
`siteAssets`, and `formSubmissions`. It is a full-snapshot contract: an existing
child omitted from its corresponding array is soft-deleted. This transport
shape does not make business capture fields or evidence mandatory. Every
protected operation checks
the `installhub` app claim, inspector role, installation ownership, and entity
parentage. Mobile labels the pre-upload push `syncStage: "metadata"` and the
post-upload push `syncStage: "complete"`. Metadata pushes return
`versionNumber: null`; complete pushes create/deduplicate an immutable version.
For backward compatibility, an absent stage is treated as complete.

Business capture fields and evidence are optional. Only an explicitly `TBC`
electrical supply, asset metering state, or measurement target blocks
completion/readiness. Authentication, ownership/parentage, compare-and-swap
revisions, stable IDs, and structural tree/form/attachment shape remain
enforced. This policy is applied server-side and remains compatible with
installed mobile clients and their accepted aliases.

The installation object also carries additive job metadata for Scheduler and
Field App Complete: nullable `customerName`, `maas`, `serviceType`,
`meteringSolutionType`, `plannedMeterType`, structured Australian site fields,
site-contact name/phone/email, `customJobNumber`, `fergusJobNumber`, `quoteNumber`, `jobComments`,
`accessInformation`, `warrantyDevice`, `monitoringInstalled`,
`hardwareInstalled`, `solarCapacityKw`, `additionalMonitoringRequired`, and
`additionalMonitoringHardware`. Nullable booleans are tri-state: `null` means
unknown, and must not be converted to `false`. An older client that omits one of
these additive fields preserves the current server value; an explicit `null`
clears it. `solarCapacityKw` is nullable and, when present, must be finite and
between 0 and 1,000,000 inclusive.

`fergusJobNumber`, `quoteNumber`, and `plannedMeterType` are retained legacy
migration/import fields. Current Scheduler and Field App authoring UIs do not
request or write them. Scheduler also omits `customJobNumber` and relies on the
server-generated shared Job ID; installed clients may continue to exchange the
legacy nullable field. Scheduler creation requests NMI, MaaS, scope, and
metering type, but does not request job-scope comments; those optional values
remain available to Field App installation authoring and installed-client
compatibility.
`serviceType` remains the compatibility projection of the shared Field job
detail `workType` for installed clients.

These fields do not replace existing authorities. Installation lifecycle owns
the `Draft`/`Completed` status, and the completion endpoint owns `completedAt`
and `completedByUserId`. Scheduler owns scheduled time and scheduler actor; for
compatibility it projects the linked event's local calendar date and resolved
assignee display name into legacy `auditDate` and `inspectorName` fields. The
default grid-supply row owns the nullable, trimmed, maximum-100-character
electricity NMI, while meter/device entities
and form evidence own actual meter type and existing/new device identifiers;
`plannedMeterType` is planning metadata only. Contact and access information is
restricted operational detail and must not be copied into broad list labels,
notifications, invoice snapshots, or other unrelated exports.

New canonical-v2 zones carry a persisted `zoneCode` (uppercase letters,
numbers, and hyphens; maximum 16 characters). Newly unclaimed records receive
rule-4 identities. Boards use `INSTALLATION-ZONE-NN-TYPE-SWITCHBOARD_NAME`; site
assets and meters use `INSTALLATION-ZONE-NN-TYPE-HUMAN_NAME`, without repeating
the type when the normalized human name already contains it. Identities are
capped at 64 characters. `NN` is a single zone-wide sequence shared across all
three entity kinds, and retained claims prevent reuse after deletion. Mobile may
show a provisional offline value, but must accept and round-trip the server value
after sync. An explicit portal edit may refresh a generated rule-3/4 switchboard
claim to rule 4 while retaining its zone and sequence. Mobile clients must not
initiate that refresh. Existing rule-1 and rule-2 claims, overrides, site assets,
and meters remain frozen. Human names remain separately editable.

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

User administration edits the target product projection and the canonical
identity trigger applies the change to all three products. The API prevents an
administrator from demoting/deactivating their own account and prevents removal
of the last active Field App Complete administrator. Role/active/password
changes revoke outstanding refresh tokens for Eco Audit, Solar Sense, and Field
App Complete. Self-service current-password checks accept any credential
preserved for the same canonical identity; a successful change consolidates to
the new password. All active canonical users are valid installation assignees.

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
version. Canonical-v2.7 snapshots omit unresolved optional evidence; confirmed
media included in a snapshot keeps its exact registry identity and is
immutable. Metadata-stage pushes are intentionally excluded. File and version
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
copy reference). Unresolved optional evidence is omitted before the v2.7
snapshot is pinned; if a confirmed attachment is included, a missing original
is an integrity failure rather than evidence that may be silently substituted.

Large reports are compressed and rendered sequentially. More than 120 evidence
photos or more than 120 MiB of raw registered evidence activates section-boundary
chunking, targeting about 50 photos per part; parts are merged into one PDF.
Form jobs and installation-pack jobs share these report rules, storage naming,
durable job lifecycle, and configured OneDrive mirroring.

### Mobile backup sequence

1. Persist edits locally and mark the installation tree dirty.
2. Push metadata with all device-only media URIs removed.
3. Discover and durably queue the optional zone, board, embedded-meter,
   site-asset, and form attachment media selected for retention.
4. Deduplicate retained media by scoped SHA-256, otherwise
   create/upload/confirm a session.
5. Push the full tree again with confirmed remote URLs and omit any still-local
   or otherwise unresolved optional evidence.
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
Device type, device ID/number, serials, CT/Rogowski selections, job numbers,
logger details, channel purpose/load/rating, and other business answers are
optional in Draft and Completed submissions. Their absence does not create a
readiness issue. Device number remains distinct from serial, and direct `Other`
meter entry preserves a blank number rather than copying the serial. Scanner
modality remains a mobile capture concern.

For Installation, A3RM exposes exactly three channels and A6M exactly six, but
channel business values are optional. Supplied values retain their serialized
types and channel object shape, but no companion business answer becomes
mandatory. The UI may clear hidden load, rating, description, evidence, and
commissioning values for `Spare / unused`. New A3RM records present
`10cm-200A`, `10cm-333mV`, `20cm-3000A`, `30cm-3000A`, `45cm-3000A`, and
`Not Used`; new A6M records present `CT-60A`, `CT-120A`, `CT-250A`,
`CT-400A`, `CT-600A`, and `Not Used`. Persisted legacy sensor strings remain
accepted and visible for installed-client compatibility but are not offered for
new choices. Current editors clear hidden channel 4-6 values when A3RM is
selected; historical hidden observations do not become readiness issues.

Load-only and other accepted legacy answer shapes remain syncable through a
temporary compatibility projection that never rewrites the stored or returned
snapshot. `Not Used` remains a legacy load-only signal, not a current load
choice. SUMS retains the Captis answer shape, and barcode versus QR acceptance
remains a scanner concern.

Form answers and evidence may be omitted in either sync stage. When present,
object/array and value types, stable IDs, unique attachment IDs, image
attachment shape, capture timestamps, and HTTP(S) URI syntax remain enforced.
Unresolved optional evidence is omitted from
the immutable canonical-v2.8 snapshot; included confirmed media remains exact
and immutable. Schema-v1 records and installed schema-v2 clients retain their
compatibility behavior without a coordinated client release.

### Field App Complete web portal counterpart

The EcoSense portal exposes the same server-backed Field App Complete domain under
`/installhub`. It keeps an isolated `installhub` JWT/refresh session and uses the
same pull, full-snapshot push, exact photo-field upload, access, file/version,
user, and durable PDF-job endpoints as the iOS app.

Its Field App Complete user-management page reads `/v1/portal/users`, showing
Eco Audit, Solar Sense, and Field App Complete role/status memberships from
`unified_users` in one canonical-person-per-row matrix. Every identity has all
three memberships and the Field membership links to the existing editor. Every application login route
redirects to the portal's single `/login` page. The shared portal login is an
additive facade over the existing per-app sessions and falls back to the legacy
login calls only when the new endpoint is unavailable. If an Eco Audit or Solar
Sense portal session already exists, `/v1/auth/field-session` creates the
separate Field App Complete session after verifying both its source JWT and matching active
source refresh session, without displaying another login page. The exchange
resolves the same canonical Field projection used by direct Field login.

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

The portal also exposes additive per-meter history and rollback over immutable
server record versions. Comms completion pins the pre-replacement state before
the replacement version; metadata-stage writes remain unversioned and cannot
complete a form. A replacement completion cannot also alter assignments or
affected asset metering state. For an A6M-to-A3RM downgrade, clear or migrate
channel 4–6 assignments in a prior metadata sync; otherwise completion returns
`comms_replacement_mapping_changed` and leaves the current device and mappings
unchanged. Rollback is a server-owned Draft-only operation with access,
revision, reason, and idempotency checks, and creates a new version rather than
rewriting history. Existing mobile push/pull payloads and endpoints are
unchanged, so this server/portal release does not require a coordinated mobile
release. The installed client does not yet preflight the channel 4–6 mapping
guard before locally completing an A6M-to-A3RM form; field teams must clear or
migrate those assignments first. A later mobile release should surface that
specific restriction before local completion.

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

## Scheduler saved-site prefill

Selecting an existing canonical site in Scheduler fills the editable client,
site, address, contact, and access fields. Creating the job then produces a
fresh Draft product record linked to that saved site. It does not copy an
earlier audit, assessment, installation tree, device, form, photo, job scope,
NMI, or comment. If the user edits the address, the saved-site binding is
cleared and the new or matching address is linked without removing the original
saved address.

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
## Field App Complete meter inventory

Inventory is a separate authenticated tab. Every Field user can scan a Device
ID into their own inventory through `POST /v1/installhub/inventory/meters/scan`;
an existing company-stock row is claimed atomically and a duplicate user or
installed assignment is rejected. `GET /v1/installhub/inventory/meters?scope=mine`
supplies the meters offered during installation entry.

`GET /v1/installhub/inventory/me` also returns `isMaintainer`. Maintainers can
switch to the company register, register company stock, assign it to active
Field users, edit it with `expectedRevision`, and soft-delete uninstalled rows.
The Scheduler portal presents the same company/user stock as a meter-only
register and shows the current user custodian on each transferred row. It does
not create or schedule jobs from either Inventory view. Custody changes remain
owned by these Field inventory claim and maintainer-assignment flows.
The app does not remove a selected meter at local form-save time: server-side
canonical installation completion performs the custody transfer atomically so
offline drafts and failed syncs cannot lose stock.
