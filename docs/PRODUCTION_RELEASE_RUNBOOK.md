# QA to Production Release Runbook

This is the canonical release policy for Sustainability Wise. It applies to the
unified Fastify API, EcoSense portal, database migrations, file storage,
OneDrive integration, and Caddy routing.

Use the shorter
[Production Release Checklist](PRODUCTION_RELEASE_CHECKLIST.md) as the release
record for each deployment. This document explains why every checklist item
exists and what evidence is required.

## The promotion model

Promotion moves an immutable code commit. It never moves the QA environment.

```text
feature branch
    |
    v
verified commit on main
    |
    +--> immutable QA release + QA environment --> QA acceptance
    |
    +--> same immutable commit + production environment --> production
```

The following items must **not** move from QA to production:

- QA database contents, dummy records, users, or password hashes;
- QA uploads, copied test photos, generated reports, or storage folders;
- QA `.env` files, JWT secrets, database credentials, Spaces/S3 keys, or Azure
  credentials;
- QA ports, URLs, Caddy routes, OneDrive folders, or backup destinations.

Production retains its existing protected environment, customer data, secrets,
database, primary storage, and backup destinations. Only append-only migration
code is applied to the production database.

## Approved environment boundaries

These values are resource identities, not credentials. The protected production
target manifest remains authoritative if infrastructure changes.

| Binding | Isolated EcoAudit QA | Production |
|---|---|---|
| Public origin | `https://ecoaudit-qa.170.64.154.143.sslip.io` | `https://api.sustainabilitywise.com.au` |
| API loopback | `127.0.0.1:3300` | `127.0.0.1:3000` |
| Portal loopback | `127.0.0.1:3220` | `127.0.0.1:3210` |
| Database | QA-only PostgreSQL, database `sw_ecoaudit_fixes` | approved production PostgreSQL, database `sustainability_wise` |
| Primary storage | QA-only local root under `/var/lib/sustainability-wise-api-lanes/` | approved production local/Spaces destinations |
| OneDrive photo/PDF mirror | disabled | production policy and production Graph identity only |
| Release roots | `/opt/sw-lanes/ecoaudit-fixes/releases/` | `/opt/sw-releases/` |

The production target file should be created from
`deploy/production-target.example.json`, stored outside the repository at
`/opt/sw-config/release-targets/production.json`, owned by the service account
or root, and mode `0600`. It contains approved non-secret identities and
SHA-256 fingerprints—not secret values.

Create it once as an infrastructure change, have a second person review every
resource identity, and update it only through a separately approved change:

```bash
sudo install -d -o swapi -g swapi -m 0700 /opt/sw-config/release-targets
sudo install -o swapi -g swapi -m 0600 \
  deploy/production-target.example.json \
  /opt/sw-config/release-targets/production.json
sudoedit /opt/sw-config/release-targets/production.json
```

Generate each secret fingerprint in a private terminal without printing or
storing the raw value:

```bash
read -rsp 'Secret value: ' release_secret
printf '\nsha256:%s\n' \
  "$(printf %s "$release_secret" | sha256sum | awk '{print $1}')"
unset release_secret
```

The example intentionally contains rejected placeholders. The preflight will
not pass until they have all been replaced with reviewed production identities
and fingerprints. Keep a protected checksum and review record for every target
manifest revision.

## Non-negotiable release rules

1. Production receives only a full commit on `main` that passed CI and
   `npm run verify`.
2. QA must run and accept the exact full commit SHA that production will run.
3. API and portal artifacts are built from that same SHA in a new immutable
   `/opt/sw-releases/<shortsha>` directory.
4. Never deploy a dirty tree, a mutable checkout, a branch-only commit, or files
   copied out of a running QA release.
5. Never copy an environment file between QA and production.
6. Do not rotate JWT, refresh, upload-capability, file-capability, database,
   Spaces, or Azure secrets as an incidental part of a code release.
7. Do not run production migrations until the exact database identity is
   checked and a verified recovery point exists.
8. Database migrations are append-only. Never edit, delete, or renumber an
   applied migration.
9. A normal release does not change Caddy, DNS, storage mode, buckets, OneDrive
   policy, or backup configuration. Each requires an explicitly classified
   infrastructure change.
10. Drain queued/running PDF and ZIP jobs before restarting the API. A restart
    marks those jobs failed.
11. `/health` proves that the process is listening only. It does not prove the
    database, storage, OneDrive, Chromium, auth, or background exports work.
12. Keep the previous API and portal release directories until the observation
    window closes.
13. Production data writes during smoke tests use dedicated disposable smoke
    records. Never reopen, delete, or purge a customer record for testing.
14. Every production release has a named operator and reviewer. Migration,
    data, storage, authentication, and environment changes require two-person
    review.

## Stop-the-release conditions

Stop before production if any of these is true:

