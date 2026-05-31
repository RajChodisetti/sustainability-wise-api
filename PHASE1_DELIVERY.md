# Phase 1 Delivery — API Core

**GitHub:** https://github.com/RajChodisetti/sustainability-wise-api  
**Server IP:** 170.64.154.143  
**Base URL:** `http://170.64.154.143` (HTTP until domain + HTTPS is configured)

---

## What's included

| Area | Detail |
|---|---|
| JWT authentication | Login → access token (15 min) + refresh token (30 days, rolling, stored in DB) |
| API key authentication | `sk_ea_live_*` / `sk_ss_live_*` prefix-based, bcrypt-hashed in DB |
| Auth middleware | Bearer token accepted as JWT _or_ API key; app namespace isolation |
| Role hierarchy | `inspector < service_account < admin` |
| Routes | `/v1/auth` (login, refresh, logout, me), `/v1/api-keys` (list, create, revoke) |
| Database | 18-table PostgreSQL schema, auto-migrated at startup |
| Swagger UI | `http://170.64.154.143/v1/docs` (public, lists all routes) |
| Health check | `GET /health` (public, no auth) |
| Deploy | PM2 process manager, Caddy reverse proxy, daily pg_dump backup script |

---

## Prerequisites — deploy to server first

These steps must be done on the droplet before testing. If the server was already set up in Phase 0, start from step 3.

### 1. Clone the repo
```bash
ssh root@170.64.154.143
git clone https://github.com/RajChodisetti/sustainability-wise-api.git /opt/sw-api
cd /opt/sw-api
npm install
```

### 2. Create `.env`
```bash
cp .env.example .env
nano .env
```

Fill in every value:
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://swapi:passw
JWT_SECRET=d3f456f33ef2f8bc3ea14a954a85d55ee35f37a79dfbfb4c510024aae6fe5b23
JWT_REFRESH_SECRET=90d8d89c6df1fdcb63828837a6bab9ac865321d338959e97f31ef3ab931be8e7
# Azure fields can be left blank for Phase 1 — not used yet
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
ONEDRIVE_USER_EMAIL=
PUPPETEER_EXECUTABLE_PATH=
```

### 3. Run database migration
```bash
npm run db:migrate
```
Expected output: `Running migrations...` then `Migrations complete.` (or "No migrations to run" if already applied).

### 4. Start the server with PM2
```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

### 5. Start Caddy
```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

---

## Testing guide

All examples use `curl`. Replace `170.64.154.143` with `localhost:3000` if testing from the droplet directly.

---

### Test 1 — Health check (no auth)

```bash
curl http://170.64.154.143/health
```

**Expected:**
```json
{"status":"ok","uptime":12}
```

---

### Test 2 — Create your first admin user

There is no sign-up endpoint (users are created by admins). For the very first user, insert directly into the database.

```bash
# On the droplet:
cd /opt/sw-api

# Generate a bcrypt hash of the password "Admin1234"
node --import tsx/esm -e "
import { hashPassword } from './src/auth/apiKey.js';
const h = await hashPassword('Admin1234');
console.log(h);
"
```

Copy the printed hash, then insert the user:

```bash
psql -U swapi -d sw_production -c "
INSERT INTO ea_users (email, password_hash, full_name, role)
VALUES ('admin@ecoaudit.com', '$2b$10$eBAb9HeVIKn4zPlmzVEv.OjW4qtZRzsamxSBOd1NugKgiVWDZT8eW', 'Admin User', 'admin');
"
```

Repeat for SolarSense if desired (table is `ss_users`).

---

### Test 3 — Login (EcoAudit)

```bash
curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecoaudit.com","password":"Admin1234","app":"ecoaudit"}' | jq
```

**Expected:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": 1,
    "email": "admin@ecoaudit.com",
    "fullName": "Admin User",
    "role": "admin",
    "app": "ecoaudit"
  }
}
```

Save the `accessToken` value for subsequent tests:
```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIwMTdjODk0ZS00YWFlLTQ5NjMtOGVkZi0wZjVkZWVjNWMxNTciLCJhcHAiOiJlY29hdWRpdCIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4MDAwMzYyNSwiZXhwIjoxNzgwMDA0NTI1fQ.PmirQkKO2QBg4LK2N8nUTZF5ylEuzjd0_fR4Q8QekKA"   # paste your access token here
```

---

### Test 4 — Get current user (`/me`)

```bash
curl -s http://170.64.154.143/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:**
```json
{"id":1,"email":"admin@ecoaudit.com","fullName":"Admin User","role":"admin","app":"ecoaudit"}
```

---

### Test 5 — Refresh token

```bash
REFRESH="eyJ..."   # paste your refreshToken here

