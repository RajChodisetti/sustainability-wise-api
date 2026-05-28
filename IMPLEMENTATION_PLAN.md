# Implementation Plan — Sustainability Wise Unified API

## Overview

A single REST API server that serves both **EcoAudit Pro** and **SolarSense** mobile applications.
Handles data backup and sync, resumable photo upload, server-side PDF generation, and
multi-role authentication (user JWT + app-to-app API keys).

**Infrastructure:** DigitalOcean 2 GB Droplet SYD1 (Sydney) · PostgreSQL 16 (self-hosted) ·
OneDrive Business (photo/PDF storage) · Puppeteer (PDF) · Fastify + TypeScript (API)

**Cost:** ~$15 USD / ~$23 AUD per month

---

## Repositories Involved

| Repo | Role |
|---|---|
| `sustainability-wise-api/` | New — this repo. The unified API server. |
| `solarsense-mobile/` | Existing — modified in Phase 3 to add sync capability |
| `ecoaudit-pro/mobile/` | Existing — modified in Phase 5 to add sync capability |

---

## Phase 0 — Infrastructure Setup
> One-time server provisioning. No application code. Complete before Phase 1.

### 0.1 Provision DigitalOcean Droplet
- Plan: **Basic 2 GB RAM / 1 vCPU / 50 GB SSD** — Sydney region (**SYD1**)
- OS: Ubuntu 24.04 LTS
- Enable automatic weekly droplet backups (+$2.40/month)
- Assign a Floating IP (static address that survives rebuilds)
- Add your SSH public key at creation time

### 0.2 Server Baseline Configuration
Install in order:

```bash
apt update && apt upgrade -y
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
# Tooling
npm install -g pm2
apt install -y postgresql-16 caddy chromium-browser rclone
```

### 0.3 PostgreSQL Initial Setup

```sql
sudo -u postgres psql
CREATE USER swapi WITH PASSWORD '<strong_password>';
CREATE DATABASE sw_production OWNER swapi;
-- Postgres only listens on 127.0.0.1 by default — leave that unchanged
\q
```

