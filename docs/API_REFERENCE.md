# API Reference

Full live documentation is available at `GET /v1/docs/` when enabled. In
production it is protected by normal Bearer authentication. Never place a JWT or
API key in a URL; use the Swagger UI authorization control/header.

This file is a non-exhaustive quick-reference index. `src/app.ts` and the product
route indexes are authoritative. Protected endpoints require `Authorization: Bearer <token>`
where the token is either a JWT access token or a service account API key. Public exceptions are
`/health`, `/v1/files/...`, and raw upload session URLs returned by create-upload-session.

---

## Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/v1/auth/login` | Email + password login. Returns JWT access + refresh tokens. |
| POST | `/v1/auth/portal-login` | Additive portal login facade. Returns separate, app-scoped legacy auth envelopes in `sessions`; an optional `target` must succeed before secondary sessions are attempted. With `target`, `skipApps` avoids replacing already-active secondary portal sessions. |
| POST | `/v1/auth/field-session` | With an existing Eco Audit or Solar Sense Bearer JWT and `{ "refreshToken": "<the matching active source refresh token>" }`, return a separate normal Field App Complete auth envelope without asking for credentials again. |
| POST | `/v1/auth/refresh` | Rotate refresh token. Returns new JWT pair. |
| POST | `/v1/auth/logout` | Revoke refresh token. |
| GET | `/v1/auth/me` | Return current user info from token. |

Eco Audit, Solar Sense, and Field App Complete share one canonical identity.
Creating a user in any product creates a projection in all three; password,
profile, role, active state, and deactivation changes propagate globally. An
administrator in any membership is therefore an administrator in all three.
Each response remains app-scoped: the JWT `app` claim names the requested
product and `user.id` is that product projection's existing authorization ID.
Field App Complete uses the canonical Field subject. It is not a cross-app
bearer token, and released `/login`, `/refresh`, `/me`, `/field-session`,
`/register`, and `/bootstrap-local` envelopes remain available.

Field login and `/me` now return `sourceManaged: false` and `sourceApp: null`:
the real `ih_users` projection is editable even when the identity was first
created in Eco Audit or Solar Sense. `/field-session` remains a convenience
exchange from an authenticated Eco/Solar session, but resolves that same Field
projection rather than creating a synthetic read-only identity.

Migration 0030 preserves every legacy password hash for a merged identity, so
any one of its former credentials can log into any of the three products. The
first password change replaces that preserved set and revokes refresh sessions
for all three projections. If two canonical candidates accept the same login
and password, authentication fails closed. Remapped legacy Field refresh JWTs
are revoked because their signed subject cannot be rewritten; sign in again
with the unchanged credential.

## API Keys

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/v1/api-keys` | admin | List all non-revoked keys for your app |
| POST | `/v1/api-keys` | admin | Create key — raw value returned once only |
| DELETE | `/v1/api-keys/:id` | admin | Revoke key |

## Unified portal users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/portal/users` | Eco Audit, Solar Sense, or Field App Complete admin JWT | Return one canonical person per entry with product memberships, shared Field subject, nullable `billingRate`, IANA `timezone`, `workingDaysMask`, and canonical `updatedAt` |
| PATCH | `/v1/portal/users/:globalUserId/billing-rate` | Eco Audit, Solar Sense, or Field App Complete admin JWT | Set the canonical user's non-negative hourly `billingRate`, or clear it with `null` |
| PATCH | `/v1/portal/users/:globalUserId/workforce-profile` | active canonical admin JWT | Set the user's IANA timezone and Sunday=1…Saturday=64 working-day mask using `expectedUpdatedAt` optimistic concurrency |

This endpoint selects public fields from `unified_users` and never returns or
loads password hashes. `key`/`identityIds` identify `global_users`; each
membership retains its product `userId` and includes the shared `fieldUserId`.
Role and active state should be identical in all three memberships; missing or
drifted projections are marked for attention.

The billing-rate PATCH accepts exactly `{ "billingRate": number | null }` and
returns `{ globalUserId, billingRate }`. The rate belongs to `global_users`, so
all product memberships for that person use one administrative value. It is
not inferred from a job, recorded time, or Scheduler defaults. A missing rate
remains `null`; commercial labour calculation reports the affected user and
requires an administrator to set the rate instead of guessing one.

The workforce-profile PATCH accepts exactly
`{ timezone, workingDaysMask, expectedUpdatedAt }`. At least one working-day bit
must be set. It row-locks the canonical identity and returns 409
`workforce_profile_version_conflict` for a stale revision.

The 0030 backfill treats one pre-existing row per product with the same
normalized real email or app-local username as one person. It prefers an
existing Field ID, then Eco, then Solar, independent of creation order. Deploy
after reviewing/exporting local-username matches. Migration aborts if one
product contains duplicate normalized keys, if matched rows disagree on active
state, or if canonicalizing lifecycle idempotency would collide; reconcile and
rerun. Existing admin role is combined with OR as required. Wattwatchers remains
separate: only identities that already had an active Eco/Solar admin Fleet
entitlement before migration may use the source-admin Fleet bridge; generated
global projections never grant it.

