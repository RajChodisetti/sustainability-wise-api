# Metadata replay after display-code allocation

The initial metadata push can replace an offline provisional display code with
a retained server claim. Previously, an exact retry compared the original
provisional `displayCode`/`displayName` before resolving that claim. The generated
value, rule version, and provisional marker all participate in the canonical
mutation fingerprint, so the accepted body's retry could reach the stale-base
check and return `409 snapshot_conflict` without any concurrent edit.

The 2026-09-05 native QA evidence recorded base revision 11, an accepted revision
12/version 9, and an exact replay conflict six seconds later. A local probe of
the frozen payload verified its SHA-256 and the running QA commit's canonical
source. Removing only the provisional marker, or changing only rule 2 to rule 4,
was independently sufficient to change the fingerprint. Actual retained claim
rows were not queried by that diagnostic.

The subsequent candidate review found two additional supported inputs: the
portal's `displayCodeMetadata` compatibility serializer emits rule 1 without a
provisional marker, and native board/site-asset editing preserves custom codes
with rule 1 and an optional provisional marker. Allocation changes the rule and
marker for these accepted bodies too. Both exact replay failures were reproduced
through production helpers; the PostgreSQL route regression covers both paths.

That regression also exposed an unrelated-save drift: a new custom claim kept
its supplied `generatedValue`, but allocation on a later save replaced it with
the custom claim value. Retained non-generated claims now preserve this captured
metadata consistently with first acceptance. Generated claims retain their
existing allocation behavior. Replay comparison does not hide a submitted
custom `generatedValue` change.

## Comparison contract

Only metadata no-op comparison uses `resolveMetadataReplayDisplayCodes`. It runs
after completed-form and pending-Comms retention, inside the existing
installation row lock. It creates a comparison copy and requires exactly one
installation-scoped, entity-typed retained claim matching the current live
canonical value and rule version.

- Generated displays require a generated claim and matching current generated
  value. They may carry an explicit provisional marker, or a known incoming
  rule 1–3 without a marker against a verified rule 1–4 retained claim. The
  latter also supports immutable pre-v4 claims, regardless of relative version.
  Only then
  does the projection copy the claimed value, generated value and rule version
  and remove the marker. Current-rule non-provisional value changes stay strict.
- Custom displays require a non-generated claim, a currently overridden display,
  and the exact same custom value. Only the rule and provisional marker are
  normalized; the supplied value, generated value and reason stay in the full
  fingerprint.

The comparison preserves override flags/reasons, other display metadata,
business names/types, zone and board placement, every child, channel/capability,
answer and assignment. Missing, foreign, ambiguous, wrong-kind or mismatching
claims do not authorize normalization. It never calls the allocator or writes
a claim/counter.

When the full projected fingerprint equals the current tree, the response
returns the current revision/version and resolved display reconciliations.
Metadata creates no immutable version. If anything else differs, the original
write and compare-and-swap path remains authoritative. Complete/legacy stages
retain their existing comparison behavior.

## Verification boundaries

`canonical.test.ts` covers pure projection, input/claim immutability, business and
child differences, accepted overrides, marker-free legacy generation, custom
metadata differences, retained override allocation stability, unknown display
metadata, and missing/foreign/ambiguous/type-confused claims. `metadataReplay.integration.test.ts`
exercises the real API and PostgreSQL transaction with a retained Completed
Captis form and newly captured meter/asset/assignment. It requires exact replay
to leave the entire stored tree, claims, record versions and meter history
unchanged, and requires 27 stale edits to return `snapshot_conflict`. Its
sequential custom-then-legacy capture proves a later unrelated save preserves the
custom generated value. Synthetic old claims at each rule 1–3 are exercised with
accepted writes and exact retries, including a supplied rule newer than an old
claim. Current-rule display edits and business changes still reject stale bases.
It also checks new supported-meter + Comms Draft staging
and rejected invalid replacement completion.

Local PostgreSQL execution uses only the previously created disposable PG17
cluster and synthetic rows. No migration, dependency, environment-file,
deployment, live QA, production or device change is part of this correction.

Final v3 local checks on 2026-09-05, after the old-claim predicate adjustment:
the full API suite passed with 752 passed, 28 explicitly skipped and 0 failed
(780 total). The selected real PostgreSQL metadata-replay, meter-history and
ownership integration tests passed 3/3 with no skips; the owned disposable
cluster was stopped afterward. API typecheck, AI context validation and diff
whitespace checks passed. The v2 helper failed the two new accepted-replay
positive tests, and the pre-correction allocator failed the repeated-override
capture-preservation regression.
