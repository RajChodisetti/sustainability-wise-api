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

Migrations 0015 through 0019 are additive from applied migration 0014.
Migration 0015 introduces canonical-v2 persistence without recreating existing
tables; 0016 adds the durable storage-deletion outbox used after transactional
purge; and 0017 makes every canonical child/link ownership column
database-immutable. Existing-row ownership/check constraints start as `NOT
VALID`: new writes are fenced immediately, while legacy exceptions can be
reported and corrected before validation. Migrations 0018 and 0019 add nullable
`photo_registry.confirmed_tree_revision` and `photo_registry.base_tree_revision`
columns. They bind each photo confirmation to the exact accepted installation
revision and each upload session to its compare-and-swap base without rewriting
legacy rows.

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

New snapshots use canonicalizer `installation-canonical-v2.2`. Optional
`baseTreeRevision` transport metadata is removed before hashing so an exact
payload has the same hash before and after JSON persistence. A bounded verifier
recognizes only the known v2.1 missing-key/`undefined` hashing defect for
historical snapshots. It compares normalized content and never mutates or
re-signs an immutable v2.1 snapshot.

Upload confirmation uses the session's stored base revision as a server-side
CAS fence. Exact confirmation replays return the originally confirmed revision;
an upload whose installation changed is rejected instead of overwriting a
portal or mobile edit. During the API-first rollout,
`INSTALLHUB_UPLOAD_REVISION_CAS_REQUIRED=false` accepts missing-base requests
from installed legacy clients, pins new sessions to the current revision, and
emits deprecation telemetry. QA/test are strict by default; production is
compatibility-first by default until the client-adoption gate is deliberately
closed.

Canonical site codes are uppercase alphanumeric groups separated by single
hyphens, with a total length of 1–16 characters. Existing data must be inventoried
before strict rollout. This release grandfathers every exact non-empty
authoritative value: reads, omitted writes, exact echoes, completion, snapshots,
and replay preserve it byte-for-byte. Fresh values and deliberate changes must
meet the current contract. No database check or bulk rewrite is applied because
migration 0015 legitimately derived codes longer than 16 characters and
display-code identity depends on them. Only the prefix for a newly generated
board, asset, or meter code is projected through the same bounded normalization
in API, portal, and iOS; retained display-code claims never change.

## Deployment and rollback

Deploy in this order:

1. Take and verify database and media backups, then inventory site-code values
   against the canonical 1–16 character contract.
2. Apply migrations 0015 through 0019, in order, while canonical-v2 remains
   disabled in production.
3. Deploy the rollback-safe API with
   `INSTALLHUB_UPLOAD_REVISION_CAS_REQUIRED=false`; schema-v1 traffic and
   installed legacy upload clients remain additive during this compatibility
   window.
4. Run the backfill without `--apply`, review deterministic counts/exceptions,
   then run with `--apply`. Re-run and verify zero new planned writes.
5. Validate `NOT VALID` constraints only after blocking exceptions are zero.
6. Enable `INSTALLHUB_CANONICAL_V2_ENABLED=true` for a controlled cohort and
   release the final portal/iOS clients.
7. After adoption telemetry meets the approved threshold and a minimum iOS
   version or forced-upgrade gate is active, flip
   `INSTALLHUB_UPLOAD_REVISION_CAS_REQUIRED=true` under a dated change ticket.
   Run strict create, photo-confirmation, exact-replay, conflict, completion,
   reopen, and export smoke scenarios before expansion.

Rollback before canonical promotion is an API/flag rollback; additive
tables/columns stay in place. The safe code floor after migrations 0018/0019 is
an API version that tolerates both nullable columns. After promotion, rollback
must not re-enable schema-v1 writes for a v2 installation. Disable the feature
flag, retain canonical data and snapshots, and deploy a forward repair. If the
strict upload gate must be reopened, return only to the explicit compatibility
mode while preserving stored base/confirmed revisions and telemetry.

## Consequences

The model has one canonical write path and deterministic historical exports.
Legacy ambiguity becomes visible work instead of fabricated topology. The
tradeoff is an explicit reconciliation phase before every legacy installation
can complete under v2.
