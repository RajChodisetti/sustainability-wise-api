# Architecture — Sustainability Wise Unified API

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CLIENTS                                         │
│  EcoAudit Pro Mobile   SolarSense Mobile   Web browser (API docs)  │
└──────────────┬──────────────────┬───────────────────────────────────┘
               │ JWT / API key    │ JWT / API key
               ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│               DigitalOcean Droplet SYD1 — 2 GB                     │
│                                                                     │
│   Caddy (HTTPS termination, reverse proxy to :3000)                │
│                        │                                            │
│   ┌────────────────────▼──────────────────────────────────────┐    │
│   │               Fastify API Server (Node.js 22)             │    │
│   │                                                           │    │
│   │  /v1/auth/*          /v1/api-keys/*                       │    │
│   │  /v1/ecoaudit/*      /v1/solarsense/*    /v1/docs         │    │
│   │                                                           │    │
│   │  Auth middleware (JWT + API key)                          │    │
│   │  Drizzle ORM → PostgreSQL 16 (localhost)                  │    │
│   │  Microsoft Graph API client → OneDrive Business           │    │
│   │  Puppeteer / Chromium → PDF generation                    │    │
│   └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│   PostgreSQL 16 (localhost:5432)  ←  daily pg_dump → OneDrive     │
│   PM2 (process manager)                                            │
└─────────────────────────────────────────────────────────────────────┘
               │ Microsoft Graph API
               ▼
┌─────────────────────────────┐
│  OneDrive Business (1 TB)   │
│  SustainabilityWise/        │
│    ecoaudit/audits/…        │
│    solarsense/sites/…       │
│    backups/db/…             │
└─────────────────────────────┘
```

## Auth Flow

### User Login (JWT)
```
POST /v1/auth/login { email, password, app }
  → Lookup user in ea_users or ss_users
  → bcrypt.compare(password, hash)
  → signAccessToken({ userId, app, role })   15 min
  → signRefreshToken({ userId, app })         30 days
  → Store hashed refresh token in refresh_tokens table
```

### Token Refresh
```
POST /v1/auth/refresh { refreshToken }
  → Verify JWT signature
  → Find non-revoked row in refresh_tokens by hash
  → Issue new access + refresh pair
  → Revoke old refresh token (single-use rolling)
```

### API Key Auth (App-to-App)
```
Authorization: Bearer sk_ea_live_xxxxxxxxxxxxxxxxxxxx
  → Extract prefix (sk_ea_live_)
  → Lookup matching non-revoked rows in api_keys
  → bcrypt.compare(raw, stored_hash)
  → Attach { userId, app, role: 'service_account' } to request
  → Update last_used_at
```

## Namespace Isolation

EcoAudit and SolarSense are hard-isolated:
- Separate user tables (`ea_users`, `ss_users`)
- Separate data tables (`ea_*`, `ss_*`)
- Auth middleware enforces `requireApp(app)` on every route
- An EcoAudit admin token cannot reach `/v1/solarsense/*` routes

## Photo Upload — Resumable Flow

```
Mobile App                        API Server                    OneDrive
    │                                  │                           │
    │── POST /sync/check-photo ────────▶│                           │
    │   { checksum }                   │── query photo_registry    │
    │◀── { exists: false } ────────────│                           │
    │                                  │                           │
    │── POST /sync/create-upload-session▶│                           │
    │   { siteId, field, size, checksum}│── Graph API: create session│──▶│
    │◀── { uploadUrl, sessionId } ──────│◀─────────────────────────│   │
    │                                  │                           │   │
    │── PUT uploadUrl (2MB chunks) ────────────────────────────────────▶│
    │   (direct to OneDrive, no auth)  │                           │   │
    │◀── 202 Continue ─────────────────────────────────────────────────│
    │── PUT uploadUrl (final chunk) ───────────────────────────────────▶│
    │◀── 201 Created ──────────────────────────────────────────────────│
    │                                  │                           │   │
    │── POST /sync/confirm-upload ─────▶│                           │   │
    │   { sessionId, itemId, checksum } │── verify file in OD ─────────▶│
    │◀── { remoteUrl } ────────────────│                           │   │
    │                                  │                           │   │
    │   Update local DB (remoteUrl)    │                           │   │
    │   Delete local file              │                           │   │
```

If the connection drops mid-upload:
- Client retries `GET uploadUrl` → OneDrive returns `Range: bytes=0-NNNN`
- Client resumes from byte `NNNN + 1`
- OneDrive upload sessions persist for 24 hours

## Data Sync Completion Gate

Only records with `status = 'Completed'` can be synced:

```
EcoAudit:   ea_audits.status = 'Completed'         (set via PATCH /audits/:id/complete)
SolarSense: ss_sites.status = 'Completed'          (set via PATCH /sites/:id/complete)
            ss_rooftop_assessments.status = 'Completed'
```

The API server rejects any `sync/push` or `sync/create-upload-session` call for
a record that is still `'Draft'`.

## Roles

| Role | Create own records | Read own records | Read all records | Manage users | Manage API keys |
|---|---|---|---|---|---|
| `inspector` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `service_account` | sync only | sync only | ✗ | ✗ | ✗ |