### 0.4 Azure AD App Registration (5-minute manual task)
1. Open [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations → New
2. Name: `SW API OneDrive`
3. API permissions → Add → Microsoft Graph → `Files.ReadWrite` (delegated) + grant admin consent
4. Certificates & secrets → New client secret → copy value immediately
5. Save three values to the server `.env`:
   ```
   AZURE_CLIENT_ID=...
   AZURE_CLIENT_SECRET=...
   AZURE_TENANT_ID=...
   ONEDRIVE_USER_EMAIL=<the M365 account email that owns the OneDrive>
   ```

### 0.5 Server Environment File
Create `/opt/sw-api/.env`:
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://swapi:<password>@localhost:5432/sw_production
JWT_SECRET=<64 random chars>
JWT_REFRESH_SECRET=<64 random chars>
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_TENANT_ID=...
ONEDRIVE_USER_EMAIL=...
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### 0.6 Caddyfile
`/etc/caddy/Caddyfile`:
```
api.sustainabilitywise.com.au {
    reverse_proxy localhost:3000
}
```
HTTPS is provisioned automatically by Caddy via Let's Encrypt.
If no domain yet, Caddy serves on the floating IP over HTTP until the domain is pointed.

---

## Phase 1 — API Server Core (Shared Foundation)
> New files in `sustainability-wise-api/`. All subsequent phases depend on this.

### 1.1 Scaffold Project

**New files:**

| File | Purpose |
|---|---|
| `package.json` | Dependencies: fastify, @fastify/jwt, @fastify/swagger, @fastify/swagger-ui, drizzle-orm, drizzle-kit, postgres, @microsoft/microsoft-graph-client, puppeteer-core, bcryptjs, zod, typescript, tsx, dotenv |
| `tsconfig.json` | Strict TypeScript, target ES2022, module NodeNext |
| `drizzle.config.ts` | Points Drizzle Kit at `src/db/schema/` and `DATABASE_URL` |
| `src/config.ts` | Typed env loader — reads `.env`, throws on any missing required variable |
| `src/app.ts` | Fastify instance creation, plugin registration, route group registration |
| `src/index.ts` | Entry point: run migrations, start Fastify on `PORT` |

### 1.2 Database Schema — Shared Tables
**New file: `src/db/schema/shared.ts`**

```typescript
api_keys (
  id, name, hashed_key, prefix,
  app          TEXT   -- 'ecoaudit' | 'solarsense'
  role         TEXT   -- 'admin' | 'inspector' | 'service_account'
  created_by_user_id, last_used_at, expires_at, revoked_at, created_at
)

refresh_tokens (
  id, user_id, app, token_hash, expires_at, revoked_at, created_at
)

photo_registry (
  id, checksum,            -- SHA-256 hex of raw file bytes
  remote_url,              -- final OneDrive share/download URL
  onedrive_item_id,        -- Graph API item ID (used to generate fresh download URLs)
  app,                     -- 'ecoaudit' | 'solarsense'
  parent_id,               -- audit_id or site_id
  entity_type,             -- e.g. 'hvac_unit', 'rooftop_assessment'
  entity_id,
  field_name,              -- e.g. 'photo', 'extra_photos[2]', 'aerial_photo_uri'
  file_size_bytes, created_at
)
```

### 1.3 Database Schema — SolarSense Tables
**New file: `src/db/schema/solarsense.ts`**

All fields sourced from `solarsense-mobile/src/domain/types.ts` and
`solarsense-mobile/src/database/migrations.ts`.

```typescript
ss_users (
  id, email, password_hash, full_name,
  role          TEXT DEFAULT 'inspector',  -- 'admin' | 'inspector'
  is_active, created_at, updated_at
)

ss_sites (
  -- All Site fields from domain/types.ts
  id, server_id, sync_status, updated_at, deleted_at,
  site_name, location, date_of_assessment, document_classification,
  electrical_infrastructure_summary, known_constraints,
  load_profile_metering_summary, ppa_asset_demarcation,
  appendix_notes,
  appendix_items        JSONB DEFAULT '[]',
  report_pdf_local_path, report_pdf_remote_url,
  created_by_user_id, created_at,
  status                TEXT DEFAULT 'Draft'   -- NEW: 'Draft' | 'Completed'
)

ss_rooftop_assessments (
  -- All RooftopAssessment fields from domain/types.ts
  id, server_id, sync_status, updated_at, deleted_at,
  site_id, site_name, building_id_name,
  heritage_status, heritage_deal_breaker,
  aerial_photo_uri, roof_area_total_m2, roof_material, roof_framing_type,
  roof_pitch_angle, roof_construction_material, asbestos_flag, roof_condition,
  roof_estimated_age, roof_orientation_primary, roof_shading_sources,
  roof_shading_usable_pct, roof_orientation_shading, structural_feasibility,
  structural_risk_flag, roof_area_usable_m2, pv_size_kw_dc, ac_export_kw,
  access_safety_constraints,
  switchboards            JSONB DEFAULT '[]',
  msb_details, msb_photo_uri, existing_generation, distance_to_connection_m,
  electrical_pits_entry, inverter_siting, transformer_supply_capacity,
  dnsp_constraints, load_profile_metering,
  other_considerations    JSONB DEFAULT '[]',
  site_rep_feedback, viability_status, deal_breaker_reason, rag_priority,
  key_assumptions_gaps,
  additional_photos       JSONB DEFAULT '[]',
  photo_metadata          JSONB DEFAULT '{}',
  created_by_user_id, created_at,
  status                  TEXT DEFAULT 'Draft'   -- NEW: 'Draft' | 'Completed'
)
```

### 1.4 Database Schema — EcoAudit Tables
**New file: `src/db/schema/ecoaudit.ts`**

All fields sourced from `ecoaudit-pro/mobile/src/database/schema.ts` and
`ecoaudit-pro/mobile/src/database/migrations.ts`.

```typescript
ea_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)

ea_audits (
  id, server_id, sync_status, updated_at, deleted_at,
  site_name, site_address, inspector_name, audit_date,
  status                TEXT DEFAULT 'Draft',  -- 'Draft' | 'Completed'
  report_pdf_local_path, report_pdf_remote_url,
  created_by_user_id, assigned_inspector_user_id, created_at
)

ea_zones (
  id, server_id, sync_status, updated_at, deleted_at,
  audit_id, zone_name, zone_description,
  photos                TEXT[],   -- array of remote URLs after sync
  created_at
)

-- All 9 equipment tables — each carries (id, server_id, sync_status, updated_at, deleted_at,
-- zone_id, audit_id, created_at) plus their domain-specific fields from DATA_MODELS.md

ea_main_switchboards        (name, location, map_locator, site_nmi, photo, sub_circuits_description, comments, extra_notes, extra_photos TEXT[])
ea_additional_switchboards  (name, location, map_locator, type, photo, sub_circuits_description, comments, extra_notes, extra_photos TEXT[])
ea_hvac_units               (unit_name, make, photo, location, type, model, serial_number, heating_capacity_kw, cooling_capacity_kw, power_supply_phase, nameplate_photos, indoor_unit_model, indoor_unit_serial, indoor_unit_nameplate_photo, controller_type, controller_model, controller_photo, temperature_sensor_type, system_coverage, energy_improvement_observations, extra_notes, extra_photos TEXT[])
ea_lighting_systems         (light_type, brand_model, photo, rated_wattage, quantity, fixtures_installed, fixtures_photo, area_location, controls_type, operating_hours, mounting_height, mounting_constraints_photo, circuit_grouping, sensors_photo, access_limitations, switchboard_photo_notes, energy_improvement_observations, extra_notes, extra_photos TEXT[])
ea_solar_pv                 (system_size_kw, roof_photo, inverter_brand_model, inverter_location, inverter_label_photo, power_supply_to_pv, electricity_meter_photo, available_roof_space, roof_space_amount, additional_solar_space_photo, suitable_switchboard, switchboard_photo, switchboard_location, cable_distance, cable_route_description, energy_improvement_observations, extra_notes, extra_photos TEXT[])
ea_forklift_chargers        (charger_type, charger_photo, brand_model, rating, charger_label_photo, power_supply, electric_connection_photo, location, quantity, charger_space_photo, connection_description, socket_connection_photo, local_isolator, circuit_identifiable, distance_to_switchboard, space_for_additional, hardwired_socket, scheduling_opportunity, energy_improvement_observations, extra_notes, extra_photos TEXT[])
ea_hot_water_systems        (dhw_details_type, photo, serial_number, size_liters, fuel_type, location, pipe_insulation, pipe_insulation_thickness, tempering_valve, additional_photo, more_dhw_systems, additional_comments, energy_improvement_observations, extra_notes, extra_photos TEXT[])
ea_general_water            (question, answer, photos TEXT[], extra_notes, extra_photos TEXT[])
ea_general_electricity      (question, answer, photos TEXT[], extra_notes, extra_photos TEXT[])
```

### 1.5 Database Client + Migrations
**New files:**
- `src/db/client.ts` — `drizzle(postgres(config.DATABASE_URL))`
- `src/db/migrate.ts` — `migrate(db, { migrationsFolder })` called at `src/index.ts` startup

### 1.6 Auth — JWT
**New file: `src/auth/jwt.ts`**
```typescript
signAccessToken({ userId, app, role })  → string   // expires 15 min
signRefreshToken({ userId, app })       → string   // expires 30 days
verifyAccessToken(token)                → JwtPayload | null
verifyRefreshToken(token)               → JwtPayload | null
```

### 1.7 Auth — API Keys
**New file: `src/auth/apiKey.ts`**
```typescript
generateKey(app: 'ea' | 'ss')           → { raw: 'sk_ea_live_xxx', prefix, hashed }
hashKey(raw: string)                    → Promise<string>   // bcrypt
verifyKey(raw: string, hashed: string)  → Promise<boolean>
```

### 1.8 Auth — Middleware
**New file: `src/auth/middleware.ts`**

Fastify `preHandler` that:
1. Reads `Authorization: Bearer <token>`
2. Tries JWT verification first
3. Falls back to API key lookup in `api_keys` table (updates `last_used_at`)
4. Attaches `{ userId, app, role, authType: 'jwt' | 'apikey' }` to `request.user`
5. Throws HTTP 401 if neither succeeds

```typescript
export const authenticate: FastifyPluginCallback   // registers as preHandler
export function requireRole(minimum: Role)         // preHandler factory — throws 403
export function requireApp(app: string)            // preHandler factory — throws 403 if namespace mismatch
```

### 1.9 Auth Routes
**New file: `src/routes/auth.ts`**

```
POST /v1/auth/login
  Body: { email, password, app: 'ecoaudit' | 'solarsense' }
  Logic: lookup user in ea_users or ss_users, bcrypt.compare(), issue JWT pair,
         store hashed refresh token in refresh_tokens table
  Response: { accessToken, refreshToken, expiresIn: 900 }

POST /v1/auth/refresh
  Body: { refreshToken }
  Logic: find non-revoked token by hash, verify JWT, issue new pair, revoke old token
  Response: { accessToken, refreshToken, expiresIn: 900 }

POST /v1/auth/logout
  Body: { refreshToken }
  Logic: mark refresh_token row as revoked

GET /v1/auth/me
  Auth: JWT or API key
  Response: { id, email, fullName, role, app }
```

### 1.10 API Key Routes
**New file: `src/routes/apiKeys.ts`**

```
GET    /v1/api-keys        admin only — list non-revoked keys (no raw value shown)
POST   /v1/api-keys        admin only — create key, return raw value ONCE
  Body: { name, role: 'inspector'|'service_account', expiresAt? }
DELETE /v1/api-keys/:id    admin only — set revoked_at = now
```

### 1.11 Shared Utilities
**New files:**
- `src/utils/errors.ts` — `AppError` class, `httpError(status, message)` helpers
- `src/utils/crypto.ts` — `sha256(buffer: Buffer): string` returns hex (used for photo dedup)
- `src/utils/pagination.ts` — `parsePage(query)`, `buildPageMeta(total, page, limit)`

### 1.12 OpenAPI / Swagger Setup
In `src/app.ts`:
- Register `@fastify/swagger` with OpenAPI 3.1 spec, security scheme `bearerAuth`
- Register `@fastify/swagger-ui` at route `/v1/docs`
- Apply `authenticate` middleware to `/v1/docs` (protected — not public)
- Every route registered with `schema.tags`, `schema.summary`, `schema.body`, `schema.response`
  so Swagger auto-generates complete documentation

### 1.13 PM2 Config
**New file: `deploy/ecosystem.config.cjs`**
```js
module.exports = {
  apps: [{
    name: 'sw-api',
    script: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx/esm',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1500M',
    env_production: { NODE_ENV: 'production' }
  }]
};
```

### 1.14 DB Backup Script
**New file: `deploy/backup.sh`**
```bash
#!/bin/bash
# Daily cron: 0 2 * * * /opt/sw-api/deploy/backup.sh
set -e
STAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="/tmp/sw_backup_${STAMP}.sql.gz"
pg_dump -U swapi sw_production | gzip > "$OUTFILE"
rclone copy "$OUTFILE" "onedrive:SustainabilityWise/backups/db/"
rm "$OUTFILE"
echo "Backup complete: sw_backup_${STAMP}.sql.gz"
```

---

## Phase 2 — SolarSense Server API
> New files in `sustainability-wise-api/`. Depends on Phase 1.

### 2.1 OneDrive Client + Path Builder
**New file: `src/onedrive/graphClient.ts`**

Microsoft Graph API client using client credentials OAuth flow:
```typescript
getAccessToken()                       // cached, refreshed when < 5 min from expiry
graphGet(path: string)
graphPut(path: string, body: unknown)
```

**New file: `src/onedrive/paths.ts`**

All OneDrive folder/file paths for both apps:
```typescript
// SolarSense
ssSitePath(siteId)                                           // SustainabilityWise/solarsense/sites/{id}/
ssAssessmentPath(siteId, assessmentId)                       // .../assessments/{id}/
ssPhotoPath(siteId, assessmentId, field, filename)           // .../rooftop/{n}.jpg etc
ssSitePackPdfPath(siteId)                                    // .../site-pack.pdf

// EcoAudit
eaAuditPath(auditId)                                         // SustainabilityWise/ecoaudit/audits/{id}/
eaZonePath(auditId, zoneId)                                  // .../zones/{id}/
eaEquipmentPhotoPath(auditId, zoneId, type, equipId, field, filename)
eaReportPdfPath(auditId)                                     // .../report.pdf
```

**New file: `src/onedrive/uploadSession.ts`**
```typescript
createUploadSession(remotePath, fileSizeBytes)
  → { uploadUrl: string, sessionId: string }
  // Creates OneDrive upload session via Graph API
  // uploadUrl is pre-signed — no auth header needed on PUT

verifyUploadComplete(onedriveItemId: string)
  → boolean
  // Checks Graph API that the item exists and size matches

getShortLivedDownloadUrl(onedriveItemId: string)
  → string   // expires ~1 hour, safe to embed in HTML for Puppeteer

deleteItem(onedriveItemId: string)
  → void
```

### 2.2 SolarSense Users Routes
**New file: `src/routes/solarsense/users.ts`**

```
GET    /v1/solarsense/users        admin only — list is_active users
POST   /v1/solarsense/users        admin only — create (bcrypt password)
GET    /v1/solarsense/users/:id    admin or self
PATCH  /v1/solarsense/users/:id    admin only — update name / role / is_active
DELETE /v1/solarsense/users/:id    admin only — set is_active=false (soft delete)
```

### 2.3 SolarSense Sites Routes
**New file: `src/routes/solarsense/sites.ts`**

```
GET    /v1/solarsense/sites
  inspector: WHERE created_by_user_id = :userId AND deleted_at IS NULL
  admin: all non-deleted sites

POST   /v1/solarsense/sites
  Sets created_by_user_id from JWT/API key userId
  Returns created site with server-assigned id

GET    /v1/solarsense/sites/:id
  403 if inspector and not owner

PATCH  /v1/solarsense/sites/:id
  Cannot change status via this endpoint (use /complete)

DELETE /v1/solarsense/sites/:id
  Soft delete: deleted_at = now()

PATCH  /v1/solarsense/sites/:id/complete
  Sets status = 'Completed', updated_at = now()
  Makes site eligible for sync
```

### 2.4 SolarSense Assessments Routes
**New file: `src/routes/solarsense/assessments.ts`**

```
GET    /v1/solarsense/sites/:siteId/assessments
POST   /v1/solarsense/sites/:siteId/assessments
GET    /v1/solarsense/sites/:siteId/assessments/:id
PATCH  /v1/solarsense/sites/:siteId/assessments/:id
DELETE /v1/solarsense/sites/:siteId/assessments/:id
PATCH  /v1/solarsense/sites/:siteId/assessments/:id/complete
```

`switchboards`, `other_considerations`, `additional_photos`, `photo_metadata`, `appendix_items`
are stored as JSONB in Postgres and returned as parsed objects (not raw strings).

### 2.5 SolarSense Photo Routes
**New file: `src/routes/solarsense/photos.ts`**

```
GET  /v1/solarsense/sites/:siteId/photos
  Returns flat list of all photos for the site from photo_registry
  Each item includes: field, entityType, entityId, remoteUrl, fileSizeBytes

GET  /v1/solarsense/sites/:siteId/photos/export
  Streams a ZIP containing all photos at original quality
  Folder structure mirrors OneDrive: assessments/{id}/rooftop/, switchboards/, etc.

DELETE /v1/solarsense/photos/:photoId
  Deletes from OneDrive (Graph API) and removes from photo_registry
```

### 2.6 SolarSense Sync Routes
**New file: `src/routes/solarsense/sync.ts`**

All sync endpoints require `service_account` or `inspector` role.
All write operations gate on `status = 'Completed'`.

```
POST /v1/solarsense/sync/check-photo
  Body: { checksum: string, siteId: string, assessmentId?: string, fieldName: string }
  Logic: SELECT FROM photo_registry WHERE checksum = :checksum AND app = 'solarsense'
  Response: { exists: boolean, remoteUrl?: string }

POST /v1/solarsense/sync/create-upload-session
  Body: { checksum, siteId, assessmentId, fieldName, filename, fileSizeBytes }
  Gate: SELECT status FROM ss_sites WHERE id = :siteId → must be 'Completed'
  Logic:
    1. Build OneDrive path via paths.ssPhotoPath()
    2. Call uploadSession.createUploadSession()
    3. INSERT INTO photo_registry (status='pending', session_id=...)
  Response: { sessionId, uploadUrl, alreadyExists: false }

POST /v1/solarsense/sync/confirm-upload
  Body: { sessionId: string, onedriveItemId: string, checksum: string }
  Logic:
    1. uploadSession.verifyUploadComplete(onedriveItemId)
    2. Get download URL via getShortLivedDownloadUrl()
    3. UPDATE photo_registry SET status='confirmed', remote_url=..., onedrive_item_id=...
  Response: { remoteUrl: string }

POST /v1/solarsense/sync/push
  Body: { sites: Site[], assessments: RooftopAssessment[] }
  Gate: every record must have status = 'Completed'
  Logic:
    For each site and assessment:
      INSERT ... ON CONFLICT (id) DO UPDATE (upsert by local id)
      If new row: assign server_id (UUID), return it
  Response: {
    siteIds: Record<localId, serverId>,
    assessmentIds: Record<localId, serverId>
  }

GET /v1/solarsense/sync/pull?since=ISO8601&siteId=optional
  Logic:
    SELECT * FROM ss_sites
    WHERE created_by_user_id = :userId
      AND updated_at > :since
      AND deleted_at IS NULL
    -- same for ss_rooftop_assessments
  Response: { sites: [], assessments: [], pulledAt: ISO8601 }
```

### 2.7 SolarSense PDF Route
**New file: `src/routes/solarsense/pdf.ts`**

```
POST /v1/solarsense/sites/:siteId/site-pack/pdf
  Body: { assessmentIds: string[], options: SitePackReportOptions }
  Auth: inspector (own site) or admin
  Logic:
    1. Fetch ss_sites + selected ss_rooftop_assessments from DB
    2. For each photo field with onedrive_item_id: call getShortLivedDownloadUrl()
    3. Build template data object
    4. Inject into src/pdf/templates/solarsense.html via string replacement
    5. Call pdf/renderer.ts renderPdf(html) → Buffer
    6. Upload PDF buffer to OneDrive: paths.ssSitePackPdfPath(siteId)
    7. UPDATE ss_sites SET report_pdf_remote_url = ...
    8. Stream PDF as response (Content-Type: application/pdf)
    9. If PDF > 50 MB: return 413 with { error, actualSizeBytes }
```

---

## Phase 3 — SolarSense Mobile Changes
> Modifications to `solarsense-mobile/`. Requires Phase 2 API to be deployed.

### 3.1 DB Migration — Status Fields + Upload Queue
**Modify: `src/database/migrations.ts`**

Add `MIGRATION_2` (after existing migration 1):
```sql
-- Completion gate for sync
ALTER TABLE sites ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE rooftop_assessments ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';

-- Upload queue enhancements (attempts + last_error already exist in migration 1)
ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN onedrive_item_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
```

**Modify: `src/constants/version.ts`**
- Bump `DB_VERSION` to trigger migration runner

### 3.2 Domain Types — Status Field
**Modify: `src/domain/types.ts`**
```typescript
// Add to Site:
status: 'Draft' | 'Completed';

// Add to RooftopAssessment:
status: 'Draft' | 'Completed';
```

### 3.3 Repository — Status Support
**Modify: `src/repositories/solarSenseRepository.ts`**

- Add `status` to `SiteRow` type and `AssessmentRow` type
- Add `status` field to `mapSite()` and `mapAssessment()` mapper functions
- Add `status` to `SaveSiteInput` and `SaveAssessmentInput`

New functions:
```typescript
markSiteComplete(id: string): Promise<void>
  // UPDATE sites SET status='Completed', updated_at=now() WHERE id=?

markAssessmentComplete(id: string): Promise<void>
  // UPDATE rooftop_assessments SET status='Completed', updated_at=now() WHERE id=?

getSitesForSync(): Promise<Site[]>
  // SELECT WHERE status='Completed' AND sync_status != 'synced' AND deleted_at IS NULL

getAssessmentsForSync(siteId: string): Promise<RooftopAssessment[]>
  // SELECT WHERE site_id=? AND status='Completed' AND sync_status != 'synced'

updateSiteServerIds(localId: string, serverId: string): Promise<void>
updateAssessmentServerIds(localId: string, serverId: string): Promise<void>
setSiteSynced(localId: string): Promise<void>
setAssessmentSynced(localId: string): Promise<void>
```

### 3.4 New — API Client
**New file: `src/api/apiClient.ts`**

Thin wrapper around `fetch` using credentials stored in SecureStore:
```typescript
// Credentials stored under SecureStore keys:
//   'ss_api_url'  → base URL e.g. https://api.sustainabilitywise.com.au
//   'ss_api_key'  → service account API key sk_ss_live_xxx

const apiClient = {
  async checkPhoto(args: CheckPhotoArgs): Promise<CheckPhotoResult>
  async createUploadSession(args: CreateSessionArgs): Promise<CreateSessionResult>
  async confirmUpload(args: ConfirmArgs): Promise<ConfirmResult>
  async pushSync(payload: PushPayload): Promise<PushResult>
  async pullSync(since: string): Promise<PullResult>
}

// All methods:
//   - Add Authorization: Bearer <key> header
//   - On 401: throw AuthError (triggers logout flow)
//   - On network error: throw NetworkError (triggers retry)
//   - On 4xx/5xx: throw ApiError with status + message
```

### 3.5 New — Upload Queue Repository
**New file: `src/repositories/uploadQueueRepository.ts`**

```typescript
async enqueuePhotosForSite(siteId: string): Promise<void>
  // Collects all local photo URIs from:
  //   sites.appendix_items[].uri (type='image')
  //   rooftop_assessments: aerial_photo_uri, msb_photo_uri, additional_photos[],
  //     other_considerations[].photoUris[], switchboards[].photoUri
  // INSERT OR IGNORE INTO photo_upload_queue (id, entity_type, entity_local_id,
  //   field_name, local_uri, status='pending', created_at)
  // Skips if already in queue (ON CONFLICT DO NOTHING)
  // Skips if local_uri is null/empty

async getNextPending(): Promise<UploadQueueRow | null>
  // SELECT ... WHERE status='pending' ORDER BY created_at LIMIT 1

async markUploading(id: string, sessionId: string): Promise<void>
async markUploaded(id: string, remoteUrl: string, onedriveItemId: string): Promise<void>
async markCleared(id: string): Promise<void>
async markFailed(id: string, error: string): Promise<void>
  // Increments attempts, sets last_error, resets to 'pending' if attempts < 5
  // Sets status='failed' if attempts >= 5

async getQueueStats(siteId?: string): Promise<{ pending: number, uploading: number, failed: number, total: number }>
async resetFailedForRetry(siteId?: string): Promise<void>
  // Resets status='pending', clears attempts for 'failed' items
```

After a photo is confirmed uploaded, its `remote_url` must be written back into the entity:

```typescript
async applyRemoteUrlToEntity(
  entityType: string, entityLocalId: string, fieldName: string, remoteUrl: string
): Promise<void>
  // e.g. if entityType='rooftop_assessment' and fieldName='aerial_photo_uri':
  //   UPDATE rooftop_assessments SET aerial_photo_uri=remoteUrl WHERE id=entityLocalId
  // For array fields like 'additional_photos[2]':
  //   Fetch the JSON array, replace index, write back
  // After update: if all photos for this entity are uploaded, update sync_status='pending'
```

### 3.6 New — Sync Service
**New file: `src/services/syncService.ts`**

```typescript
export type SyncProgress = {
  phase: 'idle' | 'queuing' | 'uploading' | 'pushing' | 'done' | 'error'
  uploaded: number
  total: number
  failedCount: number
  lastError?: string
}

export async function runSync(
  onProgress: (p: SyncProgress) => void
): Promise<void> {
  // 1. Get all completed, unsynced sites
  const sites = await getSitesForSync();
  if (sites.length === 0) return;

  // 2. Enqueue all photos (idempotent — skips already-queued)
  onProgress({ phase: 'queuing', ... });
  for (const site of sites) {
    await enqueuePhotosForSite(site.id);
  }

  // 3. Process upload queue one photo at a time
  onProgress({ phase: 'uploading', ... });
  let row: UploadQueueRow | null;
  while ((row = await getNextPending()) !== null) {
    await processOneUpload(row, onProgress);
  }

  // 4. If any failed: surface error, stop
  const stats = await getQueueStats();
  if (stats.failed > 0) {
    onProgress({ phase: 'error', failedCount: stats.failed });
    return;
  }

  // 5. Push SQL data for each completed site
  onProgress({ phase: 'pushing', ... });
  for (const site of sites) {
    const assessments = await getAssessmentsForSync(site.id);
    const result = await apiClient.pushSync({ sites: [site], assessments });
    await updateSiteServerIds(site.id, result.siteIds[site.id]);
    for (const a of assessments) {
      await updateAssessmentServerIds(a.id, result.assessmentIds[a.id]);
    }
    await setSiteSynced(site.id);
    for (const a of assessments) await setAssessmentSynced(a.id);
  }

  onProgress({ phase: 'done', ... });
}

async function processOneUpload(
  row: UploadQueueRow,
  onProgress: (p: SyncProgress) => void
): Promise<void> {
  try {
    // 1. Compute checksum
    const fileInfo = await FileSystem.getInfoAsync(row.local_uri, { size: true });
    if (!fileInfo.exists) { await markFailed(row.id, 'File missing'); return; }
    const bytes = await FileSystem.readAsStringAsync(row.local_uri, { encoding: 'base64' });
    const checksum = sha256FromBase64(bytes);

    // 2. Deduplication check
    const check = await apiClient.checkPhoto({ checksum, ... });
    if (check.exists) {
      await markUploaded(row.id, check.remoteUrl!, '');
      await applyRemoteUrlToEntity(row.entity_type, row.entity_local_id, row.field_name, check.remoteUrl!);
      await FileSystem.deleteAsync(row.local_uri, { idempotent: true });
      await markCleared(row.id);
      return;
    }

    // 3. Create OneDrive upload session
    const session = await apiClient.createUploadSession({
      checksum, siteId: row.site_id, assessmentId: row.assessment_id,
      fieldName: row.field_name, filename: row.local_uri.split('/').pop()!,
      fileSizeBytes: fileInfo.size!
    });
    await markUploading(row.id, session.sessionId);

    // 4. Chunked upload directly to OneDrive upload URL (no auth needed)
    await uploadInChunks(session.uploadUrl, row.local_uri, fileInfo.size!);

    // 5. Confirm with API server
    const confirm = await apiClient.confirmUpload({
      sessionId: session.sessionId, checksum
    });

    // 6. Write remote URL back to entity, delete local file
    await applyRemoteUrlToEntity(row.entity_type, row.entity_local_id, row.field_name, confirm.remoteUrl);
    await FileSystem.deleteAsync(row.local_uri, { idempotent: true });
    await markUploaded(row.id, confirm.remoteUrl, confirm.onedriveItemId);
    await markCleared(row.id);

  } catch (e) {
    await markFailed(row.id, String(e));
  }
}

async function uploadInChunks(
  uploadUrl: string, localUri: string, totalBytes: number
): Promise<void> {
  // Read file in 2 MB slices using expo-file-system position/length
  // PUT each slice with Content-Range: bytes {start}-{end}/{total}
  // On 202: continue; On 200/201: done; On 4xx: throw; On network error: throw for retry
  // Resume: GET uploadUrl → parse 'Range' header → start from next byte
}
```

**Modify: `App.tsx`** — register background fetch:
```typescript
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

const SYNC_TASK = 'sw-background-sync';

TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await runSync(() => {}); // silent background run, no progress UI
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// In App component useEffect:
BackgroundFetch.registerTaskAsync(SYNC_TASK, {
  minimumInterval: 15 * 60,  // 15 minutes
  stopOnTerminate: false,
  startOnBoot: false,
});
```

### 3.7 New — Sync Status Context
**New file: `src/services/SyncStatusContext.tsx`**

```typescript
type SyncStatus = {
  syncing: boolean
  progress: SyncProgress
  lastSyncedAt: string | null    // ISO8601, persisted in AsyncStorage
  triggerSync: () => void
}

export const SyncStatusContext = createContext<SyncStatus>(...);

export function SyncStatusProvider({ children }) {
  // Watches AppState: triggers runSync() when app comes to foreground
  // Runs every 15 min via setInterval while app is open
  // Exposes progress state for banner
}

export const useSyncStatus = () => useContext(SyncStatusContext);
```

**Modify: `App.tsx`** — wrap root with `<SyncStatusProvider>`

### 3.8 New — Sync Status Banner
**New file: `src/components/SyncStatusBanner.tsx`**

Displayed in the header area of the main tab navigator:
```
● Syncing photos — 14 / 47             (animated, blue)
✓ Synced · 3 min ago                   (green, fades after 10s)
⚠ 3 photos failed to upload  [Retry]   (amber)
(nothing shown if no completed sites)
```

**Modify: `src/navigation/MainTabNavigator.tsx`**
- Import `useSyncStatus` and `SyncStatusBanner`
- Render `<SyncStatusBanner />` above the tab bar content

### 3.9 Complete Buttons — SiteFormScreen
**Modify: `src/screens/SiteFormScreen.tsx`**

- Add "Mark as Complete" button, visible only when `site.status === 'Draft'`
- On press: show `Alert.alert` confirmation dialog
- On confirm: call `markSiteComplete(site.id)`, then `triggerSync()`
- After complete: form fields become read-only
  (same lock pattern as `ecoaudit-pro/mobile/src/utils/completedAuditLock.ts`)
- Add read-only status badge at top of form: `[DRAFT]` or `[COMPLETED]`

### 3.10 Complete Buttons — AssessmentFormScreen
**Modify: `src/screens/AssessmentFormScreen.tsx`**

- Same pattern as SiteFormScreen: "Mark as Complete" → confirm → `markAssessmentComplete()` → `triggerSync()`
- Fields become read-only after completion

### 3.11 New — Sync Setup Screen
**New file: `src/screens/SyncSetupScreen.tsx`**

Shown on first launch if no API credentials found in SecureStore:
```
Fields:
  API Server URL   (e.g. https://api.sustainabilitywise.com.au)
  API Key          (service account key: sk_ss_live_xxx)

On Save: SecureStore.setItemAsync('ss_api_url', ...) + SecureStore.setItemAsync('ss_api_key', ...)
On Test: apiClient.checkPhoto(dummyChecksum) → show success/failure
```

**Modify: `src/navigation/RootNavigator.tsx`**
- Add `SyncSetupScreen` to navigator
- Show it on first launch if credentials not set (check SecureStore in effect)

**Modify: `src/screens/SettingsScreen.tsx`**
- Add "Sync Configuration" row → navigates to `SyncSetupScreen` (edit mode)
- Show masked API key and server URL if already configured

### 3.12 Diagnostics Screen — Sync Info
**Modify: `src/screens/DiagnosticsScreen.tsx`**

Add new section "Cloud Sync":
```
API Server URL:      api.sustainabilitywise.com.au
Last synced:         28 May 2026, 10:42
Pending uploads:     0
Failed uploads:      0
                     [Run Sync Now]   [Reset Failed]
```

---

## Phase 4 — EcoAudit Pro Server API
> New files in `sustainability-wise-api/`. Reuses auth/OneDrive/PDF infrastructure from Phases 1–2.

### 4.1 EcoAudit Users Routes
**New file: `src/routes/ecoaudit/users.ts`**
Identical shape to `src/routes/solarsense/users.ts` but targets `ea_users`.

### 4.2 EcoAudit Audits Routes
**New file: `src/routes/ecoaudit/audits.ts`**

```
GET    /v1/ecoaudit/audits
POST   /v1/ecoaudit/audits
GET    /v1/ecoaudit/audits/:id
PATCH  /v1/ecoaudit/audits/:id
DELETE /v1/ecoaudit/audits/:id      soft delete
PATCH  /v1/ecoaudit/audits/:id/complete
```

Inspector sees only audits where `created_by_user_id = userId` or
`assigned_inspector_user_id = userId`.

### 4.3 EcoAudit Zones Routes
**New file: `src/routes/ecoaudit/zones.ts`**

```
GET    /v1/ecoaudit/audits/:auditId/zones
POST   /v1/ecoaudit/audits/:auditId/zones
GET    /v1/ecoaudit/audits/:auditId/zones/:id
PATCH  /v1/ecoaudit/audits/:auditId/zones/:id
DELETE /v1/ecoaudit/audits/:auditId/zones/:id
```

`photos` column stored as `TEXT[]` in Postgres (array of remote URLs after sync).

### 4.4 EcoAudit Equipment Routes × 9
**New files in `src/routes/ecoaudit/equipment/`:**

```
mainSwitchboards.ts
additionalSwitchboards.ts
hvacUnits.ts
lightingSystems.ts
solarPv.ts
forkliftChargers.ts
hotWaterSystems.ts
generalWater.ts
generalElectricity.ts
```

Each file registers:
```
GET    /v1/ecoaudit/audits/:auditId/zones/:zoneId/{type}
POST   /v1/ecoaudit/audits/:auditId/zones/:zoneId/{type}
GET    /v1/ecoaudit/audits/:auditId/zones/:zoneId/{type}/:id
PATCH  /v1/ecoaudit/audits/:auditId/zones/:zoneId/{type}/:id
DELETE /v1/ecoaudit/audits/:auditId/zones/:zoneId/{type}/:id   (soft delete)
```

All photo URL fields (`photo`, `extra_photos[]`, named photo fields) stored/returned as remote URLs.

**New file: `src/routes/ecoaudit/equipment/index.ts`**
Registers all 9 equipment route files under the parent prefix.

### 4.5 EcoAudit Photo Routes
**New file: `src/routes/ecoaudit/photos.ts`**

```
GET  /v1/ecoaudit/audits/:auditId/photos
  Flat list of all photos for audit from photo_registry
  Grouped by: zone → equipment type → item → field

GET  /v1/ecoaudit/audits/:auditId/photos/export
  Streams ZIP with original-quality photos
  Folder structure:
    zones/{zone_name}/
      zone-photos/
      main-switchboards/{name}/
      hvac-units/{name}/
      ... (9 types)

DELETE /v1/ecoaudit/photos/:photoId
  Deletes from OneDrive + photo_registry row
```

### 4.6 EcoAudit Sync Routes
**New file: `src/routes/ecoaudit/sync.ts`**

Same three upload endpoints as SolarSense (`check-photo`, `create-upload-session`, `confirm-upload`)
targeting EcoAudit OneDrive paths. Plus:

```
POST /v1/ecoaudit/sync/push
  Body: {
    audit: Audit,
    zones: Zone[],
    equipment: {
      mainSwitchboards:       MainSwitchboard[],
      additionalSwitchboards: AdditionalSwitchboard[],
      hvacUnits:              HVACUnit[],
      lightingSystems:        LightingSystem[],
      solarPv:                SolarPV[],
      forkliftChargers:       ForkliftCharger[],
      hotWaterSystems:        HotWaterSystem[],
      generalWater:           GeneralWater[],
      generalElectricity:     GeneralElectricity[]
    }
  }
  Gate: audit.status must be 'Completed'
  Logic: upsert all in a single DB transaction
  Response: {
    auditServerId:   string,
    zoneIds:         Record<localId, serverId>,
    equipmentIds: {
      mainSwitchboards: Record<localId, serverId>,
      ... (all 9 types)
    }
  }

GET /v1/ecoaudit/sync/pull?since=ISO8601&auditId=optional
  Returns delta of all audit + zone + equipment records updated since timestamp
```

### 4.7 EcoAudit PDF Route
**New file: `src/routes/ecoaudit/pdf.ts`**

```
POST /v1/ecoaudit/audits/:auditId/report/pdf
  Body: { config: ReportConfig, mode: 'by-equipment' | 'by-zone' }
  Logic:
    1. Fetch ea_audits + ea_zones + all 9 equipment tables for auditId
    2. For each onedrive_item_id in photo fields: getShortLivedDownloadUrl()
    3. Build template data (matches structure expected by ecoaudit.html template)
    4. renderPdf(html) → Buffer
    5. Upload to OneDrive: eaReportPdfPath(auditId)
    6. UPDATE ea_audits SET report_pdf_remote_url = ...
    7. Stream PDF (Content-Type: application/pdf)
```

---

## Phase 5 — EcoAudit Pro Mobile Changes
> Modifications to `ecoaudit-pro/mobile/`. Requires Phase 4 API to be deployed.

### 5.1 DB Migration — Upload Queue Enhancements
**Modify: `src/database/migrations.ts`**

EcoAudit's existing `photo_upload_queue` is missing: `attempts`, `last_error`, `checksum`,
`session_id`, `onedrive_item_id`, `cleared_at`.

Add `MIGRATION_3` (after existing migration 2 which adds `admin_config`):
```sql
ALTER TABLE photo_upload_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photo_upload_queue ADD COLUMN last_error TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN onedrive_item_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
```

**Modify: `src/constants/version.ts`** — bump `DB_VERSION`

### 5.2 New — API Client
**New file: `src/api/apiClient.ts`**

Same shape as SolarSense version but:
- SecureStore keys: `'ea_api_url'` and `'ea_api_key'`
- Push payload includes all 9 equipment arrays
- Endpoints target `/v1/ecoaudit/…`

### 5.3 New — Upload Queue Repository
**New file: `src/repositories/uploadQueueRepository.ts`**

`enqueuePhotosForAudit(auditId)` must collect every photo URI across all tables:
```
zones.photos[]
main_switchboards:        photo, extra_photos[]
additional_switchboards:  photo, extra_photos[]
hvac_units:               photo, nameplate_photos, indoor_unit_nameplate_photo,
                          controller_photo, extra_photos[]
lighting_systems:         photo, fixtures_photo, mounting_constraints_photo,
                          sensors_photo, extra_photos[]
solar_pv:                 roof_photo, inverter_label_photo, electricity_meter_photo,
                          additional_solar_space_photo, switchboard_photo, extra_photos[]
forklift_chargers:        charger_photo, charger_label_photo, electric_connection_photo,
                          charger_space_photo, socket_connection_photo, extra_photos[]
hot_water_systems:        photo, additional_photo, extra_photos[]
general_water:            photos[], extra_photos[]
general_electricity:      photos[], extra_photos[]
```

`applyRemoteUrlToEntity` must handle all named photo fields + index-based array entries.

All other queue functions (`getNextPending`, `markUploading`, `markUploaded`, `markCleared`,
`markFailed`, `getQueueStats`, `resetFailedForRetry`) identical to SolarSense version.

### 5.4 New — Sync Service
**New file: `src/services/syncService.ts`**

Same algorithm as SolarSense `syncService.ts`. Key difference in step 5:
```typescript
// Push payload is larger — collect from 11 repository files
const pushPayload = {
  audit: await getAudit(auditId),
  zones: await getZones(auditId),
  equipment: {
    mainSwitchboards:       await getMainSwitchboards(auditId),
    additionalSwitchboards: await getAdditionalSwitchboards(auditId),
    hvacUnits:              await getHVACUnits(auditId),
    lightingSystems:        await getLightingSystems(auditId),
    solarPv:                await getSolarPV(auditId),
    forkliftChargers:       await getForkliftChargers(auditId),
    hotWaterSystems:        await getHotWaterSystems(auditId),
    generalWater:           await getGeneralWater(auditId),
    generalElectricity:     await getGeneralElectricity(auditId),
  }
};
```

**Modify: `App.tsx`** — register background fetch task (identical to SolarSense 3.6)

### 5.5 New — Sync Status Context + Banner
**New files:**
- `src/services/SyncStatusContext.tsx` — identical shape to SolarSense version
- `src/components/SyncStatusBanner.tsx` — identical to SolarSense version

**Modify: `App.tsx`** — wrap root with `<SyncStatusProvider>`

**Modify: `src/navigation/MainTabNavigator.tsx`** — render `<SyncStatusBanner />` in header

### 5.6 Wire Sync to Audit Completion
**Modify: `src/screens/AuditScreen.tsx`**

EcoAudit already has a "Mark as Completed" button that calls `completeAudit()`.
Add `triggerSync()` call immediately after:
```typescript
await completeAudit(auditId);
triggerSync();   // from useSyncStatus()
```

The existing `completedAuditLock.ts` already makes fields read-only — no change needed there.

### 5.7 New — Sync Setup Screen
**New file: `src/screens/SyncSetupScreen.tsx`**

Same as SolarSense version; SecureStore keys: `ea_api_url`, `ea_api_key`.

**Modify: `src/navigation/RootNavigator.tsx`** — add `SyncSetupScreen`

**Modify: `src/screens/SettingsScreen.tsx`** — add "Sync Configuration" row

### 5.8 Diagnostics Screen — Sync Info
**Modify: `src/screens/DiagnosticsScreen.tsx`**

Add "Cloud Sync" section identical to SolarSense 3.12.

---

## Phase 6 — PDF Service
> Puppeteer configuration + HTML templates. Runs on the same droplet.

### 6.1 Puppeteer Renderer
**New file: `src/pdf/renderer.ts`**

```typescript
import puppeteer, { Browser } from 'puppeteer-core';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH!,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',     // Required on Linux servers
        '--disable-software-rasterizer',
      ],
      headless: true,
    });
  }
  return browser;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1.8cm', bottom: '1.8cm', left: '1.8cm', right: '1.8cm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
```

### 6.2 SolarSense PDF Template
**New file: `src/pdf/templates/solarsense.html`**

- Ported from `solarsense-mobile/src/pdf/generateSitePackPdf.ts`
- All `esc()` / `field()` helper output is pre-rendered server-side before injection
- Montserrat font embedded as base64 `@font-face` (no network call during render)
- SolarSense brand colours from `solarsense-mobile/src/theme/colors.ts`
- Images: `<img src="{{ONEDRIVE_URL}}" style="max-width:100%;object-fit:contain">`
- Uses the same viability badge, deal-breaker flag, and RAG colour logic

### 6.3 EcoAudit PDF Template
**New file: `src/pdf/templates/ecoaudit.html`**

- Ported from `ecoaudit-pro/mobile/src/pdf/generateAuditPdf.ts`
- Brand: dark blue `#162A4E`, green `#79B44A`, A4, 1.8 cm margins
- `EXACT_BRAND_LOGO_DATA_URI` from `ecoaudit-pro/mobile/src/pdf/brandLogoDataUri.ts` embedded directly
- All 10 report sections, same section visibility logic as the mobile app
- By-Equipment and By-Zone layout both supported (controlled by `mode` param)

### 6.4 Large PDF Guard
In both PDF routes (Phase 2.7 and 4.7):
```typescript
if (pdfBuffer.length > 50 * 1024 * 1024) {
  return reply.status(413).send({
    error: 'PDF too large to generate server-side',
    actualSizeBytes: pdfBuffer.length,
    suggestion: 'Reduce the number of included sections or equipment items'
  });
}
```

---

## Phase 7 — API Documentation

### 7.1 Route Schema Completeness
Every route in Phases 1–4 must include a Fastify schema object:
```typescript
schema: {
  tags: ['SolarSense / Sites'],
  summary: 'Create a new site',
  description: 'Creates a site record. Returns the server-assigned ID.',
  security: [{ bearerAuth: [] }],
  body: zodToJsonSchema(CreateSiteSchema),
  response: {
    200: zodToJsonSchema(SiteSchema),
    400: zodToJsonSchema(ErrorSchema),
    401: zodToJsonSchema(ErrorSchema),
    403: zodToJsonSchema(ErrorSchema),
  }
}
```

### 7.2 Swagger UI Config
In `src/app.ts`:
```typescript
await app.register(fastifySwagger, {
  openapi: {
    info: { title: 'Sustainability Wise API', version: '1.0.0',
            description: 'Unified API for EcoAudit Pro and SolarSense' },
    servers: [{ url: 'https://api.sustainabilitywise.com.au' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT or API Key' }
      }
    }
  }
});

await app.register(fastifySwaggerUi, {
  routePrefix: '/v1/docs',
  uiConfig: { docExpansion: 'list', deepLinking: true },
});

// Protect /v1/docs — apply JWT auth preHandler to the docs route prefix
```

Tag groups for Swagger sidebar:
`Auth`, `API Keys`, `SolarSense/Users`, `SolarSense/Sites`, `SolarSense/Assessments`,
`SolarSense/Photos`, `SolarSense/Sync`, `SolarSense/PDF`,
`EcoAudit/Users`, `EcoAudit/Audits`, `EcoAudit/Zones`, `EcoAudit/Equipment`,
`EcoAudit/Photos`, `EcoAudit/Sync`, `EcoAudit/PDF`

---

## Phase 8 — Deployment & Go-Live

### 8.1 Deploy API Server
```bash
# On the droplet:
git clone git@github.com:org/sustainability-wise-api.git /opt/sw-api
cd /opt/sw-api
npm ci --omit=dev
npx drizzle-kit migrate     # applies all schema migrations
cp .env.example .env        # fill in values
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
pm2 startup                 # install systemd service to survive reboots
```

### 8.2 Enable HTTPS
```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
# Caddy auto-issues Let's Encrypt cert on first request
```

### 8.3 DB Backup Cron
```bash
chmod +x /opt/sw-api/deploy/backup.sh
crontab -e
# Add line: 0 2 * * * /opt/sw-api/deploy/backup.sh >> /var/log/sw-backup.log 2>&1
```

### 8.4 Seed First Admin Users
```bash
# Direct DB insert for the bootstrap admin (before API is up):
psql -U swapi -d sw_production -c "
  INSERT INTO ea_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), 'admin@sustainabilitywise.com.au', '<bcrypt_hash>', 'Admin', 'admin', true, now(), now());
  INSERT INTO ss_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), 'admin@sustainabilitywise.com.au', '<bcrypt_hash>', 'Admin', 'admin', true, now(), now());
"
# Then via API, create service account keys:
POST /v1/api-keys { name: 'EcoAudit Mobile', role: 'service_account', app: 'ecoaudit' }
POST /v1/api-keys { name: 'SolarSense Mobile', role: 'service_account', app: 'solarsense' }
# Copy raw keys → distribute to mobile app SyncSetupScreen
```

### 8.5 Smoke Test Checklist
```
□ POST /v1/auth/login (EcoAudit admin) → access + refresh tokens returned
□ POST /v1/auth/login (SolarSense admin) → access + refresh tokens returned
□ GET  /v1/solarsense/sites → 200, empty array
□ POST /v1/solarsense/sites → site created
□ PATCH /v1/solarsense/sites/:id/complete → status = 'Completed'
□ POST /v1/solarsense/sync/check-photo → { exists: false }
□ POST /v1/solarsense/sync/create-upload-session → { uploadUrl, sessionId }
□ PUT <uploadUrl> with test file in 2 MB chunks → 200/201
□ POST /v1/solarsense/sync/confirm-upload → { remoteUrl }
□ GET  /v1/solarsense/sites/:id/photos → photo listed with remoteUrl
□ POST /v1/solarsense/sites/:id/site-pack/pdf → PDF streams back correctly
□ GET  /v1/solarsense/sites/:id/photos/export → ZIP downloads with correct structure
□ GET  /v1/docs (with JWT) → Swagger UI renders all endpoints
□ Repeat all above for /v1/ecoaudit/...
□ run backup.sh manually → verify .sql.gz appears in OneDrive backups/db/
□ Droplet reboot → pm2 resurrects API within 30 seconds
```

---

## File Count Summary

| Phase | Description | New server files | New mobile files | Modified mobile files |
|---|---|---|---|---|
| 0 | Infrastructure | — | — | — |
| 1 | API Core | 14 | — | — |
| 2 | SolarSense Server | 8 | — | — |
| 3 | SolarSense Mobile | — | 7 | 6 |
| 4 | EcoAudit Server | 14 | — | — |
| 5 | EcoAudit Mobile | — | 6 | 5 |
| 6 | PDF Service | 3 | — | — |
| 7 | API Docs | 0 (inline) | — | — |
| 8 | Deployment | 3 | — | — |
| **Total** | | **42 server files** | **13 mobile files** | **11 mobile files** |

---

## Build Order

```
Phase 0 (infra)
  └─→ Phase 1 (core)
        ├─→ Phase 2 (SS server) ──→ Phase 3 (SS mobile)
        └─→ Phase 4 (EA server) ──→ Phase 5 (EA mobile)
              ↓
        Phase 6 (PDF — can overlap with 2 + 4)
        Phase 7 (docs — inline, no separate step)
        Phase 8 (deploy — after all phases)
```
