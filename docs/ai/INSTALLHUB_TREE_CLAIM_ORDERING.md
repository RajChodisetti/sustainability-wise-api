# Field App new-zone display-code persistence

The disposable PostgreSQL ownership regression exposed a pre-existing first-tree failure: `replaceCanonicalInstallationChildrenUnchecked` inserted zone-scoped display-code claims before inserting their zones. The immediate `ih_display_code_claims_zone_fk` constraint rejected a newly captured tree containing a zone and its boards, assets or meters. Migration 0021 marks this constraint `NOT VALID` for historical rows; it still enforces new writes.

The write order now persists grid supplies and zones before display-code claim updates/inserts, then their electrical entities. Display-code allocation still happens before persistence, and the existing installation transaction, child ownership checks, immutable ownership triggers, claim uniqueness and error handling remain unchanged. No schema changes are needed.

The existing PostgreSQL ownership test now reaches and passes the complete fresh-tree, cross-installation rejection, concurrent child-ID collision and board-rename checks. It also covers adding a second zone and board to an existing installation and replaying that update without duplicate claims or replacement of retained claim IDs. An older unreachable assertion now accepts the intentionally omitted optional `provisional` marker on a loaded tree, while still rejecting `true`.

Validation: 60 tests passed without skips across `canonical.test.ts`, `ownership.integration.test.ts`, `sync.integration.test.ts`, `syncLifecycle.integration.test.ts`, and `clientSiteCapture.integration.test.ts`. Final verification also uses PostgreSQL 17.2 with all tracked migrations unchanged; see `INSTALLHUB_OPTIONAL_CLIENT_CAPTURE.md`. No QA or production deployment was performed.
