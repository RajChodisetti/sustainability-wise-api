# Architecture — Sustainability Wise Unified API

## System Overview

```text
EcoAudit mobile ---------\
SolarSense mobile --------> Caddy -> Fastify API (sw-api)
EcoSense portal ----------/                |
Fleet collector ----------/                +-> PostgreSQL 16
Legacy Vite UI -----------/                +-> local or Spaces storage
                                           +-> Chromium PDF renderer

EcoSense Next.js portal (ecosense-portal) is a separate PM2 process.

API namespaces:
  /v1/auth/*         /v1/api-keys/*       /v1/export/jobs/*
  /v1/ecoaudit/*     /v1/solarsense/*     /v1/wattwatchers/*
  /v1/files/*        /v1/thumbnails/*     /v1/docs
```

The configured storage provider is either VM-local disk or DigitalOcean Spaces.
OneDrive is an optional photo backup mirror, not the canonical API reference.

## Auth Flow

### User Login (JWT)
```
POST /v1/auth/login { email, password, app }
  → Lookup user in the selected ea_users, ss_users, or ww_users namespace
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
Authorization: Bearer sk_<app>_live_xxxxxxxxxxxxxxxxxxxx
  → Extract the app-specific prefix
  → Lookup matching non-revoked rows in api_keys
  → bcrypt.compare(raw, stored_hash)
  → Attach { userId, app, role: 'service_account' } to request
  → Update last_used_at
```

## Namespace Isolation

EcoAudit, SolarSense, and Wattwatchers are hard-isolated:
- Separate user tables (`ea_users`, `ss_users`, `ww_users`)
- Separate data tables (`ea_*`, `ss_*`, `ww_*`)
- Auth middleware enforces `requireApp(app)` on every route
- A token from one product cannot reach another product's routes

## Photo Upload Flow

```
Mobile App                        API Server / configured storage
    │                                  │
    │── POST /sync/check-photo ────────▶│
    │   { checksum }                   │── query photo_registry
    │◀── { exists: false } ────────────│
    │                                  │
    │── POST /sync/create-upload-session▶
    │   { siteId, field, size, checksum}│── create pending registry row
    │◀── { uploadUrl, sessionId } ──────│
    │                                  │
    │── PUT uploadUrl (raw bytes) ─────▶│── write to local disk or Spaces
    │◀── { ok, checksum } ─────────────│
    │                                  │
    │── POST /sync/confirm-upload ─────▶│── verify checksum/file exists
    │◀── { remoteUrl } ────────────────│   remoteUrl = /v1/files/{storageKey}
```

Uploads are single-request raw byte uploads. They are not resumable. If
the connection drops mid-upload, the client should create a new session and retry.
The local and Spaces providers preserve the same `create-upload-session` and
`confirm-upload` API shape. Optional OneDrive mirroring runs after canonical
storage and does not change the returned photo reference.

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
| `viewer` | ✗ | n/a | Fleet only | ✗ | ✗ |
| `inspector` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `service_account` | sync only | sync records | sync records | ✗ | ✗ |
