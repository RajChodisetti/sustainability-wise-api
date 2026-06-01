# Phase 3 Delivery — SolarSense Mobile Sync

## What was built

Phase 3 wires `solarsense-mobile` to the Phase 2 API server so completed sites and assessments are automatically backed up to the cloud.

| Area | Files changed |
|---|---|
| DB migration (status columns + upload queue columns) | `src/database/migrations.ts`, `src/constants/version.ts` |
| Domain types (`status` field) | `src/domain/types.ts` |
| Repository (status + 8 new sync functions) | `src/repositories/solarSenseRepository.ts` |
| Upload queue repository | `src/repositories/uploadQueueRepository.ts` _(new)_ |
| API client (talks to Phase 2 server) | `src/api/apiClient.ts` _(new)_ |
| Sync service (queue → upload → push) | `src/services/syncService.ts` _(new)_ |
| Sync status context + provider | `src/services/SyncStatusContext.tsx` _(new)_ |
| Sync status banner (above tab bar) | `src/components/SyncStatusBanner.tsx` _(new)_ |
| Sync setup screen | `src/screens/SyncSetupScreen.tsx` _(new)_ |
| Complete button + read-only mode | `src/screens/SiteFormScreen.tsx`, `src/screens/AssessmentFormScreen.tsx` |
| Sync section in Diagnostics | `src/screens/DiagnosticsScreen.tsx` |
| Sync Configuration row + first-launch redirect | `src/screens/SettingsScreen.tsx` |
| Provider wiring | `App.tsx`, `src/navigation/MainTabNavigator.tsx` |

**Prerequisites:**
- Phase 2 API running at `http://170.64.154.143`
- A SolarSense `service_account` API key — create one:
  ```bash
  TOKEN=$(curl -s -X POST http://170.64.154.143/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@solarsense.com","password":"Admin1234","app":"solarsense"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

  curl -s -X POST http://170.64.154.143/v1/api-keys \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"SolarSense Mobile","role":"service_account"}' | python3 -m json.tool
  ```
  Copy the `key` value (`sk_ss_live_…`) — it is shown only once.

---

## How sync works

```
App foreground / 15-min timer
        │
        ▼
  runSync()
        │
        ├─ 1. Find sites WHERE status='Completed' AND sync_status != 'synced'
        │
        ├─ 2. Enqueue all local photos for those sites (idempotent)
        │
        ├─ 3. For each pending photo:
        │      a. SHA-256 hash the file bytes
        │      b. POST /check-photo  →  if exists, skip upload
        │      c. POST /create-upload-session
        │      d. PUT raw bytes to uploadUrl (no auth header)
        │      e. POST /confirm-upload  →  get remoteUrl
        │      f. Write remoteUrl back to the entity row, delete local file
        │
        ├─ 4. If any photo failed → show error banner, stop
        │
        └─ 5. POST /push  →  server upserts site + assessments, returns serverIds
```

---

## Step-by-step testing guide

### Prerequisites

1. Build and install the app on a device or emulator with the Phase 3 code.
2. The app must be fresh (first install) **or** the local SQLite DB must be on migration v1 so that migration v2 can run. If you are updating an existing install, uninstall first to wipe the DB.

---

### Test 1 — DB migration runs automatically

**Steps:**
1. Install the app and log in.
2. Navigate to **Settings → Developer → Database Diagnostics**.

**Expected:**
- Migration version shows **v2**.
- `sites` and `rooftop_assessments` row counts are present (0 if fresh install).
- `photo_upload_queue` row count is 0.

---

### Test 2 — First-launch sync setup redirect

**Steps:**
1. Open a fresh install (sync not yet configured).
2. Tap the **Settings** tab.

**Expected:**
- The app automatically navigates to **Sync Configuration** screen (no manual tapping required).
- The URL and API key fields are empty.

---

### Test 3 — Configure sync credentials

**Steps:**
1. On the **Sync Configuration** screen, enter:
   - **Server URL:** `http://170.64.154.143`
   - **API Key:** the `sk_ss_live_…` key from prerequisites
2. Tap **Test Connection**.

**Expected:**
- Alert says "Connected" or "Server reachable". No "Network Error" or "Auth Failed".

3. Tap **Save**.

**Expected:**
- Alert says "Saved". Screen dismisses back to Settings.
- Reopening Settings → Sync Configuration shows the saved values (API key is masked — field shows bullets).

---

### Test 4 — New site defaults to Draft

**Steps:**
1. Go to **Site Packs** → create a new site (any name, e.g. "Test Sync Site").
2. Save the site. Open it.

**Expected:**
- A **DRAFT** badge appears at the top of the site form.
- The **Mark as Complete** button is visible below the form fields.

---

### Test 5 — Mark site as Complete → read-only