## Portal scheduler

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/portal/scheduler/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Australia%2FSydney` | admin | User leaderboard and per-currency financial lifecycle analytics for an inclusive custom calendar window (maximum 366 days) |
| GET | `/v1/portal/scheduler/leave-requests` | portal user | List the caller's leave requests; administrators may list team leave and filter by user, status, or overlapping date window |
| POST | `/v1/portal/scheduler/leave-requests` | portal user | Apply for inclusive date-based leave in the caller's saved timezone |
| POST | `/v1/portal/scheduler/leave-requests/:id/decision` | admin | Approve or reject pending leave with `expectedUpdatedAt`; approval rejects overlapping planned/in-progress work |
| POST | `/v1/portal/scheduler/leave-requests/:id/cancel` | owner or admin | Cancel pending or approved leave with `expectedUpdatedAt` |
| GET | `/v1/portal/scheduler/events` | portal user | List the caller's calendar (admins may filter all users) |
| POST | `/v1/portal/scheduler/events` | admin | Link one existing active Draft Eco Audit, Solar Sense, or Field App Complete job, or create a custom event |
| POST | `/v1/portal/scheduler/dispatches` | admin | Atomically create a new Draft product job, assign it, and create its planned event |
| POST | `/v1/portal/scheduler/address-suggestions` | portal user | Return Australia-only Photon address/postcode suggestions; reports `available: false` when the optional server-side geocoder is not configured |
| POST | `/v1/portal/scheduler/route-suggestions` | portal user | Suggest an open driving route from a fresh Australian current location through that user's active jobs for one local calendar date; admin overrides require an explicitly authorized origin |
| PATCH | `/v1/portal/scheduler/events/:id` | admin | Edit or reassign an event and keep the product assignment aligned |
| DELETE | `/v1/portal/scheduler/events/:id` | admin | Cancel the event and clear its product assignment without deleting the product |
| POST | `/v1/portal/scheduler/events/:id/remind` | admin | Idempotently queue an immediate reminder for the active event's assigned mobile user |
| GET | `/v1/portal/scheduler/job-options` | admin | Search active Draft jobs eligible for an existing-work link |
| GET | `/v1/portal/scheduler/unscheduled-jobs` | admin | List active Draft jobs without an active event |

The analytics endpoint reads one repeatable-read database snapshot. Its report
timezone defines the selected UTC interval and daily financial buckets; each
leaderboard user's saved timezone defines that user's working-day/leave labels.
Completion facts supply immutable first-completion time and attribution plus a
currency-preserving ex-GST/GST/inc-GST revenue snapshot. Accepted late session
evidence at or before completion affects working-hours analytics only and does
not rewrite the snapshot. Snapshot status, money, and `revenueCapturedAt` are
immutable; any revenue restatement requires a future explicit audited workflow.
Unavailable facts and legacy completions without a fact are counted as jobs but
do not borrow current finance revenue. Migration 0044 backfills every dateable
legacy completion as unavailable, including soft-deleted completed products;
soft delete does not erase commercial or HR history. The
`quality.completedWorkRevenue.undatedCompletedJobs` total exposes retained
Completed products with no fact or timestamp; they cannot be placed in a custom
window and no timestamp is invented. Backlog and pipeline are current
planned/in-progress Scheduler state, not reconstructed historical status, and
include only the three supported commercial product source pairs.
For the legacy no-fact attribution fallback, a non-cancelled Scheduler event is
chosen with planned/in-progress first, then newest update time, then lexical
event ID; product assignment is used only when that event identity does not
resolve.

Eco Audit audits, Solar Sense assessments, and Field App Complete installations
are supported Scheduler sources for both existing-work linking and authorized
new-work dispatch. The assignee must have an active identity in the selected
product. Existing rows remain visible in calendar and finance `All` views and
through direct API filters; discovery, assignment, active-time finance, and
eligible mobile notifications use the same product records. Migration 0040
removes the temporary Eco write fence installed
by 0038 without rewriting historical rows. Events cancelled by the earlier
cutover remain cancelled because the database cannot distinguish them safely
from intentionally cancelled work.

New-work dispatch accepts `sourceApp`, the assignee's canonical
`assigneeFieldUserId`, `scheduledStartAt`, `deadlineAt`, an optional
`estimatedDurationMinutes`, and a product-specific `job` object. The estimate
is a whole number from 1 through 10,080 minutes. Omitting it stores no estimate
and does not assume a default duration. New clients must not submit an arbitrary
`scheduledEndAt`; when an estimate is present, the server derives the calendar
end from `scheduledStartAt + estimatedDurationMinutes`. During the rolling
upgrade, the HTTP facade tolerates a deprecated string or null `scheduledEndAt`
from cached portal bundles but ignores it completely—it is never stored or used
to infer an estimate. Historical events keep their existing `scheduledEndAt`
and remain readable. Eco Audit requires
`siteName` and `siteAddress`; SolarSense requires `siteName`, `location`, and
`buildingIdName`; Field App Complete
requires `clientName`, `siteName`, and `siteAddress`. `auditDate` is optional
when calling the API directly and must use `YYYY-MM-DD`; the portal sends the
locally selected calendar date. Field App Complete defaults to
`Australia/Sydney` unless an explicit timezone is supplied.

For Field App Complete, the dispatch `job` object may additionally carry the
nullable installation metadata documented in the mobile integration guide and
`electricityNmi`. The API stores `electricityNmi` as nullable, trimmed text of
at most 100 characters on the installation's default grid supply rather than
duplicating it on the installation. Service type,
metering solution type, and planned meter type are bounded free text until a
separate approved business vocabulary exists. External Fergus and quote
references are not assumed globally unique. Omitting an additive field keeps an
existing value during legacy synchronization; sending `null` explicitly clears
it. Nullable booleans preserve unknown as `null`.

The supplied business labels map to existing domain authorities: status is the
product lifecycle, install schedule/date/by is the Scheduler event and actor,
electricity NMI is grid-supply data, actual meter/device IDs and types remain on
meter/device/form records, and completion date/by is server-owned lifecycle
evidence. Client name and site address retain their existing installation
fields. This avoids conflicting copies of operational facts.

For linked Field App Complete events, Scheduler projects the event start's local
calendar date and resolved assignee display name into the legacy installation
`auditDate` and `inspectorName` fields for older clients. The Scheduler event and
canonical assignee remain authoritative; this projection does not change product
lifecycle or completion evidence.

The server derives ownership and inspector display fields from authenticated
canonical identities. Client-supplied IDs, assignment, sync state, deletion,
completion, and lifecycle status fields are rejected. New work is always Draft
and its event is always planned. SolarSense dispatches and new links target a
rooftop assessment; historical site-linked events remain readable, but cannot
be newly linked or reassigned. Completed or deleted jobs are not linkable.
Product completion marks every non-cancelled linked calendar event done and
cancels its pending automated reminders; manual reminder history is preserved.
The projection is idempotently reconciled by explicit completion, and by Eco
Audit/Solar Sense mobile sync ingestion. Field App Complete uses its canonical
completion endpoint. Event status changes do not complete or reopen product data.

Address suggestions accept `{ query?, postcode?, limit? }`; an empty search
returns no suggestions. The response is `{ available, provider, attribution,
suggestions }`. Each suggestion contains
`id`, display `label`, street/address-line `freeform`, nullable `locality`,
`state`, `postcode`, fixed `countryCode: "AU"`, coordinates, `provider`, and a
nullable provider `placeId`. Unknown provider state names are returned as
`null`, never as an unsupported Australian state code. A missing provider is a
normal capability response (`available: false`), and clients must continue to
permit manual address entry.

New-work dispatch remains backwards compatible with the authoritative
product-specific `siteAddress`/`location` string and UUID source IDs. Its `job`
object may add `address: { freeform, locality?, state?, postcode?, countryCode:
"AU", latitude?, longitude?, provider?, placeId? }`. The structured
`freeform` is the user-entered address line and need not equal the composed
legacy string. Selected or manual structure is stored atomically on the owning
Eco Audit audit, SolarSense site, or Field App Complete installation. Stored
coordinates are used only while their fingerprint still matches the current
authoritative legacy address; otherwise route calculation ignores them and
transiently geocodes the current text.

Route suggestions accept `{ date, currentLocation: { latitude, longitude,
accuracyMeters?, capturedAt? }, assigneeFieldUserId? }`. Inspectors are always
restricted to themselves; an administrator may choose another active canonical
Field user through the API only when the submitted current location is an
explicitly authorized starting point. The shared portal keeps browser-location
planning self-only so an administrator's device location is never presented as
an employee's. The user's saved IANA timezone defines the requested local day. The
API reads planned/in-progress Eco Audit audits, SolarSense assessments, and
Field App Complete installations, then returns optimized `jobs`, explicit
`unroutableJobs`, leg and total estimates, schedule warnings, and one
`googleMapsUrl` in the optimized order. A configured OSRM table supplies exact
road-duration ordering; an unavailable router produces a deterministic
straight-line-distance fallback and warning. The operation is advisory: it
does not persist current location, provider geocodes, route order, or any
Scheduler mutation. To keep every stop in one Google Maps mobile URL, the
server accepts at most four jobs for the day (destination plus three
waypoints).

Event create and update use the same optional estimate contract. Updating an
unrelated field on a historical event does not erase its legacy end timestamp;
once its schedule or estimate is explicitly rewritten, the canonical derived
end applies.

Creating or linking mobile product work atomically queues an `assigned` push.
Meaningful title, schedule, deadline, status, or assignee changes queue the
corresponding update; an equivalent PATCH does not. Reassignment notifies the
former assignee that access was removed and the new assignee that work was
assigned. Cancellation cancels pending automatic notifications and notifies the
current assignee only when the linked product assignment was aligned before the
transition. Marking a scheduler event `done` cancels pending notifications and
does not queue a completion push. Active mobile events also queue
`one_day_before` exactly 24 hours before `scheduledStartAt`,
`one_hour_before` exactly one hour before it, and `day_of` at
`scheduledStartAt`; triggers already due or in the past are not replayed.

A notification target must be exactly Eco Audit/`audit`, Solar
Sense/`assessment`, or Field App Complete/`installation`, with a non-null linked
source ID. Custom events and historical Solar `site` rows have no Scheduler
mobile push target.
Before enqueue and again immediately before each Expo send batch, the
API verifies that the event is active, the linked product and (for Solar) parent
site are non-deleted Draft rows, and the current product assignment matches the
canonical scheduler assignee. A completed, deleted, rescheduled, or reassigned
job therefore cannot receive a stale automatic push. Recovered `one_day_before`
and `one_hour_before` jobs expire at the scheduled start; recovered `day_of`
jobs expire 24 hours after it or at `scheduledEndAt`, whichever comes first,
and all three use generic time-safe copy. Migration 0031 backfills
only future reminders for legacy rows already satisfying those checks; skipped
misaligned Draft rows can be repaired by explicitly saving their current
`assigneeFieldUserId`, which realigns product access and queues a fresh assigned
notice plus future reminders. Missing/completed/deleted and Solar-site legacy
rows remain skipped. Deploy through migration 0032 as well: it adds monotonic
device lifecycle fences, upgrades the durable notification attempt budget, and
terminalizes any nonterminal delivery rows left beneath an already-terminal
0031 job.

Migration 0041 permits `one_hour_before` in the durable job constraint and
backfills only aligned Eco Audit, Solar Sense, and Field App Complete events
whose one-hour trigger is still strictly in the future. Stop every pre-0041
notification worker before applying it, then start the 0041-capable API/worker;
older workers do not understand the new kind's timestamp fence. Before rolling
back to pre-0041 code, first quiesce delivery and cancel or otherwise terminalize
all nonterminal `one_hour_before` rows under the newer code.

Manual reminder input is `{ "idempotencyKey": "<client-generated value>" }`.
The first request returns HTTP 202 with
`{ "queued": true, "notificationId": "..." }`; the same key for the same
event returns the original ID with `queued: false`.

## Mobile notification devices

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/v1/notifications/devices/:deviceId` | Eco Audit, Solar Sense, or Field App Complete user JWT | Register or atomically transfer this app/device to the signed-in canonical user |
| DELETE | `/v1/notifications/devices/:deviceId` | same owning user/app JWT | Disable the destination during logout |

