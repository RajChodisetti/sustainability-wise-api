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

### Wattwatchers Fleet

Collectors ingest device observations and client-scoped collection results.
Portal viewers inspect health, devices, outages, runs, reports, and CSV exports.
Ingestion is idempotent and requires a service account; administration requires
the Fleet namespace and admin role.

## Runtime Map

```text
EcoAudit mobile ---------\
SolarSense mobile --------> Fastify API -> PostgreSQL
EcoSense web portal ------/       |       -> local or Spaces object storage
Collector service ---------------/       -> Chromium PDF renderer

Fastify API:       src/                         PM2: sw-api
Next.js portal:    apps/ecoaudit/               PM2: ecosense-portal
Legacy Vite UI:    web/                         served by Fastify when built
```

The mobile applications are sibling repositories:

- `../ecoaudit-pro/mobile/`
- `../solarsense-mobile/`

They are not modified as part of an API or portal-only task. Their installed
versions still constrain compatibility in this repository.

## Namespace and Ownership Model

| Product | API prefix | Auth app | Primary tables | Portal source |
|---|---|---|---|---|
| EcoAudit | `/v1/ecoaudit` | `ecoaudit` | `ea_*` | `src/app/(portal)/ecoaudit`, `src/api` |
| SolarSense | `/v1/solarsense` | `solarsense` | `ss_*` | `src/app/(portal)/solar`, `src/modules/solar` |
| Fleet | `/v1/wattwatchers` | `wattwatchers` | `ww_*` | `src/app/(portal)/fleet`, `src/modules/fleet` |

JWTs and API keys carry an `app` claim. That claim is a security boundary, not a
UI preference. Inspector reads and writes are ownership-scoped unless an
existing route explicitly grants elevated access. Copy and sync flows must not
allow clients to spoof creator or parent ownership.

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

