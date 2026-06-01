# Phase 5 Delivery — EcoAudit Mobile Sync

## What was built

Phase 5 wires `ecoaudit-pro/mobile` to the Phase 4 API server. It follows the same pattern as Phase 3 (SolarSense mobile sync) but handles EcoAudit's more complex hierarchy (audit → zones → 9 equipment types).

| File | Purpose |
|---|---|
| `src/constants/syncConfig.ts` _(new)_ | Hardcoded API URL + service account key |
| `src/api/apiClient.ts` _(new)_ | HTTP client for all sync endpoints |
| `src/repositories/uploadQueueRepository.ts` _(new)_ | SQLite queue for pending photo uploads |
| `src/services/syncService.ts` _(new)_ | Orchestrates queue → SHA-256 → upload → push |
| `src/services/SyncStatusContext.tsx` _(new)_ | React context, triggers on foreground + every 15 min |
| `src/components/SyncStatusBanner.tsx` _(new)_ | Banner above tabs: blue (syncing), green (done), amber (error) |
| `src/constants/version.ts` | `DB_VERSION` 6 → 7, `PHASE_LABEL` updated |
| `src/database/migrations.ts` | `MIGRATION_7` adds sync columns to `photo_upload_queue` |
| `App.tsx` | Wrapped with `SyncStatusProvider` |
| `src/navigation/MainTabNavigator.tsx` | `SyncStatusBanner` rendered above tab bar |
| `src/screens/DiagnosticsScreen.tsx` | Cloud Sync section: server URL, last synced, queue stats, Run Sync, Reset Failed |

**Credentials are baked into the build** — no setup screen required. The EcoAudit service account key `sk_ea_live_…` is in `src/constants/syncConfig.ts`.

### Also changed in SolarSense mobile

- `src/constants/syncConfig.ts` _(new)_ — hardcoded SS API URL + key
- `src/api/apiClient.ts` — reads from constants instead of `SecureStore`
- `src/screens/SyncSetupScreen.tsx` — shows pre-configured credentials as read-only; Save button removed
- `src/screens/SettingsScreen.tsx` — first-launch auto-redirect removed (no longer needed)

---

## How sync works (EcoAudit)

```
App foreground / 15-min timer
        │
        ▼
  runSync()
        │
        ├─ 1. Find audits WHERE status='Completed' AND sync_status != 'synced'
        │
        ├─ 2. For each audit: enqueue ALL photos from ALL equipment tables
        │      (zones, 9 equipment types × all photo fields)
        │
        ├─ 3. For each pending photo:
        │      a. SHA-256 hash the file bytes (js-sha256)
        │      b. POST /check-photo → if exists, skip upload
        │      c. POST /create-upload-session
        │      d. PUT raw bytes to uploadUrl (no auth header)
        │      e. POST /confirm-upload
        │      f. Delete local file
        │
        ├─ 4. If any photo failed → show error banner, stop
        │
        └─ 5. POST /v1/ecoaudit/sync/push with full audit hierarchy:
               { audit, zones, mainSwitchboards, additionalSwitchboards,
                 hvacUnits, lightingSystems, solarPv, forkliftChargers,
                 hotWaterSystems, generalWater, generalElectricity }
               → server upserts all records, returns { auditId, serverId }
               → mark audit sync_status = 'synced'
```

---

## Step-by-step testing guide

### Prerequisites

1. Install the app on a device or emulator (`ecoaudit-pro/mobile`).
2. First install or wipe the DB so Migration 7 runs.
3. The API at `http://170.64.154.143` must be reachable from the device.

---

### Test 1 — DB migration v7

1. Open the app and log in.
2. Navigate to **Settings → Developer → Diagnostics**.
**Expected:** Migration version shows **v7**. `photo_upload_queue` row count is 0.

---

### Test 2 — Sync banner on foreground resume

1. Create an audit, add equipment (e.g. an HVAC unit with a photo).
2. Mark the audit as **Completed** using the Mark Complete button (same as Phase 3 flow — the `markAuditComplete` function already existed).
3. Background and foreground the app.
**Expected:** Blue banner "Preparing sync…" then "Saving to server…" then green "Synced · just now".

---

### Test 3 — Manual sync via Diagnostics

1. Go to **Settings → Developer → Diagnostics**.
2. Check **Cloud Sync** section: Server shows `170.64.154.143`, Pending uploads shows count.
3. Tap **Run Sync Now**.
**Expected:** Banner appears, uploads process, Pending drops to 0, Last synced updates.

---

### Test 4 — Verify pushed audit on server

```bash
TOKEN=$(curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecoaudit.com","password":"Admin1234","app":"ecoaudit"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s "http://170.64.154.143/v1/ecoaudit/sync/pull?since=2020-01-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('audits on server:', len(d['audits']))"
```
**Expected:** Audit count matches the number you completed and synced from the device.

---

### Test 5 — Photo deduplication

1. Complete and sync an audit with at least one photo.
2. Trigger sync a second time (foreground the app again).
**Expected:** Second sync skips the upload phase — banner goes straight to "Saving to server…" because `check-photo` returns `exists: true`.

---

### Test 6 — Failed upload recovery

1. Complete an audit with photos.
2. Turn off Wi-Fi/mobile data.
3. Trigger sync (Diagnostics → Run Sync Now).
**Expected:** Amber banner "X photo(s) failed to upload". Diagnostics shows **Failed uploads > 0**.

4. Re-enable network. Tap **Retry** on the banner or **Reset Failed & Retry** in Diagnostics.
**Expected:** Sync completes, banner turns green.

---

### Test 7 — SolarSense: credentials are pre-configured

1. Open SolarSense mobile → **Settings → Administration → Sync Configuration**.
**Expected:** Screen shows the server URL and a masked API key. Both fields are non-editable. No Save button. A Test Connection button is present.

---

## API keys baked into each build

| App | File | Key prefix |
|---|---|---|
| EcoAudit Pro | `src/constants/syncConfig.ts` | `sk_ea_live_10cc09a7…` |
| SolarSense | `src/constants/syncConfig.ts` | `sk_ss_live_fa824d04…` |

To rotate a key: create a new `service_account` key via the admin API, update the constant, rebuild.
