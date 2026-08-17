# Infrastructure — Sustainability Wise API

## Hosting

Production currently separates runtime, database, primary object storage, and
secondary backup/mirroring. Exact resource identities belong in the protected
production target manifest described in
[QA to Production Release Runbook](PRODUCTION_RELEASE_RUNBOOK.md); do not infer
them from examples in this file.

| Component | Production role |
|---|---|
| DigitalOcean Droplet, SYD1 | Fastify API, EcoSense portal, Chromium, PM2, and Caddy |
| Managed PostgreSQL | Authoritative application database |
| Private DigitalOcean Spaces | Primary photo/PDF/object storage according to `STORAGE_WRITE_MODE` |
| VM local root | Emergency/transition destination only when explicitly configured |
| Microsoft Graph OneDrive | Optional secondary photo/PDF mirror |
| `onedrive:` rclone remote | Separate database/upload backup destination |

## Historical capacity baseline

The figures below describe the original small-Droplet design, not an approved
production target. Check the current DigitalOcean plan, disk metrics, managed
database capacity, and Spaces usage before using them for an operational
decision.

### Storage budget

```
Current 2 GB / 50 GB droplet practical budget:
  OS + dependencies + app:  ~8-12 GB
  PostgreSQL:               ~1-5 GB initially
  Safe local file budget:   ~25-30 GB

Worst case (10 users × 10 audits × 400 photos × 8 MB average):
  Photos:  320 GB
  PDFs:    ~5 GB
  DB:      ~100 MB
  Total:   ~325 GB

Conclusion: VM-local storage is acceptable for the beginning, but it is not a
long-term storage target at the current droplet size. Move to OneDrive/object
storage before photo volume approaches 25 GB, or attach a larger volume.
```

### Droplet RAM budget

```
Always-on:
  OS + system services:   ~100 MB
  PostgreSQL idle:         ~50 MB
  Fastify API server:     ~120 MB
  PM2 overhead:            ~30 MB
  Subtotal:               ~300 MB

Peak (during PDF generation):
  Puppeteer / Chromium:   ~350 MB
  Total peak:             ~650 MB

Available headroom:       ~1350 MB  (out of 2048 MB)
```

## Process Management (PM2)

```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save          # persist process list across reboots
pm2 startup       # install systemd service
pm2 logs          # stream logs
pm2 monit         # live CPU/RAM dashboard
pm2 restart sw-api # rolling restart (zero downtime for single instance)
```

The PM2 config runs `src/index.ts` through `tsx`, so `tsx` is a runtime dependency.
The API applies Drizzle migrations during startup before listening on the configured port.
For scheduler push rollout, apply both 0031 and 0032 before accepting traffic.
0031 creates/backfills aligned future scheduler jobs; 0032 adds device lifecycle
generations, raises the retry/receipt budget, and reconciles legacy terminal-job
delivery rows.

0033 adds the cross-app Scheduler commercial ledger. Apply it after 0032 before
serving finance routes. It copies existing Field headers, manual expenses, and
draft/issued/void invoice snapshots without dropping the released `ih_*` tables;
the runtime compatibility endpoints then read/write only the shared ledger.
The latest historical calendar-day auto-labour value becomes a clearly labelled
review override only when no recorded active-work session exists, preserving
both issued-history cost and uninvoiced estimates. Its persisted sell/cost per
hour is retained as the shared job rate, and legacy quoted invoice labour
reserves the corresponding quote value. The migration fails closed before
writing shared rows if legacy monetary/time data is nonfinite, negative, or out
of the supported accounting range. It seeds the transaction-safe yearly invoice
counter from preserved `INV-YYYY-NNNN` values.
Backups must include all `scheduler_job_*`, `scheduler_invoice_*`, and active-time
session tables because issued/paid invoice retention is independent of mutable
operational source rows.

Scheduler invoice PDFs use the shared durable `pdf_jobs` queue rather than a
browser-held render request. Jobs and stored artifacts are owned by the exact
portal app/user credential that queued them, pin invoice `id` + `updatedAt` in
their `reportVariantKey`, and are marked complete only after object storage has
accepted the branded PDF. Rendering reads invoice headers, grouped jobs, and
lines from one repeatable-read snapshot. Publication then locks and rechecks the
pinned invoice revision in the same transaction that completes `pdf_jobs`.
Before any PDF bytes are written, a `storage_deletion_tasks` outbox row protects
against interrupted or partial writes; successful publication removes that row
atomically. Explicit failure cleanup runs immediately. Global/startup cleanup
leases fresh invoice-export tasks for one hour to avoid rolling-restart races,
then a bounded 15-minute no-overlap sweep reclaims abandoned artifacts.
Scheduler PDF execution itself is durable: startup plus five-second polling
claims persisted jobs through a database token/lease, heartbeats live renders,
and reclaims expired running work without reversing its monotonic status.
New queued rows carry a durable-executor marker; fresh tokenless rows from a
rolling old API receive a one-hour grace before claim, preventing duplicate old
in-memory dispatch. Final completion and failure are fenced by the claim token,
so a replaced worker cannot publish over the new owner. A database failure-write
fence also makes the legacy interrupted-export reaper a no-op for queued or
running Scheduler PDFs; only the current claim worker can deliberately mark one
failed inside its transaction. Latest/status/download
access revalidates the creator as a
current active global administrator. Keep `pdf_jobs`, `storage_deletion_tasks`,
and referenced PDF objects in the same backup and restore plan. The released
Field invoice PDF endpoint remains synchronous only as a mobile compatibility
adapter.