- the worktree is dirty, the commit is not on `main`, CI is not green, or QA is
  running a different SHA;
- the production target preflight reports a QA URL, QA database, QA storage
  root, unexpected bucket, unexpected OneDrive identity, missing secret, or
  changed secret fingerprint;
- the previous release paths or rollback owner are unknown;
- a database or storage recovery point cannot be verified;
- the migration was not tested against a restored production snapshot, is not
  backward compatible, or its lock/runtime impact is unknown;
- queued or running export jobs remain without an explicitly accepted impact;
- the portal was built without the approved production `INTERNAL_API_URL`;
- a primary-storage, OneDrive, original-file, thumbnail, PDF, ZIP, login, or
  authorization smoke test fails;
- logs show new migration, database, storage, Graph, Chromium, queue, or HTTP
  5xx errors;
- rollback would require guessing, partially restoring data, or running an old
  release against an incompatible schema.

An urgent hotfix can shorten the observation period, but it cannot bypass
release identity, target identity, recovery point, or rollback checks.

## 1. Classify the release

Record every applicable class before building:

- API code;
- portal code;
- shared API/portal contract;
- additive schema migration;
- data migration or backfill;
- storage provider, write mode, bucket, root, or IAM change;
- OneDrive Graph mirror change;
- database/upload backup change;
- auth secret, registration, bootstrap, or public-file policy change;
- Caddy, DNS, port, or public-origin change;
- installed mobile compatibility change.

If a class is not selected, its production configuration must remain unchanged.

API/portal rolling changes must remain compatible with the currently installed
mobile clients and with the old portal/API during the switch. Use an
expand/migrate/contract sequence for changes that cannot be backward compatible
in one release.

## 2. Create the release candidate

On the integrated local `main` branch:

```bash
git switch main
git pull --ff-only origin main
git status --porcelain
git rev-parse HEAD
npm ci
npm --prefix apps/ecoaudit ci
npm run verify
```

Required evidence:

- `git status --porcelain` is empty;
- the full `RELEASE_SHA` equals `origin/main`;
- the GitHub `Verify` workflow is green on that exact SHA;
- the production SHA is an ancestor of the release SHA;
- the diff contains only reviewed changes;
- mobile source changes are recorded explicitly, including `none`.

Identify schema changes before deciding whether this is a migration release:

```bash
git diff --name-status "$PROD_SHA..$RELEASE_SHA" -- \
  src/db/schema src/db/migrations
```

No output means no database migration is expected. Any output changes the
release plan and triggers the migration gate below.

## 3. Deploy the exact commit to QA

Build QA from the integrated `main` SHA. Do not treat a feature-branch build
with extra uncommitted files as release acceptance.

QA must use only its own protected environment and resources. Run:

- the complete automated gate;
- affected API success/auth/wrong-app/ownership cases;
- portal loading, mutation, refresh, and error paths;
- original and thumbnail access;
- PDF/ZIP generation and authenticated download;
- migration rerun/idempotency tests when applicable;
- old mobile/client compatibility checks when a public contract changed.

For EcoAudit report or photo changes, the QA fixture must contain real,
compressed originals with both zone and equipment ownership. Generate both
report modes, verify totals/order/section ownership with PDF text and embedded
image inspection, and render every page for visual review.

Record the QA URL, exact SHA, test audit IDs, generated artifact checksums,
automated results, defects, and approver in the release checklist.

## 4. Freeze production and capture recovery points

Choose a low-traffic window. Before restarting the API, check durable jobs:

```sql
SELECT status, count(*)
FROM pdf_jobs
WHERE status IN ('queued', 'running')
GROUP BY status
ORDER BY status;
```

The expected result is zero rows. Otherwise wait, or record that affected users
will need to restart those exports.

Record the current immutable API and portal working directories and their full
commit SHAs. These are the code rollback targets.

For a database or data-affecting release:

1. Confirm the managed PostgreSQL backup/PITR state.
2. Create a timestamped custom-format dump:

   ```bash
   pg_dump --format=custom --no-owner --no-acl \
     --file "/protected/backups/pre-release-${RELEASE_SHA}.dump" \
     "$DATABASE_URL"
   sha256sum "/protected/backups/pre-release-${RELEASE_SHA}.dump"
   pg_restore --list "/protected/backups/pre-release-${RELEASE_SHA}.dump"
   ```

3. Copy the dump and checksum off the VM.
4. Restore it into an isolated temporary database and run row-count/integrity
   checks. A backup that has never been restored is not a verified release
   recovery point.

For file storage:

- record object/file counts and total bytes for each active destination;
- confirm object versioning, provider backup/snapshot, or a timestamped
  checksum-verified copy;
- include every active local root or Spaces bucket;
- do not accept a backup that silently skipped a configured root;
- keep the database and file recovery points at the same RPO.

