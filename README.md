# Sustainability Wise — Unified Platform

Unified API and web portal for **EcoAudit Pro**, **SolarSense**,
**Field App Complete**, and **Wattwatchers Fleet**, including compatibility APIs for
their mobile applications.

| | |
|---|---|
| **Hosting** | DigitalOcean 2 GB Droplet, SYD1 (Sydney) |
| **Database** | PostgreSQL 16 (self-hosted on droplet) |
| **Photo storage** | Local disk via `LOCAL_FILE_STORAGE_ROOT` or DigitalOcean Spaces via `STORAGE_PROVIDER=spaces` |
| **PDF generation** | Puppeteer / headless Chromium |
| **Framework** | Fastify + TypeScript |
| **Cost** | ~$15 USD / ~$23 AUD per month |

## Documentation

- [AI System Context](docs/ai/SYSTEM_CONTEXT.md) - product boundaries and runtime map
- [AI Change Playbook](docs/ai/CHANGE_PLAYBOOK.md) - dependency tracing, migrations, verification
- [Cross-System Contracts](docs/ai/CONTRACTS.md) - photos, exports, auth, sync, and database invariants
- [Architecture](docs/ARCHITECTURE.md) — system design, auth model, data flow
- [API Reference](docs/API_REFERENCE.md) — full endpoint list (also served live at `/v1/docs/`)
- [Infrastructure](docs/INFRASTRUCTURE.md) — server setup, deployment, backup
- [Mobile Integration](docs/MOBILE_INTEGRATION.md) — API contract for EcoAudit Pro and SolarSense
- [OneDrive Photo Backup](docs/ONEDRIVE_PHOTO_BACKUP.md) — optional Microsoft Graph photo mirror
- [Deployment Runbook](docs/OPTION3_DIGITALOCEAN_RUNBOOK.md) — step-by-step DigitalOcean setup

## Project Structure

```
src/
  auth/           JWT + API key auth
  db/             Drizzle ORM schema + migrations
  storage/        Local/Spaces file storage helpers
  onedrive/       Microsoft Graph API client + photo backup mirror
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

## AI-Assisted Development

The repository uses hierarchical `AGENTS.md` files and one machine-readable
context map. Before changing a feature, run:

```bash
npm run ai:context -- ecoaudit "photo export"
```

During implementation, `npm run ai:preflight` selects checks from changed paths.
Before pushing or deploying, `npm run verify` runs API and portal tests,
typechecks, lint, and both production builds.
