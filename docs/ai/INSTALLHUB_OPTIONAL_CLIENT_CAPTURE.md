# Field App optional client and address capture

A portal-created installation with blank optional client/address fields previously passed canonical normalization but failed inside reusable client-directory learning with `address.displayAddress is required`. The capture transaction rolled back, so the UI could not create the installation.

The `/v1/installhub/sync/push` boundary now persists optional Field capture independently of directory learning. A client name, site name, and display address are all needed before learning a reusable client/site. Incomplete capture skips the shared directory upsert and clears the installation `businessSiteId` pointer plus returned `clientId`/`clientSiteId`; this prevents a subsequent pull from restoring a cleared directory relationship. The shared directory, site and job-history records are retained.

The success contract remains an object: `clientMemory: { client: null, site: null }`, with top-level `clientId: null` and `clientSiteId: null` when learning is unavailable. Fully populated capture retains existing directory matching/reuse and selected-site behavior. Legacy sync accepts blank optional client/address values and defaults an unnamed site to `Untitled installation`, while supplied nonstring values and required transport identity remain invalid. No shared service validation or schema/migration changes are needed.

Both canonical mutation and pointer detachment remain inside the existing locked transaction. Ownership checks and stale revision rejection are unchanged; failed writes roll back the pointer change.

## Verification

`src/routes/installhub/clientSiteCapture.integration.test.ts` exercises real HTTP injection and PostgreSQL persistence: minimal canonical creation/pull, metadata replay, immutable complete snapshot, populated directory reuse, ownership denial, stale clear rollback, successful clearing/pull/replay, legacy blank creation/pull, and unchanged shared-directory strictness. `src/routes/installhub/sync.test.ts` adds isolated optional-learning and legacy typed-input regression cases.

These tests use a disposable local database. Final verification uses PostgreSQL 17.2 with all tracked migrations applied unchanged. An earlier PostgreSQL 14 diagnostic run needed a temporary migration-copy adjustment for the pre-existing `2_000` literal in migration 0053; it is superseded by the PostgreSQL 17 run. No tracked migration, QA or production API/database was changed, and no deployment was performed.

The new optional-capture route regression passed together with the broader Field App integration suite. Two additional defects found by those real-database checks are fixed separately: new-zone display-claim persistence ordering (`INSTALLHUB_TREE_CLAIM_ORDERING.md`) and moving an existing job to an occupied saved site (`INSTALLHUB_SITE_RETARGET_REVISIONS.md`).
