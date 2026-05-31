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
│   │  Local file storage → LOCAL_FILE_STORAGE_ROOT             │    │
│   │  Puppeteer / Chromium → PDF generation                    │    │
│   └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│   PostgreSQL 16 (localhost:5432)  ←  daily pg_dump                │
│   /var/lib/sustainability-wise-api/uploads → photo/PDF files      │
│   PM2 (process manager)                                            │
```

OneDrive Business remains the planned durable/off-site storage backend, but
Phase 2 stores SolarSense files on the VM first to reduce external dependencies.

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

## Photo Upload — Phase 2 VM-Local Flow

```
Mobile App                        API Server / VM filesystem
    │                                  │
    │── POST /sync/check-photo ────────▶│
    │   { checksum }                   │── query photo_registry
    │◀── { exists: false } ────────────│
    │                                  │
    │── POST /sync/create-upload-session▶
    │   { siteId, field, size, checksum}│── create pending registry row
    │◀── { uploadUrl, sessionId } ──────│
    │                                  │
    │── PUT uploadUrl (raw bytes) ─────▶│── write to LOCAL_FILE_STORAGE_ROOT
    │◀── { ok, checksum } ─────────────│
    │                                  │
    │── POST /sync/confirm-upload ─────▶│── verify checksum/file exists
    │◀── { remoteUrl } ────────────────│   remoteUrl = /v1/files/{storageKey}
```

Phase 2 uploads are single-request raw byte uploads. They are not resumable. If
the connection drops mid-upload, the client should create a new session and retry.
When OneDrive is added later, the mobile API surface can keep the same
`create-upload-session` / `confirm-upload` shape while changing the returned
`uploadUrl` behavior.

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
| `service_account` | sync only | sync records | sync records | ✗ | ✗ |
