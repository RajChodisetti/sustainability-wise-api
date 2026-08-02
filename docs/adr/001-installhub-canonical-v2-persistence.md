# ADR 001: InstallHub canonical-v2 persistence and legacy fence

- Status: Accepted
- Date: 2026-08-01
- Owners: Field App Complete / InstallHub API

## Context

Schema-v1 stores electrical sources as nullable board IDs plus booleans, meters
inside board JSON arrays, and site metering as descriptive channel labels. Those
representations cannot establish stable meter/channel identity, installation
ownership, one authoritative Grid boundary, or immutable completed exports.
They must remain readable during a staged rollout without becoming a second
write authority after an installation is promoted.

## Decision

Canonical-v2 is the sole authority for promoted installations. It uses
normalized Grid supplies, meter devices, channels, measurement assignments,
assignment-channel links, retained display-code claims, and immutable record
version snapshots. Every relationship is installation-scoped. Completed forms
are immutable; commissioning identity changes require a completed amendment.

Electrical graph node IDs are unique across Grid, Board, and SiteAsset nodes,
and the deterministic `virtual_` ID namespace is reserved for virtual residuals.
This keeps the existing untyped node IDs and edge endpoints in read/export
contracts unambiguous.

`ih_installations.external_key` is generated once, unique, non-empty, and
database-immutable. Copies receive a new external key. `id` remains the internal
row identity; `external_key` is the durable integration identity.

Migrations 0015 through 0017 are additive from applied migration 0014.
Migration 0015 introduces canonical-v2 persistence without recreating existing
tables; 0016 adds the durable storage-deletion outbox used after transactional
purge; and 0017 makes every canonical child/link ownership column
database-immutable. Existing-row ownership/check constraints start as `NOT
VALID`: new writes are fenced immediately, while legacy exceptions can be
reported and corrected before validation.

The backfill is dry-run by default and requires `--apply` to mutate data. It is
idempotent and uses deterministic Grid/claim identities. A legacy null parent
with `parentTbc=false` is never interpreted as Grid; it becomes explicit TBC and
is reported. Embedded meters migrate only when meter IDs, channel IDs, channel
ordinals, model, and serial identity are unambiguous. Descriptive site channel
labels are never guessed into assignments. IDs, source timestamps, soft-delete
state, and confirmed/pending photo identity are preserved.

An installation is promoted by setting `tree_schema_version=2` only when no
blocking backfill exception remains. After promotion, schema-v1 writes receive
`upgrade_required`; schema-v1 remains a deterministic read projection only.

Completion atomically increments the tree revision and record version, records
server completion time/actor, and stores the normalized tree, exact referenced
confirmed media manifest, readiness result, controlled label catalog, formula
versions, and rendered read/export artifacts under one payload hash. Historical
version routes return these pinned artifacts and never run current
canonicalizer, taxonomy, label, readiness, or virtual-meter code.

## Deployment and rollback

Deploy in this order:

1. Apply migrations 0015, 0016, and 0017, in order, while canonical-v2 remains disabled in production.
2. Deploy the rollback-safe API; schema-v1 traffic continues to use old fields.
3. Run the backfill without `--apply`, review deterministic counts/exceptions,
   then run with `--apply`. Re-run and verify zero new planned writes.
4. Validate `NOT VALID` constraints only after blocking exceptions are zero.
5. Enable `INSTALLHUB_CANONICAL_V2_ENABLED=true`, then deploy v2 clients.

Rollback before step 5 is an API/flag rollback; additive tables/columns stay in
place. After promotion, rollback must not re-enable schema-v1 writes for a v2
installation. Disable the feature flag, retain canonical data and snapshots,
and deploy a forward repair.

## Consequences

The model has one canonical write path and deterministic historical exports.
Legacy ambiguity becomes visible work instead of fabricated topology. The
tradeoff is an explicit reconciliation phase before every legacy installation
can complete under v2.
