# Production Release Checklist

Copy this file for every production deployment and keep the completed copy with
the release evidence. Follow the canonical
[QA to Production Release Runbook](PRODUCTION_RELEASE_RUNBOOK.md); this
checklist is not a substitute for it.

Do not record passwords, tokens, raw environment values, signed URLs, cookies,
or customer data. Record resource names, approved fingerprints, checksums,
artifact IDs, and links to protected evidence.

## Release record

- Change/ticket:
- Release description:
- Release date/window:
- Operator:
- Reviewer:
- QA approver:
- Full release SHA:
- Short release SHA:
- QA URL:
- QA release path:
- Production release path:
- Previous API path/SHA:
- Previous portal path/SHA:
- Observation owner:
- Rollback owner:

## 1. Classify the release

Check every class that applies. Unchecked classes must not change in
production.

- [ ] API code
- [ ] Portal code
- [ ] Shared API/portal contract
- [ ] Additive schema migration
- [ ] Data migration or backfill
- [ ] Storage provider, mode, bucket, root, or IAM
- [ ] OneDrive Graph photo/PDF mirror
- [ ] Database/upload backup
- [ ] Authentication, registration, bootstrap, or public-file policy
- [ ] Caddy, DNS, port, or public origin
- [ ] Installed mobile compatibility
- [ ] No infrastructure or secret changes

Migration files, or `none`:

Mobile source/client impact, or `none`:

## 2. Hard-stop gate

Every item must be checked before the production window. Stop if any item
cannot be proved.

- [ ] The release is a clean full commit on `main`.
- [ ] `origin/main` equals the full release SHA.
- [ ] CI `Verify` passed on that exact SHA.
- [ ] Local `npm run verify` passed on that exact SHA.
- [ ] QA was rebuilt from and is running that exact SHA.
- [ ] QA acceptance is signed and linked below.
- [ ] The diff and every selected release class were reviewed.
- [ ] Production target preflight passed with no failure.
- [ ] No QA environment, data, files, credentials, URLs, or ports will move.
- [ ] Current API and portal paths and SHAs are recorded above.
- [ ] A tested rollback path and named rollback owner exist.
- [ ] Required database and storage recovery points are verified.
- [ ] Queued/running PDF and ZIP jobs are zero, or impact is approved.
- [ ] Temporary exceptions are documented with owner and expiry.

CI evidence:

Local verification evidence:

QA acceptance evidence:

## 3. QA acceptance

- [ ] Login, authorization, and wrong-app denial passed.
- [ ] Affected create/read/update/complete/reopen flows passed.
- [ ] Original photo and thumbnail retrieval passed.
- [ ] Upload session, upload confirmation, and intended storage destination
      passed.
- [ ] PDF and photo ZIP generation/download passed.
- [ ] Both EcoAudit PDF modes were tested when report behavior changed.
- [ ] Zone ordering, totals, numbering, and zone/equipment photo ownership
      passed when report behavior changed.
- [ ] A real compressed-photo fixture was used for photo/report changes.
- [ ] Migration rerun/idempotency passed when a migration exists.
- [ ] Supported installed clients remain compatible.

QA audit/record IDs:

QA PDF/ZIP checksums:

QA result and approver:

## 4. Production target binding

Use labels and SHA-256 fingerprints only. Compare them with the protected
production target manifest.

- Public origin:
- API loopback host/port:
- Portal loopback port:
- Portal internal API origin:
- Database host/port/name/user:
- Database identity fingerprint:
- Storage write mode:
- Legacy provider/region/bucket or root:
- EcoAudit provider/region/bucket or root:
- SolarSense provider/region/bucket or root:
- InstallHub provider/region/bucket or root:
- Storage credential fingerprints verified:
- OneDrive mirror enabled:
- OneDrive failure policy (`required` or `best effort`):
- OneDrive tenant/client/user/folder identity fingerprint:
- Database/upload backup remote identity:
- Caddy hostname and upstreams:

Run from the exact candidate release:

```bash
npm run release:preflight -- \
  --env-file /opt/ecosense-portal/.env \
  --target-file /opt/sw-config/release-targets/production.json \
  --release-dir "/opt/sw-releases/${RELEASE_SHORT}" \
  --expected-sha "$RELEASE_SHA"
```

- [ ] Environment file owner and mode are approved.
- [ ] Environment file is outside the immutable release.
- [ ] Release tree is clean, detached, and exactly matches `RELEASE_SHA`.
- [ ] API, portal, database, storage, OneDrive, and security identities match.
- [ ] Portal build target is `http://127.0.0.1:3000`.
- [ ] No QA marker or dangerous unapproved compatibility flag is present.
- [ ] Redacted preflight manifest is attached.

Preflight manifest checksum/evidence:

## 5. Recovery points and job drain