Configure Scheduler defaults with `SCHEDULER_LABOUR_COST_RATE`,
`SCHEDULER_LABOUR_BILLABLE_RATE`, `SCHEDULER_INVOICE_GST_RATE`,
`SCHEDULER_INVOICE_DUE_DAYS`, and the `SCHEDULER_INVOICE_SELLER_*` variables.
Rates and expense/bill inputs are ex-GST. Invoice creation snapshots configured
seller values; issue freezes current draft bill-to/PO fields and current job
name/date/site fields. No receipt attachment upload is exposed in this release;
supplier bills are structured vendor/reference/date/category/cost/sell records.
`SCHEDULER_INVOICE_GST_RATE` is a decimal fraction from `0` through `1`; the API
fails startup for an invalid or out-of-range value instead of allowing a later
integer-column or invoice-total failure.
Currency is normalized to uppercase during legacy conversion, and migration
fails closed on mixed-currency Field ledgers rather than aggregating unlike
amounts. Runtime currency changes are blocked once an expense or invoice exists.

Issued and paid Scheduler invoices can be emailed from the portal. Delivery
reuses the Wattwatchers Fleet monitor's Gmail OAuth identity: provision the
same `EMAIL_DELIVERY_METHOD=gmail_api`, `GMAIL_USER_ID`, `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and `SMTP_USER`/`FROM_EMAIL`
values into the protected API runtime environment, then set
`SCHEDULER_INVOICE_EMAIL_ENABLED=true`. Copy these values only through the
approved secret-management/deploy path; do not source the monitor's complete
environment into the API, print values, or commit them. The API refreshes an
access token in memory and never stores OAuth secrets in PostgreSQL. Its exact
outbound allowlist is HTTPS/TCP 443 to `oauth2.googleapis.com` and
`gmail.googleapis.com`; it does not open an SMTP connection. The API does not
read or require the monitor's mutable `GMAIL_ACCESS_TOKEN`, `SMTP_PASS`, or
`TARGET_EMAIL`. `SMTP_USER` is used only as the sender-header fallback when the
monitor's explicit `FROM_EMAIL=` value is empty. The selected sender must be one
plain mailbox address (no display name, list, or line breaks); otherwise email
remains unconfigured and new requests fail closed. Invoice PDF attachments are
hard-capped at 18 MiB (`18874368` bytes) so attachment base64 plus the Gmail
API's whole-message base64url/JSON envelope remains safely below its request
limit; a higher environment value is clamped to that cap.

Each request first queues an exact invoice-revision PDF through `pdf_jobs`, then
records a unique invoice/idempotency-key row in
`scheduler_invoice_email_deliveries`. The email worker sends only that completed
branded artifact and revalidates invoice status and the requesting global admin
at the provider boundary. Known pre-submit failures use bounded backoff. Once a
Gmail submission may have started, a timeout, 5xx, malformed success, or process
interruption becomes `delivery_unknown` and is never retried automatically;
this favors one auditable uncertain outcome over a duplicate customer invoice.
Keep email delivery rows and their referenced PDF jobs/objects in the same
backup and restore plan. `SCHEDULER_INVOICE_EMAIL_ENABLED=false` pauses new
delivery and the worker without deleting audit history.

The same API process runs the durable Expo scheduler-notification worker. Jobs,
per-device tickets, and receipts live in PostgreSQL, so restarts and multiple API
processes are safe: due rows are claimed with `FOR UPDATE SKIP LOCKED`, abandoned
claims are recovered, and timers are stopped during graceful shutdown. Expo send
batches are capped at 100 and receipt requests at 1,000. Configure
`EXPO_ACCESS_TOKEN` only when enhanced Expo push security is enabled; the Expo
account/service-account token must have access to all three registered EAS
projects. Never log or expose it. Each external send batch revalidates the current scheduler event,
linked Draft product, canonical assignment, and automatic trigger timestamp;
stale jobs are terminally cancelled. One-day jobs expire at event start and
day-of jobs expire at event end or after 24 hours so outage recovery cannot emit misleading
temporal copy. Per-message `MessageRateExceeded` tickets or receipts
retain only the affected device delivery for bounded backoff/retry.
`EXPO_PUSH_ENABLED=false` pauses delivery without deleting queued work. See
`.env.production.example` for polling, claim recovery, receipt delay, retry, and
request-timeout controls.

Push device lifecycle fences are stored per app/device/canonical owner. The
monotonic `registrationGeneration` makes PUT/logout ordering restart-safe:
equal revoked or lower PUTs conflict, while cross-user DELETEs cannot disable
the device row owned by a newer login.

## Reverse Proxy (Caddy)

Caddy manages:
- HTTPS termination (Let's Encrypt, auto-renewed)
- HTTP → HTTPS redirect
- Reverse proxy to Fastify on port 3000

Config: `/etc/caddy/Caddyfile`

## Database Backup

Daily automated backup at 02:00 AEDT:
```bash
crontab -e
# 0 2 * * * /opt/sw-api/deploy/backup.sh >> /var/log/sw-backup.log 2>&1
```

Backup files land under `OneDrive:SustainabilityWise/backups/` by default:

- `db/sw_db_backup_YYYYMMDD_HHMMSS.sql.gz`
- `uploads/sw_uploads_backup_YYYYMMDD_HHMMSS.tar.gz`

Retention: OneDrive does not auto-delete — prune manually or add a cleanup step.
Recommended: keep last 30 days.

## Local File Storage

Phase 2 stores uploaded SolarSense photos and generated PDFs on the VM:

```bash
mkdir -p /var/lib/sustainability-wise-api/uploads
chown -R swapi:swapi /var/lib/sustainability-wise-api
```

Set these environment variables:

```bash
PUBLIC_BASE_URL=https://api.sustainabilitywise.com.au
LOCAL_FILE_STORAGE_ROOT=/var/lib/sustainability-wise-api/uploads
MAX_UPLOAD_BYTES=52428800
```

Add `LOCAL_FILE_STORAGE_ROOT` to backup/snapshot coverage. Database backups alone
are not enough because `photo_registry` stores file metadata while the actual
bytes live on disk.

## Weekly Droplet Snapshots

For full-server disaster recovery:
- Enable via DigitalOcean control panel: Droplet → Backups → Enable
- Confirm the current plan, retention, and latest successful snapshot
- Restores the Droplet disk, application, and server configuration
- Does **not** restore managed PostgreSQL, Spaces objects, or Microsoft Graph
  OneDrive data; verify those recovery paths independently

## Deployment Workflow

Use the [QA to Production Release Runbook](PRODUCTION_RELEASE_RUNBOOK.md) as the
canonical policy and complete a copy of the
[Production Release Checklist](PRODUCTION_RELEASE_CHECKLIST.md) for every
deployment. Promotion means deploying the exact QA-approved `main` commit with
the protected production environment; it never means copying QA data, storage,
or credentials.

```bash
# On the verified local main branch:
git push origin main
```

On the VM, build an immutable `/opt/sw-releases/<shortsha>` artifact and point
only the intended PM2 processes at that artifact. Do not pull or build in the
mutable `/opt/sw-api` checkout. The exact build, switch, verification, and
rollback commands are in `docs/ECOSENSE_PORTAL_DEPLOYMENT.md`.

## Smoke Tests

After deploy:

```bash
BASE_URL=https://api.sustainabilitywise.com.au \
EA_ADMIN_EMAIL=admin@sustainabilitywise.com.au \
EA_ADMIN_PASSWORD='...' \
SS_ADMIN_EMAIL=admin@sustainabilitywise.com.au \
SS_ADMIN_PASSWORD='...' \
./deploy/smoke-test.sh
```

With no credential variables, the script still verifies `/health` and skips
authenticated checks.

## Monitoring

Recommended free tools:
- **Better Uptime** (free tier) — HTTP health check on `/v1/auth/me`, email alert if down
- **PM2 built-in** — `pm2 monit` for local RAM/CPU
- **DigitalOcean Droplet graphs** — CPU, bandwidth, disk I/O in control panel

Add a health endpoint:
```
GET /health   → { status: 'ok', uptime: 12345, db: 'connected', version: '1.0.0' }
```

## Scaling Path

At current scale (5–10 users, 5–10 audits each) the single droplet handles everything.
If load grows:

1. **More users / higher concurrency:** Upgrade droplet to 4 GB ($24/mo) — no code changes
2. **PDF generation load:** Add a second 1 GB droplet as a dedicated PDF worker with a simple
   Redis job queue ($6/mo + $7/mo Redis) — total still under $50/mo
3. **Database growth:** Move PostgreSQL to DigitalOcean Managed Postgres ($15/mo) — gives
   point-in-time recovery, automatic failover, read replicas
4. **Global users:** Add Cloudflare free plan in front of the API — photo downloads served
   from edge cache, API calls still hit Sydney origin