PUT accepts
`{ expoPushToken, platform: "ios" | "android", projectId, registrationGeneration }`.
`registrationGeneration` is a positive safe integer persisted by the app and
incremented once for each provider/login lifecycle; token refreshes in the same
lifecycle reuse it. DELETE does not accept a body and requires the same value as
`?registrationGeneration=N`.
Registrations are app-scoped even though identity is shared. Re-registering the
same device transfers it away from a prior login, and only one enabled device
may own a given Expo token within an app. A logout durably revokes that account's
generation, so a delayed PUT from the logged-out lifecycle returns 409 instead
of re-enabling notifications. Lower-generation DELETE requests and DELETEs from
another canonical owner are idempotent no-ops against the current registration;
a higher generation begins a new login lifecycle. API keys and Wattwatchers sessions
cannot register a mobile destination. DELETE is idempotent and ownership-scoped.
An Expo `DeviceNotRegistered` response disables only that exact destination,
not the login lifecycle fence, so a fresh token can be registered with the same
generation. Explicit logout and ownership transfer remain the only revocations.

## Files

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/files/:storageKey` | public URL | Download stored file referenced by `remoteUrl` |
| GET | `/v1/thumbnails/:storageKey` | inspector/service/admin | Return a cached JPEG preview, at most 400px wide, for an authorized photo |

Derive a preview URL by replacing `/v1/files/` in the stored original `remoteUrl`
with `/v1/thumbnails/`. Send the normal `Authorization: Bearer <token>` header.
The original URL and checksum remain the canonical references for PDF generation;
the thumbnail URL is display/cache-only. Successful responses include an `ETag`
and are safe to resume or retry. A storage key is accepted only when it belongs to
a confirmed photo in the caller's application and the caller can access its audit
or site.

## Durable Export Jobs

| Method | Path | Description |
|---|---|---|
| GET | `/v1/export/jobs/latest?entityId=...&artifactType=pdf|photos-zip` | Latest export created by the current user |
| GET | `/v1/export/jobs/:jobId` | Status, progress, and artifact metadata |
| GET | `/v1/export/jobs/:jobId/download` | Authenticated completed artifact download |

The older `/v1/pdf/jobs/:jobId` status/download paths remain compatibility
aliases. Product PDF and ZIP routes create durable jobs; direct photo ZIP routes
remain available where installed mobile clients require them.

---

## SolarSense

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/users` | admin | List users |
| POST | `/v1/solarsense/users` | admin | Create user |
| GET | `/v1/solarsense/users/:id` | admin or self | Get user |
| PATCH | `/v1/solarsense/users/:id` | admin | Update user |
| DELETE | `/v1/solarsense/users/:id` | admin | Deactivate user |

