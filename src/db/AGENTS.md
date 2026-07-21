# Database Change Rules

Applies to `src/db/schema/`, `src/db/migrations/`, and migration startup code.

## Schema Ownership

- `ecoaudit.ts` owns `ea_*` tables, `solarsense.ts` owns `ss_*`,
  `wattwatchers.ts` owns `ww_*`, and `shared.ts` owns intentionally shared
  infrastructure only.
- Keep Drizzle schema and the migration that introduces it in the same change.
- Use the existing UUID, timestamp, JSONB, index, and foreign-key conventions.
  Do not move a product field into `shared.ts` merely to reuse a type.

## Migrations

- Add the next numbered SQL migration and journal entry through the established
  Drizzle workflow. Never edit or renumber an applied migration.
- Field unification must migrate all representations, including nested JSON,
  registry fields, copy references, status/job metadata, and derived lookup rows.
- When both legacy and canonical values exist, keep the canonical non-empty value
  and fill only missing data from legacy storage.
- Make destructive changes only after an expand/migrate/contract rollout proves
  no deployed client reads the old representation.
- Evaluate locks, table size, and rerun behavior before production. A migration
  that rewrites many rows needs an explicit operational note.

## Verification

Inspect generated SQL before applying it. Test null, legacy-only, canonical-only,
both-present, and repeated-run cases where relevant. Run API typecheck/tests and
the consumers for every changed field.

