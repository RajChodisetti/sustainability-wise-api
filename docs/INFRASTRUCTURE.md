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
