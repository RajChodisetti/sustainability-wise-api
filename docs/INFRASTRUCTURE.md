# Infrastructure — Sustainability Wise API

## Hosting

| Component | Provider | Spec | Cost (USD/mo) |
|---|---|---|---|
| API Server + PostgreSQL + Puppeteer | DigitalOcean Droplet SYD1 | 2 GB RAM / 1 vCPU / 50 GB SSD | $12.00 |
| Photo + PDF storage | OneDrive Business (M365, already paid) | 1 TB included | $0 |
| SSL certificate | Caddy via Let's Encrypt | Automatic | $0 |
| DNS | DigitalOcean DNS | Free with Droplet | $0 |
| Database backups | OneDrive (already paid) | Daily pg_dump gzip | $0 |
| Weekly droplet snapshot | DigitalOcean | ~50 GB × $0.06/GB | ~$3.00 |
| **Total** | | | **~$15 USD / ~$23 AUD** |

## Storage Budget

```
Worst case (10 users × 10 audits × 400 photos × 8 MB average):
  Photos:  320 GB
  PDFs:    ~5 GB
  DB:      ~100 MB
  Total:   ~325 GB

OneDrive 1 TB capacity:  68% headroom remaining
```

## Droplet RAM Budget

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

Backup files land in `OneDrive:SustainabilityWise/backups/db/` as
`sw_backup_YYYYMMDD_HHMMSS.sql.gz`.

Retention: OneDrive does not auto-delete — prune manually or add a cleanup step.
Recommended: keep last 30 days.

## Weekly Droplet Snapshots

For full-server disaster recovery:
- Enable via DigitalOcean control panel: Droplet → Backups → Enable
- Cost: ~$3/month (20% of droplet price)
- Restores the entire disk including PostgreSQL data, Node.js app, and config

## Deployment Workflow

```bash
# On local machine — push a new release:
git push origin main

# On droplet — pull and restart:
cd /opt/sw-api
git pull origin main
npm ci --omit=dev
npx drizzle-kit migrate   # no-op if no new migrations
pm2 restart sw-api
pm2 logs --lines 50       # verify startup
```

Alternatively, configure a GitHub webhook or GitHub Actions CD pipeline to
trigger the deploy script on push to main.

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
