# Phase 4 Delivery — EcoAudit Server API

## What was built

Phase 4 implements all EcoAudit server routes that were previously empty stubs.

| Area | Routes |
|---|---|
| Users | `GET/POST /v1/ecoaudit/users`, `GET/PATCH/DELETE /v1/ecoaudit/users/:id` |
| Audits | `GET/POST /v1/ecoaudit/audits`, `GET/PATCH/DELETE/PATCH(complete) /v1/ecoaudit/audits/:id` |
| Zones | `GET/POST /v1/ecoaudit/audits/:id/zones`, `GET/PATCH/DELETE /v1/ecoaudit/zones/:id` |
| Main switchboards | `GET/POST /audits/:id/main-switchboards`, `GET/PATCH/DELETE /main-switchboards/:id` |
| Additional switchboards | Same pattern |
| HVAC units | Same pattern |
| Lighting systems | Same pattern |
| Solar PV | Same pattern |
| Forklift chargers | Same pattern |
| Hot water systems | Same pattern |
| General water | Same pattern |
| General electricity | Same pattern |
| Photos | `GET /audits/:id/photos`, `GET /audits/:id/photos/export` (ZIP), `DELETE /photos/:id` |
| Sync | `POST /sync/check-photo`, `POST /sync/create-upload-session`, `PUT /sync/upload/:sessionId`, `POST /sync/confirm-upload`, `POST /sync/push`, `GET /sync/pull` |
| PDF | `POST /audits/:id/site-pack/pdf` |

**Server:** `http://170.64.154.143` · **Auth:** Bearer token (JWT or API key with `ecoaudit` app namespace)

---

## Phase 4 Inconsistencies Found During Testing

### Issue 1 — `zoneId` missing returns 404 instead of 400
**File:** All 9 equipment POST routes (e.g. `src/routes/ecoaudit/equipment/mainSwitchboards.ts`)
**Symptom:** If `body.zoneId` is not provided, the call to `assertFound(null, 'zoneId')` returns `404 "zoneId not found"`.
**Expected:** `400 Bad Request` — missing `zoneId` is a client validation error.
**Fix:** Replace with `throw badRequest('zoneId is required')` when `body.zoneId` is not a string.

### Issue 2 — Sync pull only returns audits (not zones or equipment)
**File:** `src/routes/ecoaudit/sync.ts`
**Symptom:** `GET /v1/ecoaudit/sync/pull` returns `{ audits, pulledAt }` but does not include zones or equipment records.
**Impact:** Admin dashboard views cannot reconstruct the full audit on pull. For Phase 5 mobile sync (push-only), this is acceptable — the mobile device is the source of truth and pull is not needed for the current use case.
**Recommendation:** Extend pull to return the full hierarchy if a multi-device editing flow is required in a future phase.

### Issue 3 — PDF endpoint returns `500` when called without JSON body
**File:** `src/routes/ecoaudit/pdf.ts`
**Symptom:** Same issue as Phase 2 SolarSense PDF — calling without `Content-Type: application/json` causes a null-body crash.
**Fix:** Already applied: `const body = (request.body as { zoneIds?: string[] }) ?? {}`

---

## Step-by-Step Testing Guide

### Prerequisites

Login and save your token:
```bash
TOKEN=$(curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecoaudit.com","password":"Admin1234","app":"ecoaudit"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
```

---

### Test 1 — Create a user
```bash
curl -s -X POST http://170.64.154.143/v1/ecoaudit/users/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"inspector@ecoaudit.com","password":"Inspector123","fullName":"Jane Inspector","role":"inspector"}'
```
**Expected:** `201` with `id`, `role: "inspector"`, `isActive: true`

---

### Test 2 — Create an audit
```bash
AUDIT=$(curl -s -X POST http://170.64.154.143/v1/ecoaudit/audits/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"siteName":"Riverside Factory","siteAddress":"1 River Rd, Parramatta","inspectorName":"Jane Inspector","auditDate":"2026-06-01"}')
AUDIT_ID=$(echo $AUDIT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
```
**Expected:** `201`, `status: "Draft"`

---

### Test 3 — Block status change via PATCH body
```bash
curl -s -X PATCH http://170.64.154.143/v1/ecoaudit/audits/$AUDIT_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"Completed"}'
```
**Expected:** `400 "Use /complete to change status"`

---

### Test 4 — Complete the audit
```bash
curl -s -X PATCH http://170.64.154.143/v1/ecoaudit/audits/$AUDIT_ID/complete \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** `200`, `status: "Completed"`

---

### Test 5 — Create a zone and equipment
```bash
ZONE=$(curl -s -X POST http://170.64.154.143/v1/ecoaudit/audits/$AUDIT_ID/zones \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"zoneName":"Level 1 Production"}')
ZONE_ID=$(echo $ZONE | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s -X POST http://170.64.154.143/v1/ecoaudit/audits/$AUDIT_ID/hvac-units \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"zoneId\":\"$ZONE_ID\",\"unitName\":\"RTU-01\",\"type\":\"Packaged\",\"coolingCapacityKw\":50}"
```
**Expected:** Zone `201`, HVAC `201`

---

### Test 6 — Sync: push completed audit
```bash
curl -s -X POST http://170.64.154.143/v1/ecoaudit/sync/push \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"audit\": {
      \"id\": \"$AUDIT_ID\",
      \"siteName\": \"Riverside Factory\",
      \"siteAddress\": \"1 River Rd, Parramatta\",
      \"inspectorName\": \"Jane Inspector\",
      \"status\": \"Completed\",
      \"createdAt\": \"2026-06-01T00:00:00Z\",
      \"updatedAt\": \"2026-06-01T06:00:00Z\"
    }
  }"
```
**Expected:** `{ auditId: "...", serverId: "..." }`

---

### Test 7 — Sync: push Draft audit is rejected
```bash
curl -s -X POST http://170.64.154.143/v1/ecoaudit/sync/push \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"audit":{"id":"x","siteName":"X","siteAddress":"Y","inspectorName":"Z","status":"Draft","createdAt":"2026-06-01T00:00:00Z","updatedAt":"2026-06-01T00:00:00Z"}}'
```
**Expected:** `400 "Audit must be Completed before sync"`

---

### Test 8 — Sync: pull
```bash
curl -s "http://170.64.154.143/v1/ecoaudit/sync/pull?since=2020-01-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
```
**Expected:** `{ audits: [...], pulledAt: "..." }`

---

### Test 9 — PDF generation
```bash
curl -s -X POST "http://170.64.154.143/v1/ecoaudit/audits/$AUDIT_ID/site-pack/pdf" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' --output /tmp/audit.pdf && echo "PDF saved"
```
**Expected:** Binary PDF file

---

### Test 10 — App namespace isolation
```bash
EA_TOKEN=$(curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecoaudit.com","password":"Admin1234","app":"ecoaudit"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# EA token on SolarSense route → 403
curl -s http://170.64.154.143/v1/solarsense/sites/ -H "Authorization: Bearer $EA_TOKEN"
```
**Expected:** `403 "Wrong application namespace"`

---

## API Keys

| App | Key (truncated) | Role |
|---|---|---|
| EcoAudit Pro Mobile | `sk_ea_live_10cc09a7…b46c` | `service_account` |
| SolarSense Mobile | `sk_ss_live_fa824d04…ad7c` | `service_account` |
