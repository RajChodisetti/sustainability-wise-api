# Offline new-meter Comms Draft metadata

An existing cloud installation can receive a newly captured A3RM/A6M meter and
its linked Comms Fault Draft in the same metadata push. Previously,
`retainPendingCommsReplacementMeterState` required a server meter preimage for
every Draft with `works.replace_device = yes`, so this valid offline sequence
failed with `comms_replacement_meter_missing`. Creating an entirely new
installation did not enter that retention branch.

## Staging boundary

- A saved meter keeps the same existing operational retention behavior. Pending
  replacement model, serial, tag and channels cannot become operational during
  metadata staging. Independent notes, evidence and other metadata retain the
  existing behavior.
- A meter absent from the current canonical tree may be staged unchanged when
  it is present in the incoming tree, belongs to the same installation, and has
  the exact supported `WATTWATCHERS` + `A3RM`/`A6M` family/model pair.
- A supplied Comms board or zone must match that meter's incoming board. A
  nonblank `existing.device_type`, `existing.device_id`, or
  `existing.device_number` must match its incoming model, serial or tag after
  canonical whitespace normalization. Omitted and blank captures remain
  optional. No WW installation form is required to establish a manually
  captured supported meter.
- A retained form referencing the missing meter, or reuse of a previously saved
  form ID for the proposed first capture, rejects the exception. It cannot be
  used to resurrect a missing historical meter or retarget a saved Comms form.
- Staging never applies `works.new_*` answers and never authorizes a replacement
  transition. A completed replacement still needs the saved original preimage,
  exact supported replacement identity and sensor/channel transformation, and
  preserved mapping. Draft answers remain evidence of intended work.

This is an additive correction within the existing metadata stage. It adds no
endpoint, database field or migration. Authentication, app/installation access,
complete-tree normalization, stable child/channel IDs, transactional ownership
preflight, compare-and-swap revision checks and immutable version creation are
unchanged. In particular, a foreign persisted meter ID that appears new in this
installation still fails the existing child-ownership preflight before child
writes; the retention helper is not an ownership substitute.

## Compatibility and verification

The iOS durable metadata confirmation projection must use full equality with
the frozen incoming original meter for this no-preimage case. It must not
invent an old meter, trust a replacement answer as an operational state, or
relax later local-capture/actor fences. Previously rejected metadata attempts
need their own proven rejection handling; this correction does not clear
conflicts or retire client journals.

`meterHistory.test.ts` exercises production sync preparation, canonical
normalization, metadata retention and form validation for manual supported
capture, WW + Comms Draft capture, optional/trimmed original identity,
contradictory identity, unsupported family/model, missing/foreign/malformed
records, historical references, and invalid completed transitions. Existing
history tests retain completion, mapping and rollback coverage. PostgreSQL
ownership/history integration tests remain separately gated by the repository's
explicit test database binding; a skipped integration test is not live proof.

The additional release paths for this correction are `meterHistory.ts`,
`meterHistory.test.ts`, and this document. Existing unrelated API/portal changes
are outside this correction. No deployment or physical-device result is implied
by source validation.

Local verification on 2026-09-05:

- Focused canonical, sync, form-contract, meter-history and ownership suites:
  126 passed, 2 PostgreSQL integration cases skipped, 0 failed.
- Final `npm run test:api` after the metadata replay correction: 776 tests,
  748 passed, 28 skipped, 0 failed.
- `npm run api:typecheck`, `npm run ai:check`, and `git diff --check`: exit 0.
- A temporary copy of the same tests against the original helper failed all
  three positive first-capture cases with `comms_replacement_meter_missing`;
  the source regression is therefore directly reproduced. The temporary copy
  was outside the API repository and did not alter the working source.

The initial standard run skipped PostgreSQL-dependent checks. A subsequent
run using the existing disposable local PG17 binding passed all three real
metadata-replay, meter-history and ownership integration tests without skips.
The metadata replay test also proved the new supported-meter + Comms Draft
path through the API transaction and rejected invalid completed replacement.
The owned local cluster was stopped afterward. No live QA/production database,
external network endpoint, deployment or device operation was used.
