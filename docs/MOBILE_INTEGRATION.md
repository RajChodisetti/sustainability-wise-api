# Mobile Integration Guide

All changes required in `solarsense-mobile/` and `ecoaudit-pro/mobile/` to support cloud sync.

---

## SolarSense Mobile — Changes Summary

### New Files

| File | Purpose |
|---|---|
| `src/api/apiClient.ts` | HTTP client for API server (auth headers, typed responses) |
| `src/repositories/uploadQueueRepository.ts` | All SQL access for photo_upload_queue |
| `src/services/syncService.ts` | Core sync algorithm (push completed records → upload photos → confirm → clear) |
| `src/services/SyncStatusContext.tsx` | React context exposing sync state to all screens |
| `src/components/SyncStatusBanner.tsx` | Header banner showing upload progress / errors |
| `src/screens/SyncSetupScreen.tsx` | First-run screen to enter API URL and key |

### Modified Files

| File | Change |
|---|---|
| `src/database/migrations.ts` | Add MIGRATION_2: status cols + upload queue enhancements |
| `src/constants/version.ts` | Bump DB_VERSION |
| `src/domain/types.ts` | Add `status: 'Draft' \| 'Completed'` to Site + RooftopAssessment |
| `src/repositories/solarSenseRepository.ts` | Add status mappers + sync helper functions |
| `src/screens/SiteFormScreen.tsx` | Add "Mark as Complete" button + read-only lock |
| `src/screens/AssessmentFormScreen.tsx` | Add "Mark as Complete" button + read-only lock |
| `src/screens/SettingsScreen.tsx` | Add "Sync Configuration" row |
| `src/screens/DiagnosticsScreen.tsx` | Add "Cloud Sync" status section |
| `src/navigation/RootNavigator.tsx` | Add SyncSetupScreen to navigator |
| `src/navigation/MainTabNavigator.tsx` | Render SyncStatusBanner in header |
| `App.tsx` | Wrap root with SyncStatusProvider, register BackgroundFetch task |

---

## EcoAudit Pro Mobile — Changes Summary

### New Files

| File | Purpose |
|---|---|
| `src/api/apiClient.ts` | HTTP client (same shape as SS version, targets /v1/ecoaudit/) |
| `src/repositories/uploadQueueRepository.ts` | Queue management — handles all 9 equipment photo fields |
| `src/services/syncService.ts` | Sync algorithm — push payload includes all 9 equipment arrays |
| `src/services/SyncStatusContext.tsx` | React context (identical to SS version) |
| `src/components/SyncStatusBanner.tsx` | Header banner (identical to SS version) |
| `src/screens/SyncSetupScreen.tsx` | First-run API credentials screen |

### Modified Files

| File | Change |
|---|---|
| `src/database/migrations.ts` | Add MIGRATION_3: upload queue enhancements (attempts, checksum, session_id, etc.) |
| `src/constants/version.ts` | Bump DB_VERSION |
| `src/screens/AuditScreen.tsx` | Wire existing "Mark as Completed" button to also call triggerSync() |
| `src/screens/SettingsScreen.tsx` | Add "Sync Configuration" row |
| `src/screens/DiagnosticsScreen.tsx` | Add "Cloud Sync" status section |
| `src/navigation/RootNavigator.tsx` | Add SyncSetupScreen |
| `src/navigation/MainTabNavigator.tsx` | Render SyncStatusBanner in header |
| `App.tsx` | Wrap root with SyncStatusProvider, register BackgroundFetch task |

---

## New SQL Migrations

### SolarSense — MIGRATION_2
```sql
ALTER TABLE sites ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE rooftop_assessments ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN storage_provider TEXT DEFAULT 'local_vm';
ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
```

### EcoAudit Pro — MIGRATION_3
```sql
ALTER TABLE photo_upload_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photo_upload_queue ADD COLUMN last_error TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
ALTER TABLE photo_upload_queue ADD COLUMN storage_provider TEXT DEFAULT 'local_vm';
ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
```

---

## Upload Queue Status Lifecycle

The mobile sync service must push completed site/assessment metadata before
creating photo upload sessions. The API rejects upload sessions when the target
site or assessment is missing or still `Draft`.

```
pending
  │
  ├── check-photo returns exists:true  → uploaded (skip upload) → cleared
  │
  └── create-upload-session
        │
        └── uploading
              │
              ├── PUT uploadUrl raw bytes → API stores file on VM
              │
              ├── confirm-upload success → uploaded → cleared
              │
              └── network error → failed (attempts < 5: back to pending after backoff)
                                         (attempts >= 5: stays failed, shown in UI)
```

## Photo Fields Covered Per App

### SolarSense (`rooftop_assessments`)
```
aerial_photo_uri
msb_photo_uri
switchboards[n].photoUri
other_considerations[n].photoUris[]
additional_photos[]
sites.appendix_items[n].uri  (type='image')
```

### EcoAudit Pro (across 9 equipment tables)
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

---

## SecureStore Keys

### SolarSense
| Key | Value |
|---|---|
| `ss_api_url` | API base URL, e.g. `https://api.sustainabilitywise.com.au` |
| `ss_api_key` | Service account API key: `sk_ss_live_xxx` |
| `ss_last_synced_at` | ISO8601 timestamp of last successful sync |

### EcoAudit Pro
| Key | Value |
|---|---|
| `ea_api_url` | API base URL |
| `ea_api_key` | Service account API key: `sk_ea_live_xxx` |
| `ea_last_synced_at` | ISO8601 timestamp |

---

## Sync Trigger Points

| Event | Action |
|---|---|
| App comes to foreground (AppState → active) | `runSync()` |
| Inspector taps "Mark as Complete" | `runSync()` |
| Every 15 minutes while app is open | `runSync()` |
| Background fetch (iOS / Android WorkManager) | `runSync()` (silent, no progress UI) |
| "Run Sync Now" button in DiagnosticsScreen | `runSync()` |
| "Retry" button in SyncStatusBanner | `resetFailedForRetry()` then `runSync()` |

---

## New App Dependencies Required

Both apps need these additional packages:

```bash
npx expo install expo-background-fetch expo-task-manager
```

`expo-crypto` (for SHA-256) and `expo-file-system` are already installed in both apps.
`expo-secure-store` is already installed in both apps (used by authRepository).