### Sites
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/sites` | inspector/admin | List sites (inspector: own only) |
| POST | `/v1/solarsense/sites` | inspector/admin | Create site |
| GET | `/v1/solarsense/sites/:id` | inspector/admin | Get site |
| PATCH | `/v1/solarsense/sites/:id` | inspector/admin | Update site fields |
| DELETE | `/v1/solarsense/sites/:id` | inspector/admin | Soft-delete site |
| PATCH | `/v1/solarsense/sites/:id/complete` | inspector/admin | Mark site Completed — enables sync |

### Assessments
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/sites/:siteId/assessments` | inspector/admin | List assessments for site |
| POST | `/v1/solarsense/sites/:siteId/assessments` | inspector/admin | Create assessment |
| GET | `/v1/solarsense/sites/:siteId/assessments/:id` | inspector/admin | Get assessment |
| PATCH | `/v1/solarsense/sites/:siteId/assessments/:id` | inspector/admin | Update assessment |
| PUT | `/v1/solarsense/sites/:siteId/assessments/:id/active-time/sessions/:sessionId` | inspector/admin | Idempotently checkpoint one foreground work session |
| DELETE | `/v1/solarsense/sites/:siteId/assessments/:id` | inspector/admin | Soft-delete |
| PATCH | `/v1/solarsense/sites/:siteId/assessments/:id/complete` | inspector/admin | Mark Completed |

### Photos
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/sites/:siteId/photos` | inspector/admin | List all photos for site |
| GET | `/v1/solarsense/sites/:siteId/photos/export` | inspector/admin | Download ZIP of all photos |
| DELETE | `/v1/solarsense/photos/:photoId` | admin | Delete photo from configured storage and registry |

### Sync
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/solarsense/sync/check-photo` | service/inspector | SHA-256 dedup check |
| POST | `/v1/solarsense/sync/create-upload-session` | service/inspector | Create photo upload session |
| PUT | `/v1/solarsense/sync/upload/:sessionId` | session URL | Upload raw image bytes to configured storage |
| POST | `/v1/solarsense/sync/confirm-upload` | service/inspector | Confirm upload complete |
| POST | `/v1/solarsense/sync/push` | service/inspector | Upsert sites + assessments |
| GET | `/v1/solarsense/sync/pull` | service/inspector | Delta pull since timestamp |

### PDF
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/solarsense/sites/:siteId/site-pack/pdf` | inspector/admin | Queue a durable site pack PDF export |

---

## EcoAudit Pro

### Users
Same shape as SolarSense Users at `/v1/ecoaudit/users/…`

### Audits
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits` | inspector/admin | List audits |
| POST | `/v1/ecoaudit/audits` | inspector/admin | Create audit |
| GET | `/v1/ecoaudit/audits/:id` | inspector/admin | Get audit |
| PATCH | `/v1/ecoaudit/audits/:id` | inspector/admin | Update audit |
| PUT | `/v1/ecoaudit/audits/:id/active-time/sessions/:sessionId` | inspector/admin | Idempotently checkpoint one foreground work session |
| DELETE | `/v1/ecoaudit/audits/:id` | inspector/admin | Soft-delete |
| PATCH | `/v1/ecoaudit/audits/:id/complete` | inspector/admin | Mark Completed — enables sync |