curl -s -X POST http://170.64.154.143/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH\",\"app\":\"ecoaudit\"}" | jq
```

**Expected:** new `accessToken` + `refreshToken` pair. The old refresh token is now invalid (rolling).

---

### Test 6 — Logout

```bash
curl -s -X POST http://170.64.154.143/v1/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"refreshToken\":\"$REFRESH\"}" | jq
```

**Expected:**
```json
{"ok":true}
```

After logout, the refresh token is revoked. Using it again returns 401.

---

### Test 7 — Create an API key

```bash
curl -s -X POST http://170.64.154.143/v1/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"EcoAudit Mobile App"}' | jq
```

**Expected:**
```json
{
  "id": 1,
  "name": "EcoAudit Mobile App",
  "key": "sk_ea_live_...",
  "prefix": "sk_ea_live_",
  "app": "ecoaudit",
  "role": "service_account",
  "createdAt": "..."
}
```

> **Important:** copy the `key` value now — it is only shown once and cannot be retrieved later.

```bash
API_KEY="sk_ea_live_..."
```

---

### Test 8 — Authenticate with an API key

API keys work anywhere a Bearer token is accepted:

```bash
curl -s http://170.64.154.143/v1/auth/me \
  -H "Authorization: Bearer $API_KEY" | jq
```

**Expected:**
```json
{"id":null,"email":null,"fullName":"EcoAudit Mobile App","role":"service_account","app":"ecoaudit"}
```

---

### Test 9 — List API keys

```bash
curl -s http://170.64.154.143/v1/api-keys \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:** array of keys (raw value not included), with pagination meta.

---

### Test 10 — Revoke an API key

```bash
KEY_ID=1   # from list or create response

curl -s -X DELETE http://170.64.154.143/v1/api-keys/$KEY_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:**
```json
{"ok":true}
```

After revocation, using the raw key returns 401.

---

### Test 11 — App namespace isolation

An EcoAudit admin cannot use a SolarSense endpoint and vice versa. Create a SolarSense user and log in:

```bash
curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@solarsense.com","password":"Admin1234","app":"solarsense"}' | jq
```

Save the SolarSense token as `SS_TOKEN`. Then attempt to call an EcoAudit-specific route with that token — for Phase 2+ routes tagged `requireApp('ecoaudit')`, the response will be:
```json
{"error":"Forbidden","statusCode":403}
```

---

### Test 12 — Swagger UI

Open in a browser: `http://170.64.154.143/v1/docs`

You should see the interactive OpenAPI docs for all routes. You can use the "Authorize" button and paste a JWT or API key to try endpoints directly from the browser.

---

### Test 13 — Wrong password returns 401

```bash
curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecoaudit.com","password":"wrongpassword","app":"ecoaudit"}' | jq
```

**Expected:**
```json
{"error":"Invalid credentials","statusCode":401}
```

---

### Test 14 — Missing Bearer token returns 401

```bash
curl -s http://170.64.154.143/v1/auth/me | jq
```

**Expected:**
```json
{"error":"Unauthorized","statusCode":401}
```

---

### Test 15 — Inspector cannot create API keys (role check)

Create an inspector user, log in, attempt `POST /v1/api-keys`:

```bash
curl -s -X POST http://170.64.154.143/v1/api-keys \
  -H "Authorization: Bearer $INSPECTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}' | jq
```

**Expected:**
```json
{"error":"Forbidden","statusCode":403}
```

---

## PM2 operations cheatsheet

```bash
pm2 status          # check sw-api is online
pm2 logs sw-api     # tail application logs
pm2 restart sw-api  # restart after a code update
pm2 stop sw-api     # stop (does not disable autostart)
```

## Deploy a code update

```bash
cd /opt/sw-api
git pull origin main
npm install          # if package.json changed
npm run db:migrate   # if new migrations exist
pm2 restart sw-api
```

---

## What's next — Phase 2

Phase 2 delivers the SolarSense server-side API:
- `GET/POST/PUT/DELETE /v1/solarsense/sites`
- `GET/POST/PUT/DELETE /v1/solarsense/assessments`
- `POST /v1/solarsense/photos/initiate` — OneDrive upload session (requires Azure AD setup)
- `POST /v1/solarsense/photos/confirm` — register completed upload
- `GET /v1/solarsense/sync` — full data sync payload for mobile app
- `POST /v1/solarsense/reports/:id` — server-side PDF generation

**Prerequisite for Phase 2:** Azure AD app registration to get `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` — this unlocks OneDrive API access for photo storage.