**Steps:**
1. On the site form, tap **Mark as Complete**.
2. Confirm the alert.

**Expected:**
- Badge changes to **COMPLETED** (green).
- All form fields are no longer editable (tapping them does nothing).
- Save button is gone.
- Mark as Complete button is gone.

---

### Test 6 — Mark assessment as Complete → read-only

**Steps:**
1. Open an assessment under the completed site (or create one first — site must be linked).
2. Tap **Mark as Complete** and confirm.

**Expected:**
- Assessment badge shows **COMPLETED**.
- Form is read-only.
- Save button is gone.

---

### Test 7 — Sync banner appears on foreground resume

**Steps:**
1. Background the app, then bring it to the foreground.

**Expected:**
- A **blue banner** briefly appears above the tab bar saying "Preparing sync…" or "Saving to server…".
- If there are completed unsynced sites with photos, it shows "Syncing photos — X / Y".
- After sync, banner turns **green** showing "Synced · just now".

> If no completed sites exist, the sync is a no-op and the banner may appear and disappear instantly or not appear at all.

---

### Test 8 — Manual sync via Diagnostics

**Steps:**
1. Navigate to **Settings → Developer → Database Diagnostics**.
2. Scroll down to the **Cloud Sync** section.
3. Verify:
   - **Server** shows the configured URL.
   - **Pending uploads** matches the number of local photos attached to completed sites.
4. Tap **Run Sync Now**.

**Expected:**
- Banner goes blue (syncing).
- After sync completes, banner turns green.
- **Last synced** in Diagnostics updates to the current time.
- **Pending uploads** drops to 0.
- **Failed uploads** stays at 0.

---

### Test 9 — Verify data on the server after sync

Run this on your terminal after a sync:

```bash
TOKEN=$(curl -s -X POST http://170.64.154.143/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@solarsense.com","password":"Admin1234","app":"solarsense"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s "http://170.64.154.143/v1/solarsense/sync/pull?since=2020-01-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('sites:', len(d['sites']), '| assessments:', len(d['assessments']))"
```

**Expected:** counts match the number of completed sites and assessments you marked on the device.

---

### Test 10 — Photo deduplication

**Steps:**
1. Complete a site that has at least one photo attached to an assessment.
2. Trigger sync (foreground or manual). Let it finish.
3. Trigger sync a second time immediately.

**Expected:**
- Second sync is instant (no uploading phase) because `check-photo` returns `exists: true` for all photos.
- Banner goes straight to "Saving to server…" then "Synced".

---

### Test 11 — Sync Configuration accessible from Settings

**Steps:**
1. Go to **Settings** (sync already configured).
2. Confirm the app does **not** auto-redirect to Sync Configuration (it only redirects when unconfigured).
3. Tap **Administration → Sync Configuration**.

**Expected:**
- Sync Configuration screen opens with the saved URL and masked API key.

---

### Test 12 — Failed upload recovery

**Steps:**
1. Complete a site with at least one photo.
2. Turn off Wi-Fi / mobile data on the device.
3. Trigger sync (Settings → Diagnostics → Run Sync Now).

**Expected:**
- Banner turns **amber**: "X photo(s) failed to upload" with a **Retry** button.
- Diagnostics shows **Failed uploads** > 0.

4. Re-enable network.
5. Tap **Retry** on the banner (or **Reset Failed & Retry** in Diagnostics).

**Expected:**
- Sync retries, banner goes blue then green.
- Failed uploads resets to 0.

---

## API reference (for manual verification)

**Base URL:** `http://170.64.154.143`

| Endpoint | Method | Notes |
|---|---|---|
| `/v1/solarsense/sync/check-photo` | POST | `{ checksum, siteId, assessmentId?, fieldName }` |
| `/v1/solarsense/sync/create-upload-session` | POST | `{ checksum, siteId, assessmentId?, fieldName, filename, fileSizeBytes }` |
| `/v1/solarsense/sync/upload/:sessionId` | PUT | Raw bytes, no auth header needed |
| `/v1/solarsense/sync/confirm-upload` | POST | `{ sessionId, checksum }` → `{ remoteUrl }` |
| `/v1/solarsense/sync/push` | POST | `{ sites: [...], assessments: [...] }` — all must have `status: 'Completed'` |
| `/v1/solarsense/sync/pull` | GET | `?since=ISO8601&siteId=optional` |

---

## What's NOT in Phase 3

- EcoAudit mobile sync (Phase 5 — depends on Phase 4 EcoAudit server API)
- OneDrive storage (server currently uses VM-local; migration to OneDrive is future work)
- Chunked upload (not needed — server accepts single PUT up to 50 MB)
- Background fetch task (optional enhancement — the 15-min foreground interval covers most cases)
- Pull-to-merge (pull returns raw server records; merging with local drafts is complex and deferred)
