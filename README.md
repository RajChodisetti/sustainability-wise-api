# Sustainability Wise — Unified API Server

Unified REST API serving both **EcoAudit Pro** and **SolarSense** mobile applications.

| | |
|---|---|
| **Hosting** | DigitalOcean 2 GB Droplet, SYD1 (Sydney) |
| **Database** | PostgreSQL 16 (self-hosted on droplet) |
| **Photo storage** | Phase 2 starts with VM-local storage under `LOCAL_FILE_STORAGE_ROOT`; OneDrive can be added later |
| **PDF generation** | Puppeteer / headless Chromium |
| **Framework** | Fastify + TypeScript |
| **Cost** | ~$15 USD / ~$23 AUD per month |

## Documentation

- [Implementation Plan](IMPLEMENTATION_PLAN.md) — phased build plan with all tasks and file references
- [Architecture](docs/ARCHITECTURE.md) — system design, auth model, data flow
- [Mobile Integration](docs/MOBILE_INTEGRATION.md) — all changes required in SolarSense and EcoAudit Pro mobile apps
- [API Reference](docs/API_REFERENCE.md) — full endpoint list (also served live at `/v1/docs`)
- [Infrastructure](docs/INFRASTRUCTURE.md) — server setup, deployment, backup

## Project Structure

```
src/
  auth/           JWT + API key auth
  db/             Drizzle ORM schema + migrations
  storage/        VM-local file storage helpers
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

## Build Order

```
Phase 0 → Infrastructure (DigitalOcean + Azure AD)
Phase 1 → API Core (auth, DB schema, shared utils)
Phase 2 → SolarSense server endpoints
Phase 3 → SolarSense mobile changes
Phase 4 → EcoAudit server endpoints
Phase 5 → EcoAudit mobile changes
Phase 6 → PDF service (Puppeteer templates)
Phase 7 → API documentation (Swagger UI)
Phase 8 → Deployment + smoke tests
```
