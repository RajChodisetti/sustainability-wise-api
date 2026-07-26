# System Context for Changes

This document is the stable business and runtime map for the repository. Source
code and applied migrations remain authoritative when older planning documents
disagree with it.

## Products and Users

### EcoAudit

Field inspectors capture audits, zones, nine equipment categories, photos, and
photo metadata. Completed audits sync from mobile and produce structured PDF
reports and photo ZIP exports. Admins can view all records and manage users.

### SolarSense

Inspectors capture sites and rooftop assessments with nested switchboards,
appendix items, and photos. Completed records sync from mobile and produce site
pack PDFs and photo ZIP exports. Admins can view all records and manage users.

### InstallHub

Field installers capture installations, zones, electrical boards and embedded
meters, site assets, commissioning forms, and photos. The mobile app remains the
local working copy and backs up complete installation snapshots and media only
after a per-installation opt-in. The API exposes creator-, assignee-, or
admin-visible trees for explicit local-copy import. Imported copies receive
fresh entity IDs and deterministic `cp1`, `cp2`, ... names while retaining
source installation/form IDs and immutable original evidence references.

InstallHub administrators manage users and assign one active user access to a
backed-up installation. The iOS app also exposes API/sync diagnostics and
protected local storage cleanup. Original evidence and form data are never part
of the generated-report or imported-preview cache-clearing operations.

The EcoSense portal exposes a cloud-first InstallHub workspace at
`/installhub`. It works directly against accessible API trees and mirrors the
iOS hierarchy, commissioning forms, evidence capture, data/TBC resolution,
metering table, reports, cloud files and versions, access controls, user
administration, and diagnostics. It does not emulate the iOS local database,
offline upload queue, or import-preview cache.

Completed forms and installation packs can be rendered locally or queued on the
API. Server jobs use the same six current form families, conditional values,
Sustainability Wise A4 visual rules, and confirmed originals. Large reports are
compressed and rendered in semantic chunks, then returned as one merged PDF.

### Wattwatchers Fleet

Collectors ingest device observations and client-scoped collection results.
Portal viewers inspect health, devices, outages, runs, reports, and CSV exports.
Ingestion is idempotent and requires a service account; administration requires
the Fleet namespace and admin role.

## Runtime Map

```text
EcoAudit mobile ---------\
SolarSense mobile --------> Fastify API -> PostgreSQL
InstallHub mobile --------/       |       -> per-app local/Spaces destinations
EcoSense web portal -------------/       -> Chromium PDF renderer
Collector service ---------------/

Fastify API:       src/                         PM2: sw-api
Export job queue:  src/services/                -> Chromium renderer -> PDF storage
Next.js portal:    apps/ecoaudit/               PM2: ecosense-portal
Legacy Vite UI:    web/                         served by Fastify when built
```

The mobile applications are sibling repositories:

- `../ecoaudit-pro/mobile/`
- `../solarsense-mobile/`
- `../installhub-mobile/`

They are not modified as part of an API or portal-only task. Their installed
versions still constrain compatibility in this repository.

## Namespace and Ownership Model

| Product | API prefix | Auth app | Primary tables | Portal source |
|---|---|---|---|---|
| EcoAudit | `/v1/ecoaudit` | `ecoaudit` | `ea_*` | `src/app/(portal)/ecoaudit`, `src/api` |
| SolarSense | `/v1/solarsense` | `solarsense` | `ss_*` | `src/app/(portal)/solar`, `src/modules/solar` |
| InstallHub | `/v1/installhub` | `installhub` | `ih_*` | `src/app/(portal)/installhub`, `src/modules/installhub` |
| Fleet | `/v1/wattwatchers` | `wattwatchers` | `ww_*` | `src/app/(portal)/fleet`, `src/modules/fleet` |

JWTs and API keys carry an `app` claim. That claim is a security boundary, not a
UI preference. Inspector reads and writes are ownership-scoped unless an
existing route explicitly grants elevated access. Copy and sync flows must not
allow clients to spoof creator or parent ownership.

