# Architecture — Sustainability Wise Unified API

## System Overview

```text
EcoAudit mobile ---------\
SolarSense mobile --------\
Field App Complete mobile -> Caddy -> Fastify API (sw-api)
EcoSense portal ----------/                |
Fleet collector ----------/                +-> PostgreSQL 16
Legacy Vite UI -----------/                +-> local or Spaces storage
                                           +-> Chromium PDF renderer

EcoSense Next.js portal (ecosense-portal) is a separate PM2 process.

API namespaces:
  /v1/auth/*         /v1/api-keys/*       /v1/export/jobs/*
  /v1/ecoaudit/*     /v1/solarsense/*     /v1/installhub/*
  /v1/portal/*       /v1/wattwatchers/*
  /v1/files/*        /v1/thumbnails/*     /v1/docs
```

The configured storage provider is either VM-local disk or DigitalOcean Spaces.
OneDrive is an optional photo backup mirror, not the canonical API reference.

## Auth Flow

### User Login (JWT)
```
POST /v1/auth/login { email, password, app }
  → Lookup user in the selected app namespace
  → For Field App Complete, an explicit ih_users credential wins; otherwise verify an
    active Eco Audit/Solar Sense entry in the unified user registry
  → bcrypt.compare(password, hash)
  → signAccessToken({ userId, app, role })   15 min
  → signRefreshToken({ userId, app, jti })    30 days
  → Store hashed refresh token in refresh_tokens table
```

The portal may call `POST /v1/auth/portal-login`. Its response is a collection of
the same independent app-scoped login envelopes; it does not create a universal
token. Installed clients and older portal/API deployments continue to use
`/v1/auth/login` unchanged. When an authenticated Eco Audit or Solar Sense portal
session opens Field App Complete, `POST /v1/auth/field-session` verifies its source JWT and
matching still-active source refresh session, then returns a separate normal
Field App Complete auth envelope without displaying another credential form. This prevents a
revoked source session from being extended through Field App Complete. If two independent
source sessions are already active, the portal asks which signed-in account
should supply Field App Complete identity and role; it never chooses one nondeterministically
and still does not request a password.

### Token Refresh
```
POST /v1/auth/refresh { refreshToken }
  → Verify JWT signature
  → Lock the authoritative app/source user
  → Atomically claim the non-revoked refresh row by hash
  → Issue and store a unique replacement pair in the same transaction
```

Source-account writes and Field App Complete refreshes share the lock order
`authoritative source/native user → unified registry row → refresh token`. A
role, password, or active-state change therefore cannot race a replacement Field App Complete
refresh token back into validity.

### API Key Auth (App-to-App)
```
Authorization: Bearer sk_<app>_live_xxxxxxxxxxxxxxxxxxxx
  → Extract the app-specific prefix
  → Lookup matching non-revoked rows in api_keys
  → bcrypt.compare(raw, stored_hash)
  → Attach { userId, app, role: 'service_account' } to request
  → Update last_used_at
```

## Unified users with namespace isolation

Eco Audit, Solar Sense, Field App Complete, and Wattwatchers retain separate authorization
namespaces:

- Separate user tables (`ea_users`, `ss_users`, `ih_users`, `ww_users`)
- Separate data tables (`ea_*`, `ss_*`, `ih_*`, `ww_*`)
- Auth middleware enforces `requireApp(app)` on every route
- A token from one product cannot reach another product's routes

The additive `unified_users` table is the one cross-application user registry.
Migration `0014` backfills exactly one registry row for every existing Eco Audit,
Solar Sense, and native Field App Complete account, including inactive accounts. Each row
retains its origin app/user ID, exact role and active state, profile fields,
credential snapshot, and a stable Field App Complete subject ID. The legacy tables remain the
authoritative records so installed applications and their existing login and
user-management APIs continue to work unchanged.

Database triggers keep legacy writers compatible:

- new and updated Eco Audit, Solar Sense, and native Field App Complete users are mirrored
  into `unified_users` in the same database transaction;
- source role, status, name, and credential changes update the registry row;
- source role, status, credential, and deletion changes revoke both source and
  linked Field App Complete refresh sessions;
- source deletion leaves an inactive, traceable registry tombstone;
- no Eco Audit or Solar Sense shadow row is inserted into `ih_users`.

Independent source records are deliberately never auto-merged, even when their
email or username is equal. This preserves audit ownership and provides a safe
rollback path: older applications keep reading and writing their original user
tables, while the additive registry supplies shared Field App Complete access and the unified
portal directory.

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
