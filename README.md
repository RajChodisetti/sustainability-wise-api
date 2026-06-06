# Sustainability Wise — Unified API Server

Unified REST API serving both **EcoAudit Pro** and **SolarSense** mobile applications.

| | |
|---|---|
| **Hosting** | DigitalOcean 2 GB Droplet, SYD1 (Sydney) |
| **Database** | PostgreSQL 16 (self-hosted on droplet) |
| **Photo storage** | Local disk via `LOCAL_FILE_STORAGE_ROOT` or DigitalOcean Spaces via `STORAGE_PROVIDER=spaces` |
| **PDF generation** | Puppeteer / headless Chromium |
| **Framework** | Fastify + TypeScript |
| **Cost** | ~$15 USD / ~$23 AUD per month |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, auth model, data flow
- [API Reference](docs/API_REFERENCE.md) — full endpoint list (also served live at `/v1/docs/`)
- [Infrastructure](docs/INFRASTRUCTURE.md) — server setup, deployment, backup
- [Mobile Integration](docs/MOBILE_INTEGRATION.md) — API contract for EcoAudit Pro and SolarSense
- [Deployment Runbook](docs/OPTION3_DIGITALOCEAN_RUNBOOK.md) — step-by-step DigitalOcean setup

## Project Structure

```
src/
  auth/           JWT + API key auth
  db/             Drizzle ORM schema + migrations
  storage/        Local/Spaces file storage helpers
  onedrive/       Microsoft Graph API client + upload sessions (deferred)
  pdf/            Puppeteer renderer + HTML templates
  routes/
    auth.ts
    apiKeys.ts
    solarsense/   Sites, Assessments, Photos, Sync, PDF
    ecoaudit/     Audits, Zones, 9 equipment types, Photos, Sync, PDF
  utils/
deploy/           Caddyfile, PM2 config, backup script
docs/             Planning and reference documents
```

## Quick Start

```bash
npm install
cp .env.example .env
# fill in .env with your DB URL, JWT secrets, and storage credentials
npm run db:migrate
npm run dev
```

For production deployment on DigitalOcean, follow the [Deployment Runbook](docs/OPTION3_DIGITALOCEAN_RUNBOOK.md).