Original file routes require bearer/parent authorization or a short-lived
server-issued capability. Raw upload URLs are HMAC-bound to app, session, and
expiry. Production object storage uses a distinct root/bucket and least-privilege
credential for each mobile app; `legacy` and `dual` modes exist only to support
the verified migration in `docs/SECURE_STORAGE_MIGRATION.md`.

### InstallHub route map

```text
/v1/installhub/
├── sync/
│   ├── POST push
│   ├── GET pull
│   ├── POST check-photo
│   ├── POST create-upload-session
│   ├── PUT upload/:sessionId
│   └── POST confirm-upload
├── users
│   ├── GET/POST /
│   ├── GET/PATCH/DELETE /:id
│   └── PATCH /:id/password
└── installations/:installationId
    ├── DELETE /?purge=true
    ├── GET/PATCH access
    ├── GET files
    ├── GET versions
    ├── GET versions/:versionNumber
    ├── POST forms/:formId/report/pdf/jobs
    └── POST report/pdf/jobs

/v1/export/jobs/
├── GET latest?entityId=...&artifactType=pdf
├── GET :jobId
└── GET :jobId/download
```

User-list/create/update/deactivate and installation access mutation require an
InstallHub admin. A user may read their own profile and change their own password
with the current password; an admin can reset another user's password. InstallHub
installation, file, version, report-source and import reads use creator,
assigned-inspector, or elevated access. Export status/download additionally
checks the job app and owner, with admin override.
Permanent installation purge is narrower: only the creator or an elevated
actor may delete a Cloud Backup, and an active InstallHub PDF job blocks it.

Every successful changed InstallHub `syncStage: "complete"` full-snapshot push
creates an immutable installation version. A `syncStage: "metadata"` staging
push is persisted for upload-session parent validation but is not versioned;
an absent stage is treated as legacy complete. `/files` combines confirmed
originals with completed InstallHub form/pack report artifacts; it does not
expose device-local paths.

The six current schema-v2 form families are WW Installation, Comms
Fault, ACE Switchboard, Honeywell Q400, Captis Logger, and SUMS Logger.
Schema-v1 A3RM/A6M records remain readable. WW Installation exposes three
channels for A3RM and six for A6M. Each visible channel requires a load; `Not
Used` requires an empty rating, while a real load requires an exact A3RM
Rogowski or A6M CT choice. These conditions are shared by API validation and
the server report manifest.

InstallHub PDF start routes accept only completed backed-up forms and return a
durable job ID. The renderer resolves exact confirmed attachment originals,
uses the Sustainability Wise A4 format, and chunks above 120 photos or 120 MiB
raw evidence at semantic section boundaries (about 50 photos per rendered part)
before merging. The mobile client polls the shared export-job routes and uses
the authenticated download rather than holding a request open.

## Shared Capabilities

Changes here have multi-product impact and need broader checks:

- `src/auth/`: JWT, refresh tokens, API keys, app and role guards.
- `src/db/schema/shared.ts`: refresh tokens, API keys, photo registry, copy
  references, record versions, and export jobs.
- `src/storage/`: original references, virtual copy references, thumbnails, and
  local/Spaces access.
- `src/services/` and `src/routes/pdfJobs.ts`: durable PDF/ZIP queue lifecycle.
- `apps/ecoaudit/src/components/`, `contexts/`, `hooks/`, and `lib/`: portal-wide
  UI, session, photo, navigation, and download behavior.

## Sources of Truth

Use this order when tracing a behavior:

1. Applied database migrations and current Drizzle schema.
2. Backend route and service implementation.
3. Portal API client normalization and domain types.
4. Current tests that state compatibility or business behavior.
5. `docs/ai/CONTRACTS.md` and focused runbooks.
6. Historical proposals and phase delivery documents.

Do not infer a field name from a screen label. Trace it through the API payload,
database mapping, photo registry, PDF builder, and mobile sync contract.

## Deployment Boundary

The API and portal are separate processes and release paths. A portal change can
pass locally while its API dependency is not deployed, and the reverse is also
true. Any cross-process contract change must be backward compatible during a
rolling deployment. See `docs/INFRASTRUCTURE.md` and
`docs/ECOSENSE_PORTAL_DEPLOYMENT.md` for operational details.