- [ ] Current API and portal paths were confirmed directly from PM2.
- [ ] Previous immutable releases remain present and readable.
- [ ] Queued/running export query returned zero rows.
- [ ] Managed PostgreSQL backup/PITR status was checked.
- [ ] Pre-release database dump exists when required.
- [ ] Dump SHA-256 and `pg_restore --list` passed.
- [ ] Database restore was tested in an isolated target.
- [ ] Active storage counts/bytes were recorded per destination.
- [ ] Storage snapshot/versioning/checksum copy was verified.
- [ ] Database and storage recovery points have an acceptable matching RPO.
- [ ] Caddy config was backed up if routing is in scope.

Database backup/snapshot ID, checksum, and restore evidence:

Storage recovery IDs/counts/checksums:

Export-job query result:

## 6. Connectivity checks

- [ ] Read-only PostgreSQL identity query returned the approved production
      database, user, server, port, and SSL policy.
- [ ] Each active storage destination passed direct PUT/HEAD/GET/checksum/DELETE.
- [ ] Per-app credentials were denied access to other app buckets.
- [ ] Every active storage bucket is private.
- [ ] OneDrive upload/download/checksum/cleanup passed when enabled.
- [ ] Integrated photo/PDF OneDrive mirror passed when enabled.
- [ ] The separate database/upload backup remote was checked.
- [ ] Chromium executable exists and a real report rendered.

Connectivity evidence:

## 7. Migration gate

- [ ] Schema diff was inspected from production SHA to release SHA.
- [ ] This release is schema-neutral; startup must report no pending migration.
- [ ] Or: every new migration was reviewed and tested on a restored production
      snapshot.
- [ ] New migrations are append-only and backward compatible with prior code.
- [ ] Lock/runtime impact and single-runner controls are approved.
- [ ] Migration output and journal state will be captured.

Migration plan, result, and journal evidence:

## 8. Build and switch

- [ ] A new immutable `/opt/sw-releases/<shortsha>` directory was created.
- [ ] The release is detached at the full approved SHA and has a clean tree.
- [ ] API/legacy web dependencies and build completed from lockfiles.
- [ ] Portal dependencies and production build completed from lockfiles.
- [ ] Protected production environment was linked, not copied or modified.
- [ ] Build logs and artifact identity were recorded.
- [ ] API was switched first and loopback/API/log checks passed.
- [ ] Portal was switched to the same SHA and loopback/log checks passed.
- [ ] PM2 reports both exact new working directories.
- [ ] Caddy was not changed, or its separate validated change was completed.
- [ ] `pm2 save` was not run as part of the routine switch.

Switch start/end time:

API/portal process evidence:

## 9. Production smoke

- [ ] Public `/health` and `/login` passed.
- [ ] Authenticated read passed for every affected app.
- [ ] Unauthenticated and wrong-app access were denied.
- [ ] Disposable smoke record lifecycle passed.
- [ ] Upload and confirmation wrote to the intended primary destination.
- [ ] Authenticated original and thumbnail loaded.
- [ ] Unauthenticated original and thumbnail were rejected.
- [ ] Registry owner/entity/field identity was correct.
- [ ] PDF and photo ZIP completed and downloaded.
- [ ] Zone ordering and zone/equipment photo ownership were correct in both
      report modes when EcoAudit reports are affected.
- [ ] OneDrive mirror appeared in the approved folder when enabled.
- [ ] Shared portal login and Field App handoff passed when shared code changed.
- [ ] API, portal, Caddy, migration, storage, Graph, and backup logs were clean.
- [ ] Smoke evidence was captured before disposable data cleanup.

Production smoke record/artifact IDs and checksums:

## 10. Observe and decide

- [ ] At least 30 minutes of active observation completed.
- [ ] HTTP 5xx and unexpected 401/403/404 rates are normal.
- [ ] PM2 restarts, CPU, memory, disk, and uptime are normal.
- [ ] PostgreSQL errors, locks, connections, and latency are normal.
- [ ] Export queues and failures are normal.
- [ ] Storage, missing-original, thumbnail, Graph, backup, Chromium, and Caddy
      logs are normal.
- [ ] A 24-hour follow-up owner and time are recorded.
- [ ] Previous releases and recovery points will be retained through the
      observation period.

Observation evidence:

Decision:

- [ ] Successful
- [ ] Rolled back
- [ ] Follow-up required

## 11. Rollback record

Complete this section only if rollback occurs.

- [ ] Writers were stopped if data/schema compatibility required it.
- [ ] Portal was switched to its recorded prior immutable path.
- [ ] API was switched to its recorded prior immutable path.
- [ ] No applied migration was edited or deleted.
- [ ] Database/storage restore used explicitly matched recovery points, if
      required.
- [ ] Full public smoke passed after rollback.
- [ ] Failed artifact, logs, and evidence were preserved.

Rollback reason, times, operator, target SHAs, and result:

## 12. Approved temporary exceptions

Every exception needs a reviewer, compensating control, and expiry. An expired
exception blocks the next release.

| Setting/control | Reason | Compensating control | Owner/reviewer | Expiry |
|---|---|---|---|---|
| `none` |  |  |  |  |

## Closeout

- Final outcome:
- Release end time:
- Operator signature:
- Reviewer signature:
- 24-hour follow-up result:
- Incident/follow-up tickets:
