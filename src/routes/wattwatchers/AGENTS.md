# Wattwatchers Fleet Backend Contract

Fleet routes are mounted at `/v1/wattwatchers` and require the `wattwatchers`
auth namespace.

## Access and Ingestion

- Viewer is read-only, service account is required for collector ingestion, and
  admin is required for user management.
- Ingestion is idempotent. Preserve source/run identifiers, client memberships,
  observation counts, and retry-safe upsert behavior.
- A collection run is publishable only when its expected client and observation
  cohorts are complete. Partial or claimed-success payloads must not publish.

## Reporting Semantics

- Connectivity, inactivity, unknown state, outage transitions, availability, and
  email delta cohorts have tested business definitions. Reuse logic in
  `ingestLogic.ts` and `userLogic.ts`; do not recalculate them differently in a
  route or portal component.
- Reports are historical snapshots. Keep report detail and CSV exports derived
  from the same archived cohorts and ordering.
- Portal counterparts live under `apps/ecoaudit/src/modules/fleet/` and
  `apps/ecoaudit/src/app/(portal)/fleet/`.

Any status or report change needs backend logic tests plus portal cohort tests.

