# SolarSense Backend Contract

SolarSense routes are mounted at `/v1/solarsense` and require the `solarsense`
auth namespace. Inspector access remains owner-scoped unless an existing admin
path explicitly broadens it.

## Domain Shape

- Parent flow: site -> rooftop assessments.
- Assessments contain nested switchboards and photo arrays; sites may contain
  image appendix items. Preserve nested ordering and stable identifiers.
- A site's report pack combines site, assessment, appendix, and photo data. A
  field change must be traced through CRUD, sync, photos, PDF, and portal types.
- Draft/completed lifecycle and photo upload eligibility are mobile sync
  contracts. Keep upserts idempotent and reject invalid parent ownership.

## Frontend Counterparts

The portal implementation is under `apps/ecoaudit/src/modules/solar/` with route
entries under `apps/ecoaudit/src/app/(portal)/solar/`. SolarSense has its own API
client, auth context, token keys, domain types, normalization, and report config.
Do not route it through the EcoAudit client merely because both share a portal.

## Photos and Exports

Use shared storage/reference services and the durable export job queue. Preserve
direct mobile-compatible endpoints while portal PDF and ZIP actions use generic
job polling/download behavior. Test nested photo fields and appendix image paths
when changing extraction or report behavior.

Run API and SolarSense portal checks for contract changes.