### Zones
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits/:auditId/zones` | inspector/admin | List zones |
| POST | `/v1/ecoaudit/audits/:auditId/zones` | inspector/admin | Create zone |
| GET | `/v1/ecoaudit/zones/:id` | inspector/admin | Get zone |
| PATCH | `/v1/ecoaudit/zones/:id` | inspector/admin | Update zone |
| DELETE | `/v1/ecoaudit/zones/:id` | inspector/admin | Soft-delete |

### Equipment (× 9 types)
Each type has identical CRUD. Replace `{type}` with one of:
`main-switchboards`, `additional-switchboards`, `hvac-units`, `lighting-systems`,
`solar-pv`, `forklift-chargers`, `hot-water-systems`, `general-water`, `general-electricity`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits/:auditId/{type}` | inspector/admin | List items for an audit |
| POST | `/v1/ecoaudit/audits/:auditId/{type}` | inspector/admin | Create item; body includes `zoneId` |
| GET | `/v1/ecoaudit/{type}/:id` | inspector/admin | Get item |
| PATCH | `/v1/ecoaudit/{type}/:id` | inspector/admin | Update item |
| DELETE | `/v1/ecoaudit/{type}/:id` | inspector/admin | Soft-delete |

### Photos
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits/:auditId/photos` | inspector/admin | List all photos for audit |
| GET | `/v1/ecoaudit/audits/:auditId/photos/export?mode=by-zone|by-equipment` | inspector/admin | Download a mobile-compatible hierarchical ZIP |
| POST | `/v1/ecoaudit/audits/:auditId/photos/export/jobs` | inspector/admin | Queue a durable hierarchical ZIP export |
| DELETE | `/v1/ecoaudit/photos/:photoId` | admin | Delete from configured storage and registry |

### Sync
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/ecoaudit/sync/check-photo` | service/inspector | SHA-256 dedup check |
| POST | `/v1/ecoaudit/sync/create-upload-session` | service/inspector | Create photo upload session |
| PUT | `/v1/ecoaudit/sync/upload/:sessionId` | session URL | Upload raw image bytes to configured storage |
| POST | `/v1/ecoaudit/sync/confirm-upload` | service/inspector | Confirm upload complete |
| POST | `/v1/ecoaudit/sync/push` | service/inspector | Upsert audit + zones + all 9 equipment types |
| GET | `/v1/ecoaudit/sync/pull` | service/inspector | Delta pull since timestamp |