OneDrive photo/PDF mirroring is secondary and does not replace primary-storage
recovery. The `onedrive:` rclone backup remote is a separate connection from
the Microsoft Graph photo/PDF mirror; validate both independently.

## 5. Validate production target binding

Run the read-only target preflight from the exact candidate release:

```bash
npm run release:preflight -- \
  --env-file /opt/ecosense-portal/.env \
  --target-file /opt/sw-config/release-targets/production.json \
  --release-dir "/opt/sw-releases/${RELEASE_SHORT}" \
  --expected-sha "$RELEASE_SHA"
```

The preflight does not connect to external services. It verifies:

- protected environment ownership/permissions;
- exact immutable release SHA and clean tree;
- production public origin, API/portal ports, and internal API origin;
- database host, port, name, user, SSL mode, and approved fingerprint;
- storage provider/write mode plus approved roots/buckets/key fingerprints;
- OneDrive enabled/required policy, folder, and credential fingerprints;
- required secret presence, strength, distinctness, and continuity;
- fail-closed security flags and forbidden QA markers.

Do not paste preflight target data or fingerprints into logs outside the
protected release evidence.

Then prove connectivity against the approved target.

### PostgreSQL

Run a read-only identity query:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('server_version')"
```

Require the approved production database name/user/host and SSL policy. A
successful `SELECT 1` against the wrong database is a failure.

### Primary local/Spaces storage

`npm run smoke:option3` checks the legacy destination only. It is not proof that
the EcoAudit, SolarSense, or InstallHub destination works in `dual` or
`isolated` mode.

For every active destination:

1. PUT a uniquely named disposable object using that destination's own
   least-privilege credential.
2. HEAD and GET it; verify byte count and SHA-256.
3. DELETE it and confirm it is absent.
4. Verify the credential cannot list/read/write a different app's bucket.
5. Confirm the bucket is private.

In `dual` or `isolated` mode, reads can fall back to legacy storage. Verify the
object directly in the intended bucket so fallback cannot hide a broken app
destination.

### OneDrive

When `ONEDRIVE_PHOTO_BACKUP_ENABLED=true`, require all of:

- approved Azure tenant/client fingerprints;
- approved production OneDrive user and folder fingerprints;
- current Graph admin consent;
- upload/download checksum smoke;
- one integrated photo/PDF mirror check.

`ONEDRIVE_BACKUP_REQUIRED=false` means Graph failure is best effort and does not
fail the primary operation. This policy must be explicit in the release record.
`ONEDRIVE_BACKUP_REQUIRED=true` with mirroring disabled is invalid.

The existing OneDrive smoke writes beneath `_smoke`; record and clean up its
artifact after verification.

### Portal and Chromium

The portal rewrite target is selected at build time. Require:

```text
INTERNAL_API_URL=http://127.0.0.1:3000
ECOSENSE_PORTAL_PORT=3210
```

Never allow a production build to fall back to a QA URL or QA port. Verify the
configured Chromium executable and generate a real report; `/health` does not
exercise Chromium.

## 6. Build the immutable production artifact

Follow [EcoSense Portal Deployment](ECOSENSE_PORTAL_DEPLOYMENT.md) for the exact
artifact commands.

Required properties:

- source checkout is clean, fast-forwarded `main`;
- a new `/opt/sw-releases/<shortsha>` path is created;
- the artifact is detached at the exact full SHA;
- dependencies are installed with lockfiles;
- legacy web and Next.js portal builds complete;
- production build-time portal variables are present;
- the protected production environment is linked, never copied into the
  artifact;
- the artifact is never patched after creation.

Record build output and the release directory before any process switch.

## 7. Apply database migrations safely

The API automatically runs Drizzle migrations before listening. This makes
migration compatibility part of every API start.

For a schema-neutral release:

- compare production migration rows with the release journal;
- confirm no pending migration;
- startup migration output must be a no-op.

For a release with migrations:

1. Inspect every new SQL file and journal entry.
2. Test it against a restored production snapshot, including rerun behavior,
   locks, runtime, nulls, legacy-only, canonical-only, and both-populated data.
3. Confirm the previous production application tolerates the expanded schema.
4. Stop or fence competing writers when required.
5. Apply from the exact immutable release with one migration runner.
6. Capture output and verify the applied migration journal and domain
   invariants before switching application code.

Current migration startup code has no explicit deployment advisory lock, drift
check, lock timeout, or statement timeout. Do not start multiple API candidates
concurrently during migration. A risky migration needs an operational wrapper
with a PostgreSQL advisory lock and reviewed timeouts.

Never try to undo an applied migration by editing its SQL or journal. Contract
or destructive changes require a later release after the compatibility window.

## 8. Switch API and portal

Record both prior process paths first. Switch only the processes selected in the
release record.

The normal compatible sequence is:

1. switch API to the new immutable release;
2. verify migration completion, database identity, loopback health, an
   authenticated API read, and recent API logs;
3. switch portal to the same release SHA;
4. verify portal loopback login and recent portal logs;
5. verify public Caddy routing.

Use the commands in
[EcoSense Portal Deployment](ECOSENSE_PORTAL_DEPLOYMENT.md#atomic-process-switch).
Do not run `pm2 save` during a routine release.

Normal application releases do not modify Caddy. If routing changed:

- save the previous Caddy configuration;
- run `caddy validate`;
- reload only after both loopback services pass;
- verify `/health` and `/v1/*` route to API while other paths route to portal.

## 9. Production smoke tests

Run both loopback and public checks. Health-only acceptance is prohibited.

Minimum read-only smoke:

- exact PM2 working directories and release SHA;
- API `/health`;
- portal `/login`;
- database identity and authenticated EcoAudit list/detail;
- authenticated login/read for every affected app;
- wrong-app and unauthenticated access denied;
- recent API, portal, migration, Caddy, storage, and Graph logs reviewed.

For photo, storage, sync, or report changes, use a dedicated production smoke
account and disposable record to prove:

1. create/start/complete lifecycle;
2. upload-session creation and confirmation;
3. object is in the intended primary destination;
4. authenticated original and thumbnail both load;
5. unauthenticated original/thumbnail access is rejected;
6. captions and owner/entity/field registry identity are correct;
7. PDF and photo ZIP jobs complete and download;
8. both EcoAudit report modes preserve zone order and zone/equipment ownership;
9. OneDrive mirror appears in the approved folder when enabled;
10. the disposable record is cleaned up only after evidence is captured.

Also verify shared portal login and Field App handoff whenever shared auth or
portal commits are included, even if the headline change is EcoAudit-only.

## 10. Observe

Use a minimum 30-minute active observation window for normal releases and a
24-hour follow-up review.

Monitor:

- HTTP 5xx and unexpected 401/403/404 changes;
- PM2 restart count, memory, CPU, and uptime;
- PostgreSQL errors, locks, connection saturation, and latency;
- queued/running/failed export jobs;
- missing originals, thumbnail failures, Spaces/S3 errors, and disk usage;
- OneDrive/Graph warnings and backup results;
- Chromium/PDF errors;
- Caddy errors and TLS health.

Do not delete the prior release or pre-release recovery points during the
observation window.

## 11. Roll back

### Code-only rollback

1. Enter the release window/maintenance state.
2. Switch portal to its recorded prior immutable directory.
3. Switch API to its recorded prior immutable directory.
4. Verify database identity, migration state, login, files, thumbnails, and a
   small export.
5. Preserve the failed artifact and logs; never repair an immutable release in
   place.

Do not restore the database for a normal code or PDF regression.

### Migration/data rollback

Code rollback is safe only when the prior code tolerates every applied
migration. If not:

- stop all writers;
- preserve a snapshot of the failed state;
- choose an explicitly verified database **and matching storage** recovery
  point;
- restore both to the same RPO;
- run integrity checks before starting prior code.

Never restore the database without the matching file-storage state.

### Storage rollback

Follow [Secure Storage Migration](SECURE_STORAGE_MIGRATION.md):

- change `isolated -> dual -> legacy`;
- use checksum-verified `isolated-to-legacy` copy when needed;
- keep source objects until the retention window closes;
- do not use rollback to re-enable admin bootstrap;
- allow legacy public files only as a dated, time-boxed incident bridge.

After any rollback, repeat the full public smoke and observation checks.

## 12. Close the release

The release record must contain:

- change/ticket and selected release classes;
- operator, reviewer, start/end time, and decision;
- release and previous SHAs/directories;
- QA exact-SHA evidence and approval;
- CI/full verification results;
- redacted target-preflight result;
- backup/snapshot IDs, checksums, and restore-test evidence;
- migration files/output/journal state, or `none`;
- smoke record/artifact IDs and checksums;
- production log and monitoring review;
- temporary security exceptions with owner and expiry;
- outcome: successful, rolled back, or follow-up required.

Secrets, signed URLs, access tokens, cookies, passwords, raw `.env` contents,
and customer data must never be included.

## Related runbooks

- [Production Release Checklist](PRODUCTION_RELEASE_CHECKLIST.md)
- [EcoSense Portal Deployment](ECOSENSE_PORTAL_DEPLOYMENT.md)
- [Infrastructure](INFRASTRUCTURE.md)
- [Secure Storage Migration](SECURE_STORAGE_MIGRATION.md)
- [OneDrive Photo Backup](ONEDRIVE_PHOTO_BACKUP.md)
- [EcoAudit PDF Rules](ECOAUDIT_PDF_RULES.md)
