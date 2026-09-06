# Field App saved-site retarget revisions

A serial reproduction using a new UUID client and two new sites/jobs failed when installation A changed from site A to occupied site B. The existing `business_jobs` row kept revision 1 from its original site, violating `business_jobs_site_app_revision_unique` at the destination. This did not depend on concurrent requests or reused fixtures.

Existing jobs now allocate a destination-site revision only when their site changes. The business-job ID, source identity and historical `previousJobId` remain unchanged. Retaining the predecessor avoids rewriting history or creating a predecessor cycle when a job returns to a site containing its prior successor. Ordinary updates at the same site keep the current revision. New job creation continues to allocate the target site's next revision and predecessor.

The shared writer locks the destination business-site row before reading its revision tail, coordinating with the row lock already used by Scheduler creation. It runs inside the existing product transaction; no shared validation, ownership checks, Completed/history fences, schema or indexes change.

The PostgreSQL regression uses real Field API injection to create three independent records, move an installation to an occupied site, update it at that site, return it to its original site with an existing successor, and reject an attempted move after completion. It verifies retained job/source IDs and predecessor links, destination revision allocation, no duplicate source jobs, and complete transaction rollback for protected history. The fixture uses an isolated unique client and source IDs in the explicitly disposable test database.

Validation: the final PostgreSQL 17.2 run passed all 95 Field App integration and related contract tests without skips, using all tracked migrations unchanged. The explicitly enabled legacy upload compatibility test passed separately. Full repository verification is recorded in the local validation handoff. No QA or production deployment was performed.