### PDF
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/ecoaudit/audits/:auditId/report/pdf` | inspector/admin | Queue a durable EcoAudit PDF report |

---

## Scheduler commercial control

All commercial routes require an active canonical global administrator. Finance
belongs to the immutable source identity, not a calendar event. Exact supported
active identities are EcoAudit `audit`, SolarSense `assessment`, and Field App
Complete `installation`; custom events and legacy Solar site rows are excluded.
This backend support is independent of which sources the portal offers when an
administrator creates new work.

`GET /v1/portal/scheduler/finance?limit=25&cursor=...` returns
`{items,nextCursor}`. It includes every non-deleted Eco Audit, Solar Sense, and
Field App Complete job (scheduled or not) plus retained ledgers for deleted
historical work. Optional `sourceApp` and exact `sourceId` filters resolve a
supported job directly. Each row exposes stable
`financeId`, nullable `eventId`, explicit `jobStatus` and `eventStatus`, recorded
and effective hours, currency, revenue/cost/profit/margin, invoice/overdue state,
and `needsHoursReview`.

| Method | Path | Description |
|---|---|---|
| GET | `/v1/portal/scheduler/finance/portfolio-summary` | Exact portfolio KPI totals and invoice-status counts; optional `sourceApp`, exact `sourceId`, and `currency` filters; unlike currencies remain separate |
| GET | `/v1/portal/scheduler/expenses` | Paginated global Bills/Expenses list; `limit`, `cursor`, `kind`, `sourceApp`, `financeId`, and `search` filters; search includes expense, vendor/reference, source id, and resolved job/client/site fields |
| GET | `/v1/portal/scheduler/invoices` | Paginated global invoice list; `limit`, `cursor`, `status`, `sourceApp`, `financeId`, and `search` filters; each item exposes every participating finance/job/source |
| POST | `/v1/portal/scheduler/invoices/eligibility` | Preview 1–50 unique finance IDs, per-job available labour/quote/expenses, common currency, GST rate, structured issues, and whether explicit bill-to is required |
| POST | `/v1/portal/scheduler/invoices/quick` | Create one reservation-safe draft for 1–50 Completed jobs; auto labour is an editable suggestion |
| GET/PATCH | `/v1/portal/scheduler/invoices/:invoiceId` | Read any single/consolidated invoice or edit its draft header and lines; PATCH requires `expectedUpdatedAt` |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/issue` | Issue the immutable all-job snapshot using required `{expectedUpdatedAt}` |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/void` | Void an unpaid invoice and release every job reservation using required `{expectedUpdatedAt}` |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/mark-paid` | Mark an issued invoice paid using required `{expectedUpdatedAt}` and optional `{paidAt}` |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/pdf/jobs` | Queue the exact consolidated PDF revision using required `{expectedUpdatedAt}` |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/email` | Queue Gmail delivery of an issued/paid invoice's exact branded PDF; requires `{expectedUpdatedAt,idempotencyKey}` and accepts optional `{to,subject,message}`; returns `202 {delivery,reused}` |
| GET | `/v1/portal/scheduler/invoices/:invoiceId/email-deliveries` | List the newest 100 durable email delivery audit rows, including queued/sent/failed/unknown status and provider message identity |
| GET | `/v1/portal/scheduler/invoices/:invoiceId/refunds` | List posted and reversed refund audit rows for the invoice |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/refunds` | Post an idempotent partial/full refund against an issued or paid invoice using `{expectedUpdatedAt,idempotencyKey,amountExGst,gstAmount,reason}` and optional refund time/reference; GST must match the invoice rate/final remainder |
| POST | `/v1/portal/scheduler/invoices/:invoiceId/refunds/:refundId/void` | Reverse a posted refund auditably using `{expectedUpdatedAt,reason}`; the historical refund row is retained |
| POST | `/v1/portal/scheduler/expenses/:expenseId/attachments` | Upload one private PDF/JPEG/PNG/WebP bill attachment; see evidence rules below |
| GET | `/v1/portal/scheduler/expenses/:expenseId/attachments/:attachmentId/download` | Authenticated private download with safe Content-Disposition and `private, no-store` caching |
| DELETE | `/v1/portal/scheduler/expenses/:expenseId/attachments/:attachmentId` | Delete unreserved/uninvoiced evidence through the durable storage-deletion outbox |
| GET/PUT | `/v1/portal/scheduler/finance/:financeId` | Full summary / update pricing, internal cost rate, billing contact, and audited hour override; customer billing rates belong to canonical users |
| POST | `/v1/portal/scheduler/finance/:financeId/expenses` | Create structured ex-GST expense or supplier bill |
| PATCH/DELETE | `/v1/portal/scheduler/finance/:financeId/expenses/:expenseId` | Edit/delete an unreserved expense |
| GET | `/v1/portal/scheduler/finance/:financeId/invoices` | List draft/issued/paid/void invoices |
| POST | `/v1/portal/scheduler/finance/:financeId/invoices/quick` | Create a Completed job's draft with editable quote/labour and selected billable-expense suggestions |
| GET/PATCH | `/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId` | Read invoice / edit draft bill-to, due date, notes, PO reference, and lines; PATCH requires displayed `expectedUpdatedAt` |
| POST | `/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId/issue` | Freeze current seller, bill-to, job, and line snapshots using `{expectedUpdatedAt}` |
| POST | `/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId/mark-paid` | Mark issued invoice paid; required `{expectedUpdatedAt}`, optional `{paidAt}` between issue and transition time |
| POST | `/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId/void` | Void unpaid invoice and release reservations using required `{expectedUpdatedAt}` |
| POST | `/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId/pdf/jobs` | Queue a durable branded PDF using `{expectedUpdatedAt}` for the invoice's exact `id` + revision; returns HTTP 202 with `jobId`, `sourceUpdatedAt`, and `reportVariantKey` |
| GET | `/v1/export/jobs/latest?entityId=:invoiceId&artifactType=pdf&reportVariantKey=...` | Recover the current administrator's latest matching invoice export after navigation/reload |
| GET | `/v1/export/jobs/:jobId` | Poll queued/running/complete/failed status and the canonical branded filename |
| GET | `/v1/export/jobs/:jobId/download` | Stream the completed PDF with safe ASCII `filename` and UTF-8 `filename*` Content-Disposition values |

Invoices expose nullable `xeroInvoiceNumber` and `xeroDate` as reconciliation
metadata distinct from the internal invoice number/date and
`purchaseOrderReference`. They may be set or cleared with the normal
`expectedUpdatedAt` compare-and-swap while the invoice is draft, issued, or
paid. A void invoice remains immutable. `xeroInvoiceNumber` is trimmed and
limited to 100 characters; `xeroDate` is a valid `YYYY-MM-DD` calendar date.
These fields record an external-system reference only; they do not perform or
imply Xero API synchronization.

Invoice email delivery status is `queued` while its exact PDF or a safe retry
is pending, `processing` only while one worker owns the attempt, `sent` after
Gmail returns a provider message ID, `failed` after a definitive rejection or
retry exhaustion, and `delivery_unknown` when Gmail may have accepted a request
whose acknowledgement was lost. Never automatically resubmit
`delivery_unknown`; verify the sender mailbox before an administrator chooses a
new idempotency key. Replaying the same invoice/idempotency key and identical
request returns the original row with `reused: true`; changing that request is a
409 conflict. `to` defaults to the invoice's snapshotted `billToEmail`. Draft or
void invoices return 409, an absent/invalid recipient returns 400, and an API
runtime without explicitly enabled Gmail credentials returns 503.
Voiding an invoice while its Gmail provider submission is in progress returns
409; retry only after the delivery reaches a terminal audit status. This fence
is enforced in PostgreSQL as well as the current API so rolling older writers
cannot invalidate an invoice during the external send boundary.

Equivalent `/v1/portal/scheduler/events/:eventId/...` routes remain adapters for
calendar views. Responses include the canonical `financeId`; migrated Field
history without an event must use the finance-id family.

Scheduler invoice export jobs use the requesting portal credential's app and
user as their ownership namespace even when the invoice belongs to another
product. Start, latest, status, and download therefore use the same selected
administrator credential. Every access revalidates that exact owner as a
currently active canonical global administrator; same-app administrator bypass
is disabled for these finance artifacts. `reportVariantKey` includes the
renderer version, immutable invoice id, and invoice `updatedAt`, so draft edits,
issue, mark-paid, and void transitions cannot surface an older PDF.
Persisted Scheduler PDF jobs are claimed by a startup/poll worker using a
heartbeat lease and ownership token. Queued work survives a crash before local
dispatch; expired running work is safely resumed, while fresh rolling-old jobs
receive a one-hour compatibility grace. Completion is token-fenced before a
linked invoice email becomes eligible.
One-job exports keep the established job-name/job-date filename. Consolidated
exports use the first snapshotted job name, `and-N-more`, invoice date, and
invoice number in a bounded filename; no client identity is stored in the
durable job parameters. The branded PDF groups lines under each immutable job
name, date, and billing reference, repeats job/table context across page breaks,
shows each job subtotal, and finishes with consolidated ex-GST, GST, and
inc-GST totals.
The renderer loads the header, job snapshots, and lines in one repeatable-read
transaction. Before a durable job becomes complete, the API locks the invoice,
rechecks the pinned `updatedAt`, and atomically attaches the stored object. A
pre-write deletion outbox protects partial/interrupted writes; fresh tasks have
a one-hour rolling-release lease, while explicit failures clean up immediately.
Draft edits and issue also compare `expectedUpdatedAt` under the invoice row
lock. A stale portal intent receives HTTP 409 and refetches the latest snapshot
instead of overwriting or issuing values reviewed in another session.
Void, mark-paid, and PDF enqueue apply the same required revision contract.

Quick Invoice lines are suggestions, not a customer-facing derivation contract.
While an invoice is a draft, PATCH may add, edit, or remove its lines, including
manual `other` charges and suggested labour. Each line supplies description,
quantity, ex-GST unit amount, optional job `financeId`, optional linked expense,
and optional `showQuantityAndRate`. New lines default to amount-only display;
quantity/hours and unit/billing rate appear in the PDF only when an
administrator explicitly enables `showQuantityAndRate`. Issue freezes the
reviewed lines as immutable accounting snapshots.

Released Field clients retain the legacy direct download adapter at
`GET /v1/installhub/installations/:installationId/invoices/:invoiceId/pdf`.
The Scheduler portal does not use that synchronous route.

All wire amounts and stored job expenses are ex-GST decimal currency values;
the database stores integer cents and invoices add the configured GST snapshot.
Issuing a GST-bearing invoice requires a nonblank
`SCHEDULER_INVOICE_SELLER_ABN`; absence returns a controlled HTTP 409 instead of
publishing a GST invoice without the supplier identity. QA/production must set
the legal Sustainability Wise seller ABN before enabling invoice issue.
`time.actualMilliseconds` is the immutable sum of foreground work sessions.
Every insert and revision is rejected when cumulative active time exceeds its
`startedAt`→`lastActiveAt` wall span by more than the documented five-second
monotonic/wall-clock tolerance; client time is therefore plausible evidence,
not an unconstrained billable number.
App-recorded hours are evidence for an administrator to review, not assumed
commercial hours. Effective billable and cost hours default to zero and remain
directly editable through audited overrides; changing them never edits the raw
sessions. Overrides require a reason, and `overrideSource`, actor, timestamp,
and monotonic revision retain provenance. `billableHoursOverride` is a
non-negative whole-hour integer; the finance update rejects fractional billing
hours. App-recorded `actualHours` retains its fractional precision as evidence.
When the portal's app-hours shortcut copies that evidence into Billing hours, it
rounds to the nearest whole hour (`0.5` rounds up) and clamps the result at zero.
The shortcut keeps the exact app value in Cost hours; the whole-hour constraint
applies only to Billing hours.
The Billing hours field accepts typed digits only. Wheel and trackpad gestures
continue scrolling the page, while arrow keys retain normal text-caret behavior;
neither interaction changes the stored hour value.
`hoursVariance` means actual minus scheduled hours, while
`commercialHoursVariance` means effective billable minus effective cost hours.
Migration 0038 appends a zero-hour administrative revision wherever an existing
explicit or migrated legacy override could otherwise remain nonzero; pristine
ledgers evaluate to zero without creating purge-blocking evidence. Legacy estimated hours no
longer block invoice creation, issue, or PDF generation; raw active-time
evidence and already-issued invoice snapshots are preserved.

Non-void draft, issued, and paid lines reserve their linked labour/quote/expense
values, preventing Quick Invoice duplication. Voiding releases reservations;
paid invoices cannot be voided. Issued and paid snapshots remain readable and
downloadable even after operational job edits or deletion.
Job currency is locked once any expense or invoice exists. Pricing mode is
not locked by a non-void invoice, and later changes to pricing mode, quote,
commercial hours, user billing rates, or job cost rate affect only internal
calculations and future suggestions. Draft, issued, and paid invoice lines are
independent snapshots and therefore do not need to be voided before those job
settings change.
Consolidated jobs must share one currency. Differing or missing normalized
billing parties require an explicit immutable consolidated `billTo` snapshot.
Drafts may be saved with suggestions removed while an administrator builds the
customer-facing charges. At issue, every selected job must contribute a
positive line, and every line retains `financeId` plus its immutable job/source
provenance. A draft/issued/paid reservation is visible and enforced from every
participating job, including secondary jobs.
Every job must have current status `Completed` before draft creation and again
before issue. A draft PDF also requires all live jobs to remain Completed;
issued and paid historical snapshots remain exportable without reopening the
operational job.
Migration 0034 deliberately fails closed for pre-0034 line rewrites and
consolidated lifecycle updates. Before multi-job creation is used, every old API
process must be drained and the current API must pass health checks. Once any
invoice has more than one `scheduler_invoice_jobs` member, rollback to the d89
API is prohibited: the rollback target must include the 0034-aware grouped
read/PDF adapters and transaction-local lifecycle writer marker. The database
marker protects writes; it cannot make an old process render grouped reads
correctly.
Invoice due dates are calendar dates: an issued invoice becomes overdue only
after its UTC due-date day has passed, not at midnight at the start of that day.

Bill attachments are never exposed through public URLs. Uploads require a
current active canonical global administrator, `x-file-name`, raw bytes, and a
matching PDF/JPEG/PNG/WebP magic signature. Direct `Content-Type:
application/pdf`, image types, and octet-stream plus `x-file-content-type` are
accepted. The default maximum is 10 MiB (`SCHEDULER_BILL_ATTACHMENT_MAX_BYTES`,
capped at 25 MiB). Metadata exposes checksum, size, type, safe filename, and an
authenticated download path only. Upload and delete are rejected after the
expense is reserved or invoiced. Expense deletion atomically removes attachment
records and queues durable byte deletion; pending upload rows use a one-hour
lease plus startup/hourly reconciliation so crashes do not publish broken
evidence or race a live upload.

Permanent purge for EcoAudit audits, SolarSense assessments/sites, and Field
installations is rejected when the source (or any Solar site child) has a work
session, Scheduler event, edited commercial ledger, hour override, expense
(including soft-deleted rows/attachments), or invoice membership (including a
secondary consolidated job). Purge and first-ledger creation share a database
source-identity lock. Only a provably pristine auto-created ledger can be
removed with an otherwise evidence-free source. Migration 0034 also enforces
source, work-session, and edited-ledger deletion fences in PostgreSQL so an old
process being drained cannot bypass that retention policy.

## Active foreground time

The mobile apps checkpoint cumulative foreground-active time to a product-owned
session row. These endpoints do not expose a time-log UI and do not modify parent
`updatedAt`, sync status, tree revision, or record version fields.

| Product | Endpoint |
|---|---|
| EcoAudit Pro | `PUT /v1/ecoaudit/audits/:id/active-time/sessions/:sessionId` |
| SolarSense | `PUT /v1/solarsense/sites/:siteId/assessments/:id/active-time/sessions/:sessionId` |
| Field App Complete | `PUT /v1/installhub/installations/:installationId/active-time/sessions/:sessionId` |

All three accept the same complete replacement checkpoint:

```json
{
  "revision": 4,
  "activeMilliseconds": 93000,
  "startedAt": "2026-08-15T10:00:00.000Z",
  "lastActiveAt": "2026-08-15T10:03:10.000Z",
  "endedAt": null
}
```

`revision` and `activeMilliseconds` are non-negative safe integers. Timestamps
must be ISO date-times ordered as `startedAt <= lastActiveAt <= endedAt` when
closed. The authenticated user is stored as the actor; clients cannot supply or
change it. A new or higher revision is applied only if time and timestamps do
not regress, `startedAt` is stable, and a closed session's `endedAt` is never
cleared or moved. Lower and equal revisions are idempotent acknowledgements and
return the current server row without applying the request.

Every successful request is HTTP 200:

```json
{
  "sessionId": "device-generated-stable-id",
  "revision": 4,
  "activeMilliseconds": 93000,
  "startedAt": "2026-08-15T10:00:00.000Z",
  "lastActiveAt": "2026-08-15T10:03:10.000Z",
  "endedAt": null,
  "applied": true
}
```

`applied` is `false` for a stale or equal-revision retry. A missing or deleted
parent returns 404, inaccessible ownership returns 403, invalid input returns
400, and an actor change, higher-revision regression/reopen, or prohibited
completed-record update returns 409.

No open or advancing session is accepted once its audit unit is Completed. A
delayed offline checkpoint may still insert or close a session only when it is
closed and all three timestamps are at or before the authoritative completion
boundary. EcoAudit and Field App Complete use `completedAt`. SolarSense disables
tracking when either the assessment or its parent site is Completed and uses the
earliest applicable server-owned assessment/site `completedAt` boundary. Generic
EcoAudit and SolarSense sync cannot overwrite these boundaries or transition a
Completed record back to Draft; reopening requires the dedicated lifecycle
operation where available. This exception retains foreground work performed
before completion without counting later app opens. If a legacy Completed
SolarSense row lacks `completedAt`, the endpoint fails closed with 409 rather
than falling back to mutable `updatedAt`.

---

## Wattwatchers Fleet

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/wattwatchers/dashboard/summary` | viewer+ | Fleet status summary |
| GET | `/v1/wattwatchers/dashboard/trends` | viewer+ | Fleet status trends |
| GET | `/v1/wattwatchers/devices[/:deviceId]` | viewer+ | Device list/detail |
| GET | `/v1/wattwatchers/clients` | viewer+ | Client health |
| GET | `/v1/wattwatchers/runs[/:runId]` | viewer+ | Collection runs |
| GET | `/v1/wattwatchers/reports[/:reportId]` | viewer+ | Archived reports |
| GET | `/v1/wattwatchers/reports/:reportId.csv` | viewer+ | Report CSV export |
| GET | `/v1/wattwatchers/outages` | viewer+ | Outage history |
| POST/PUT | `/v1/wattwatchers/ingest/*` | service account | Idempotent collector ingestion |
| CRUD | `/v1/wattwatchers/users/*` | admin, self exceptions | Fleet users |

---

## Common Response Shapes

### Error
```json
{ "error": "string", "statusCode": 400, "detail": "optional extra info" }
```

### Pagination (list endpoints)
```json
{
  "data": [...],
  "meta": { "total": 47, "page": 1, "limit": 20, "pages": 3 }
}
```

### SolarSense Sync Push Response
```json
{
  "siteIds": { "<localId>": "<serverId>", ... },
  "assessmentIds": { "<localId>": "<serverId>", ... }
}
```

### EcoAudit Sync Push Response
```json
{
  "auditId": "<localId>",
  "serverId": "<serverId>"
}
```

### Upload Session Response
```json
{
  "sessionId": "uuid",
  "uploadUrl": "https://api.sustainabilitywise.com.au/v1/solarsense/sync/upload/uuid",
  "alreadyExists": false
}
```
