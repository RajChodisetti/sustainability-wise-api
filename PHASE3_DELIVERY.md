# Phase 3 Delivery — SolarSense Mobile Sync

## Overview

This phase wires the `solarsense-mobile` app to the Phase 2 API server so completed sites
and assessments are automatically backed up to the cloud. It involves:

- A local DB migration that adds `status` fields and upload-queue columns
- A new API client that talks to the Phase 2 server
- A new upload queue repository that manages photo uploads
- A sync service that orchestrates the full upload → push → pull flow
- UI additions: complete buttons, sync status banner, sync setup screen

**Prerequisites:**
- Phase 2 API deployed and tested — ✅ running at `http://170.64.154.143`
- A `service_account` API key for the SolarSense mobile app (created via
  `POST /v1/api-keys` as a SolarSense admin, role `service_account`).
  The key will look like `sk_ss_live_…` and is shown only once.

---

## Implementation Steps

### 3.1 DB Migration — Status Fields + Upload Queue Columns

**File: `src/database/migrations.ts`**

Add `MIGRATION_2` immediately after the existing `MIGRATION_1` block:

```typescript
const MIGRATION_2 = `
  ALTER TABLE sites ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
  ALTER TABLE rooftop_assessments ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft';
  ALTER TABLE photo_upload_queue ADD COLUMN checksum TEXT;
  ALTER TABLE photo_upload_queue ADD COLUMN session_id TEXT;
  ALTER TABLE photo_upload_queue ADD COLUMN remote_url TEXT;
  ALTER TABLE photo_upload_queue ADD COLUMN cleared_at TEXT;
`;
```

**File: `src/constants/version.ts`** — bump `DB_VERSION` by 1 to trigger the migration runner.

---

### 3.2 Domain Types — Status Field

**File: `src/domain/types.ts`**

```typescript
export type Site = {
  // ... existing fields ...
  status: 'Draft' | 'Completed';   // ADD
};

export type RooftopAssessment = {
  // ... existing fields ...
  status: 'Draft' | 'Completed';   // ADD
};
```

---

### 3.3 Repository — Status Support

**File: `src/repositories/solarSenseRepository.ts`**

Add `status` to `SiteRow`, `AssessmentRow`, and their mapper functions.
Add `status` to `SaveSiteInput` and `SaveAssessmentInput`.

Add these functions:

```typescript
export async function markSiteComplete(id: string): Promise<void> {
  await db.runAsync(
    `UPDATE sites SET status = 'Completed', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
}

export async function markAssessmentComplete(id: string): Promise<void> {
  await db.runAsync(
    `UPDATE rooftop_assessments SET status = 'Completed', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
}

// Returns completed sites that haven't been synced to the server yet
export async function getSitesForSync(): Promise<Site[]> {
  return db.getAllAsync<SiteRow>(
    `SELECT * FROM sites
     WHERE status = 'Completed'
       AND (sync_status IS NULL OR sync_status != 'synced')
       AND deleted_at IS NULL`
  ).then(rows => rows.map(mapSite));
}

// Returns completed assessments for a site that haven't been synced
export async function getAssessmentsForSync(siteId: string): Promise<RooftopAssessment[]> {
  return db.getAllAsync<AssessmentRow>(
    `SELECT * FROM rooftop_assessments
     WHERE site_id = ?
       AND status = 'Completed'
       AND (sync_status IS NULL OR sync_status != 'synced')`,
    [siteId]
  ).then(rows => rows.map(mapAssessment));
}

export async function updateSiteServerId(localId: string, serverId: string): Promise<void> {
  await db.runAsync(
    `UPDATE sites SET server_id = ?, updated_at = ? WHERE id = ?`,
    [serverId, new Date().toISOString(), localId]
  );
}

export async function updateAssessmentServerId(localId: string, serverId: string): Promise<void> {
  await db.runAsync(
    `UPDATE rooftop_assessments SET server_id = ?, updated_at = ? WHERE id = ?`,
    [serverId, new Date().toISOString(), localId]
  );
}

export async function setSiteSynced(localId: string): Promise<void> {
  await db.runAsync(
    `UPDATE sites SET sync_status = 'synced', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), localId]
  );
}

export async function setAssessmentSynced(localId: string): Promise<void> {
  await db.runAsync(
    `UPDATE rooftop_assessments SET sync_status = 'synced', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), localId]
  );
}
```

---

### 3.4 New — API Client

**New file: `src/api/apiClient.ts`**

Credentials stored in SecureStore under `ss_api_url` and `ss_api_key`.

```typescript
import * as SecureStore from 'expo-secure-store';

export class AuthError extends Error { readonly type = 'auth'; }
export class NetworkError extends Error { readonly type = 'network'; }
export class ApiError extends Error {
  readonly type = 'api';
  constructor(message: string, readonly status: number) { super(message); }
}

async function getCredentials(): Promise<{ baseUrl: string; apiKey: string }> {
  const baseUrl = await SecureStore.getItemAsync('ss_api_url');
  const apiKey  = await SecureStore.getItemAsync('ss_api_key');
  if (!baseUrl || !apiKey) throw new AuthError('Sync not configured');
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  rawBody?: ArrayBuffer,
  headers?: Record<string, string>,
): Promise<T> {
  const { baseUrl, apiKey } = await getCredentials();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...(rawBody
          ? { 'Content-Type': 'image/jpeg' }
          : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: rawBody ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError('API key rejected');
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(text, res.status);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    if (e instanceof AuthError || e instanceof ApiError) throw e;
    throw new NetworkError(String(e));
  }
}

export interface CheckPhotoArgs {
  checksum: string;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
}
export interface CheckPhotoResult {
  exists: boolean;
  remoteUrl?: string;
  fileSizeBytes?: number;
  photoId?: string;
}

export interface CreateSessionArgs {
  checksum: string;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
  filename: string;
  fileSizeBytes: number;
}
export interface CreateSessionResult {
  sessionId: string;
  uploadUrl: string;
  alreadyExists: boolean;
  remoteUrl?: string;
}

export interface ConfirmArgs { sessionId: string; checksum: string; }
export interface ConfirmResult { remoteUrl: string; }

export interface PushResult {
  siteIds: Record<string, string>;
  assessmentIds: Record<string, string>;
}

export interface PullResult {
  sites: unknown[];
  assessments: unknown[];
  pulledAt: string;
}

export const apiClient = {
  checkPhoto: (args: CheckPhotoArgs) =>
    request<CheckPhotoResult>('POST', '/v1/solarsense/sync/check-photo', args),

  createUploadSession: (args: CreateSessionArgs) =>
    request<CreateSessionResult>('POST', '/v1/solarsense/sync/create-upload-session', args),

  // uploadPhoto: PUT raw bytes to the uploadUrl returned by createUploadSession.
  // No auth header needed — the URL is the session token.
  uploadPhoto: async (uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void> => {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: bytes,
    });
    if (!res.ok) throw new ApiError(await res.text().catch(() => res.statusText), res.status);
  },

  confirmUpload: (args: ConfirmArgs) =>
    request<ConfirmResult>('POST', '/v1/solarsense/sync/confirm-upload', args),

  pushSync: (payload: { sites: unknown[]; assessments: unknown[] }) =>
    request<PushResult>('POST', '/v1/solarsense/sync/push', payload),

  pullSync: (since: string, siteId?: string) => {
    const params = new URLSearchParams({ since });
    if (siteId) params.set('siteId', siteId);
    return request<PullResult>('GET', `/v1/solarsense/sync/pull?${params}`);
  },
};
```

---

### 3.5 New — Upload Queue Repository

**New file: `src/repositories/uploadQueueRepository.ts`**

```typescript
import * as FileSystem from 'expo-file-system';
import { db } from '../database/database';

export interface UploadQueueRow {
  id: string;
  entity_type: string;        // 'site' | 'rooftop_assessment'
  entity_local_id: string;
  site_id: string;
  assessment_id: string | null;
  field_name: string;
  local_uri: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'cleared' | 'failed';
  attempts: number;
  last_error: string | null;
  checksum: string | null;
  session_id: string | null;
  remote_url: string | null;
  cleared_at: string | null;
  created_at: string;
}

// Collects all photo URIs from the site and its assessments, inserts into queue.
// Idempotent — ON CONFLICT DO NOTHING.
export async function enqueuePhotosForSite(siteId: string): Promise<void> {
  const site = await db.getFirstAsync<{ appendix_items: string }>(
    `SELECT appendix_items FROM sites WHERE id = ?`, [siteId]
  );
  if (site) {
    const items: Array<{ uri?: string; type?: string }> = JSON.parse(site.appendix_items ?? '[]');
    for (const item of items) {
      if (item.type === 'image' && item.uri) {
        await enqueue(siteId, 'site', siteId, null, 'appendix_item', item.uri);
      }
    }
  }

  const assessments = await db.getAllAsync<{
    id: string;
    aerial_photo_uri: string | null;
    msb_photo_uri: string | null;
    additional_photos: string;
    other_considerations: string;
    switchboards: string;
  }>(`SELECT id, aerial_photo_uri, msb_photo_uri, additional_photos, other_considerations, switchboards
      FROM rooftop_assessments WHERE site_id = ? AND deleted_at IS NULL`, [siteId]);

  for (const a of assessments) {
    if (a.aerial_photo_uri) await enqueue(siteId, 'rooftop_assessment', a.id, a.id, 'aerial_photo_uri', a.aerial_photo_uri);
    if (a.msb_photo_uri)    await enqueue(siteId, 'rooftop_assessment', a.id, a.id, 'msb_photo_uri', a.msb_photo_uri);

    const additionalPhotos: string[] = JSON.parse(a.additional_photos ?? '[]');
    additionalPhotos.forEach((uri, i) => {
      if (uri) enqueue(siteId, 'rooftop_assessment', a.id, a.id, `additional_photos[${i}]`, uri);
    });

    const otherConsiderations: Array<{ photoUris?: string[] }> = JSON.parse(a.other_considerations ?? '[]');
    otherConsiderations.forEach((oc, oi) => {
      (oc.photoUris ?? []).forEach((uri, pi) => {
        if (uri) enqueue(siteId, 'rooftop_assessment', a.id, a.id, `other_considerations[${oi}].photoUris[${pi}]`, uri);
      });
    });

    const switchboards: Array<{ photoUri?: string }> = JSON.parse(a.switchboards ?? '[]');
    switchboards.forEach((sb, si) => {
      if (sb.photoUri) enqueue(siteId, 'rooftop_assessment', a.id, a.id, `switchboards[${si}].photoUri`, sb.photoUri);
    });
  }
}

async function enqueue(
  siteId: string,
  entityType: string,
  entityLocalId: string,
  assessmentId: string | null,
  fieldName: string,
  localUri: string,
): Promise<void> {
  if (!localUri?.startsWith('file://')) return;
  const info = await FileSystem.getInfoAsync(localUri).catch(() => null);
  if (!info?.exists) return;
  await db.runAsync(
    `INSERT OR IGNORE INTO photo_upload_queue
       (id, entity_type, entity_local_id, site_id, assessment_id, field_name, local_uri, status, attempts, created_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [entityType, entityLocalId, siteId, assessmentId, fieldName, localUri, new Date().toISOString()],
  );
}

export async function getNextPending(): Promise<UploadQueueRow | null> {
  return db.getFirstAsync<UploadQueueRow>(
    `SELECT * FROM photo_upload_queue WHERE status = 'pending' ORDER BY created_at LIMIT 1`
  );
}

export async function markUploading(id: string, sessionId: string): Promise<void> {
  await db.runAsync(
    `UPDATE photo_upload_queue SET status = 'uploading', session_id = ? WHERE id = ?`,
    [sessionId, id]
  );
}

export async function markUploaded(id: string, remoteUrl: string): Promise<void> {
  await db.runAsync(
    `UPDATE photo_upload_queue SET status = 'uploaded', remote_url = ? WHERE id = ?`,
    [remoteUrl, id]
  );
}

export async function markCleared(id: string): Promise<void> {
  await db.runAsync(
    `UPDATE photo_upload_queue SET status = 'cleared', cleared_at = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE photo_upload_queue
     SET attempts = attempts + 1,
         last_error = ?,
         status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
     WHERE id = ?`,
    [error, id]
  );
}

export async function getQueueStats(siteId?: string): Promise<{
  pending: number; uploading: number; failed: number; total: number;
}> {
  const where = siteId ? `WHERE site_id = '${siteId.replace(/'/g, "''")}'` : '';
  const row = await db.getFirstAsync<Record<string, number>>(
    `SELECT
       SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'uploading' THEN 1 ELSE 0 END) AS uploading,
       SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
       COUNT(*) AS total
     FROM photo_upload_queue ${where}`
  );
  return {
    pending:   row?.pending   ?? 0,
    uploading: row?.uploading ?? 0,
    failed:    row?.failed    ?? 0,
    total:     row?.total     ?? 0,
  };
}

export async function resetFailedForRetry(siteId?: string): Promise<void> {
  const where = siteId ? `AND site_id = ?` : '';
  await db.runAsync(
    `UPDATE photo_upload_queue
     SET status = 'pending', attempts = 0, last_error = NULL
     WHERE status = 'failed' ${where}`,
    siteId ? [siteId] : []
  );
}

// After upload confirmed, write remote URL back to the entity row.
export async function applyRemoteUrlToEntity(
  entityType: string,
  entityLocalId: string,
  fieldName: string,
  remoteUrl: string,
): Promise<void> {
  const table = entityType === 'rooftop_assessment' ? 'rooftop_assessments' : 'sites';

  // Direct column fields
  const directFields = ['aerial_photo_uri', 'msb_photo_uri', 'appendix_item'];
  if (directFields.includes(fieldName)) {
    await db.runAsync(
      `UPDATE ${table} SET ${fieldName} = ?, updated_at = ? WHERE id = ?`,
      [remoteUrl, new Date().toISOString(), entityLocalId]
    );
    return;
  }

  // Array fields: additional_photos[2], other_considerations[0].photoUris[1], switchboards[0].photoUri
  const arrayFieldMatch = fieldName.match(/^(\w+)\[(\d+)\](.*)$/);
  if (arrayFieldMatch) {
    const [, col, idxStr, rest] = arrayFieldMatch;
    const idx = parseInt(idxStr, 10);
    const row = await db.getFirstAsync<{ val: string }>(`SELECT ${col} AS val FROM ${table} WHERE id = ?`, [entityLocalId]);
    if (!row) return;
    const arr = JSON.parse(row.val ?? '[]');
    if (!rest) {
      arr[idx] = remoteUrl;
    } else {
      // nested: e.g. .photoUris[1]
      const innerMatch = rest.match(/^\.(\w+)\[(\d+)\]$/);
      if (innerMatch) {
        const [, innerKey, innerIdxStr] = innerMatch;
        if (!arr[idx]) arr[idx] = {};
        if (!arr[idx][innerKey]) arr[idx][innerKey] = [];
        arr[idx][innerKey][parseInt(innerIdxStr, 10)] = remoteUrl;
      } else {
        const keyMatch = rest.match(/^\.(\w+)$/);
        if (keyMatch) {
          if (!arr[idx]) arr[idx] = {};
          arr[idx][keyMatch[1]] = remoteUrl;
        }
      }
    }
    await db.runAsync(
      `UPDATE ${table} SET ${col} = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(arr), new Date().toISOString(), entityLocalId]
    );
  }
}
```

---

### 3.6 New — Sync Service

**New file: `src/services/syncService.ts`**

> Note: the Phase 2 upload endpoint accepts a single full-file PUT (max 50 MB).
> No chunking is needed — the whole file is sent in one request.

```typescript
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { getSitesForSync, getAssessmentsForSync, updateSiteServerId,
         updateAssessmentServerId, setSiteSynced, setAssessmentSynced } from '../repositories/solarSenseRepository';
import { enqueuePhotosForSite, getNextPending, getQueueStats,
         markUploading, markUploaded, markCleared, markFailed,
         applyRemoteUrlToEntity } from '../repositories/uploadQueueRepository';
import { apiClient } from '../api/apiClient';

export type SyncProgress = {
  phase: 'idle' | 'queuing' | 'uploading' | 'pushing' | 'done' | 'error';
  uploaded: number;
  total: number;
  failedCount: number;
  lastError?: string;
};

export async function runSync(onProgress: (p: SyncProgress) => void): Promise<void> {
  const sites = await getSitesForSync();
  if (sites.length === 0) { onProgress({ phase: 'done', uploaded: 0, total: 0, failedCount: 0 }); return; }

  // 1. Enqueue all photos (idempotent)
  onProgress({ phase: 'queuing', uploaded: 0, total: 0, failedCount: 0 });
  for (const site of sites) {
    await enqueuePhotosForSite(site.id);
  }

  // 2. Process queue
  const stats0 = await getQueueStats();
  onProgress({ phase: 'uploading', uploaded: 0, total: stats0.pending + stats0.uploading, failedCount: 0 });
  let uploaded = 0;
  let row = await getNextPending();
  while (row) {
    await processOneUpload(row);
    uploaded++;
    const statsNow = await getQueueStats();
    onProgress({ phase: 'uploading', uploaded, total: stats0.total, failedCount: statsNow.failed });
    row = await getNextPending();
  }

  // 3. Abort if any uploads failed
  const statsFinal = await getQueueStats();
  if (statsFinal.failed > 0) {
    onProgress({ phase: 'error', uploaded, total: statsFinal.total, failedCount: statsFinal.failed,
                 lastError: `${statsFinal.failed} photo(s) failed to upload` });
    return;
  }

  // 4. Push data to server
  onProgress({ phase: 'pushing', uploaded, total: statsFinal.total, failedCount: 0 });
  for (const site of sites) {
    const assessments = await getAssessmentsForSync(site.id);
    const result = await apiClient.pushSync({ sites: [site], assessments });
    await updateSiteServerId(site.id, result.siteIds[site.id]);
    for (const a of assessments) {
      await updateAssessmentServerId(a.id, result.assessmentIds[a.id]);
    }
    await setSiteSynced(site.id);
    for (const a of assessments) await setAssessmentSynced(a.id);
  }

  onProgress({ phase: 'done', uploaded, total: statsFinal.total, failedCount: 0 });
}

async function processOneUpload(row: Awaited<ReturnType<typeof getNextPending>> & object): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(row.local_uri, { size: true });
    if (!info.exists) { await markFailed(row.id, 'File missing'); return; }

    // SHA-256 checksum of raw bytes
    const checksum = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      row.local_uri,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
    // Note: compute from actual file bytes, not the path.
    // Use FileSystem.readAsStringAsync(localUri, { encoding: 'base64' }) then hash the base64.
    // See implementation note below.

    // Deduplication check
    const check = await apiClient.checkPhoto({
      checksum,
      siteId: row.site_id,
      assessmentId: row.assessment_id ?? undefined,
      fieldName: row.field_name,
    });
    if (check.exists && check.remoteUrl) {
      await applyRemoteUrlToEntity(row.entity_type, row.entity_local_id, row.field_name, check.remoteUrl);
      await FileSystem.deleteAsync(row.local_uri, { idempotent: true }).catch(() => {});
      await markUploaded(row.id, check.remoteUrl);
      await markCleared(row.id);
      return;
    }

    // Create upload session
    const filename = row.local_uri.split('/').pop() ?? 'photo.jpg';
    const session = await apiClient.createUploadSession({
      checksum,
      siteId: row.site_id,
      assessmentId: row.assessment_id ?? undefined,
      fieldName: row.field_name,
      filename,
      fileSizeBytes: (info as FileSystem.FileInfo & { size: number }).size,
    });
    if (session.alreadyExists && session.remoteUrl) {
      await applyRemoteUrlToEntity(row.entity_type, row.entity_local_id, row.field_name, session.remoteUrl);
      await markUploaded(row.id, session.remoteUrl);
      await markCleared(row.id);
      return;
    }
    await markUploading(row.id, session.sessionId);

    // Upload raw bytes (single PUT — no chunking needed for < 50 MB)
    const base64 = await FileSystem.readAsStringAsync(row.local_uri, { encoding: FileSystem.EncodingType.Base64 });
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    await apiClient.uploadPhoto(session.uploadUrl, bytes.buffer, mimeType);

    // Confirm upload
    const confirmed = await apiClient.confirmUpload({ sessionId: session.sessionId, checksum });

    // Write remote URL back, delete local file
    await applyRemoteUrlToEntity(row.entity_type, row.entity_local_id, row.field_name, confirmed.remoteUrl);
    await FileSystem.deleteAsync(row.local_uri, { idempotent: true }).catch(() => {});
    await markUploaded(row.id, confirmed.remoteUrl);
    await markCleared(row.id);

  } catch (e) {
    await markFailed(row.id, String(e));
  }
}
```

**Implementation note — computing the checksum:**

The API expects a SHA-256 hex digest of the raw file bytes.
`expo-crypto` operates on strings; the correct approach is:

```typescript
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';  // or use a pure-JS sha256 like js-sha256

const base64 = await FileSystem.readAsStringAsync(localUri, {
  encoding: FileSystem.EncodingType.Base64,
});
const bytes = Buffer.from(base64, 'base64');
// Use any SHA-256 implementation that accepts a Buffer or Uint8Array
const checksum = sha256(bytes);   // e.g. import { sha256 } from 'js-sha256'
```

Add `js-sha256` to dependencies: `npm install js-sha256`.

---

### 3.7 New — Sync Status Context

**New file: `src/services/SyncStatusContext.tsx`**

```typescript
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { runSync, type SyncProgress } from './syncService';

interface SyncStatus {
  syncing: boolean;
  progress: SyncProgress;
  lastSyncedAt: string | null;
  triggerSync: () => void;
}

const defaultProgress: SyncProgress = { phase: 'idle', uploaded: 0, total: 0, failedCount: 0 };
export const SyncStatusContext = createContext<SyncStatus>({
  syncing: false, progress: defaultProgress, lastSyncedAt: null, triggerSync: () => {},
});
export const useSyncStatus = () => useContext(SyncStatusContext);

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress>(defaultProgress);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const syncLock = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem('ss_last_synced_at').then(v => setLastSyncedAt(v));
  }, []);

  const triggerSync = useCallback(async () => {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      await runSync(p => setProgress({ ...p }));
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      AsyncStorage.setItem('ss_last_synced_at', now);
    } catch (e) {
      setProgress({ phase: 'error', uploaded: 0, total: 0, failedCount: 0, lastError: String(e) });
    } finally {
      setSyncing(false);
      syncLock.current = false;
    }
  }, []);

  // Sync on foreground resume and every 15 min while app is open
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') triggerSync();
    });
    const interval = setInterval(triggerSync, 15 * 60 * 1000);
    return () => { sub.remove(); clearInterval(interval); };
  }, [triggerSync]);

  return (
    <SyncStatusContext.Provider value={{ syncing, progress, lastSyncedAt, triggerSync }}>
      {children}
    </SyncStatusContext.Provider>
  );
}
```

**File: `App.tsx`** — wrap root:
```tsx
import { SyncStatusProvider } from './src/services/SyncStatusContext';
// ...
<SyncStatusProvider>
  <NavigationContainer>
    {/* ... */}
  </NavigationContainer>
</SyncStatusProvider>
```

---

### 3.8 New — Sync Status Banner

**New file: `src/components/SyncStatusBanner.tsx`**

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSyncStatus } from '../services/SyncStatusContext';

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SyncStatusBanner() {
  const { syncing, progress, lastSyncedAt, triggerSync } = useSyncStatus();

  if (syncing) {
    return (
      <View style={[styles.banner, styles.blue]}>
        <Text style={styles.text}>
          {progress.phase === 'uploading'
            ? `Syncing photos — ${progress.uploaded} / ${progress.total}`
            : progress.phase === 'pushing'
            ? 'Saving to server…'
            : 'Preparing sync…'}
        </Text>
      </View>
    );
  }
  if (progress.phase === 'error') {
    return (
      <View style={[styles.banner, styles.amber]}>
        <Text style={styles.text}>{progress.failedCount} photo(s) failed to upload</Text>
        <Pressable onPress={triggerSync} style={styles.btn}>
          <Text style={styles.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (progress.phase === 'done' && lastSyncedAt) {
    return (
      <View style={[styles.banner, styles.green]}>
        <Text style={styles.text}>Synced · {formatRelative(lastSyncedAt)}</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  banner:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  blue:    { backgroundColor: '#2196F3' },
  green:   { backgroundColor: '#4CAF50' },
  amber:   { backgroundColor: '#FF9800' },
  text:    { color: '#fff', fontSize: 13, flex: 1 },
  btn:     { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 4 },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
```

**File: `src/navigation/MainTabNavigator.tsx`** — render the banner above the tab bar:
```tsx
import { SyncStatusBanner } from '../components/SyncStatusBanner';
// Inside the navigator's render:
<>
  <SyncStatusBanner />
  <Tab.Navigator>...</Tab.Navigator>
</>
```

---

### 3.9 Complete Button — SiteFormScreen

**File: `src/screens/SiteFormScreen.tsx`**

```tsx
import { useSyncStatus } from '../services/SyncStatusContext';
import { markSiteComplete } from '../repositories/solarSenseRepository';

// Inside the screen component:
const { triggerSync } = useSyncStatus();
const isCompleted = site.status === 'Completed';

// Add button (only shown when Draft):
{!isCompleted && (
  <Pressable
    style={styles.completeButton}
    onPress={() => Alert.alert(
      'Mark as Complete?',
      'Once completed, the site cannot be edited and will be uploaded to the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Complete',
          style: 'destructive',
          onPress: async () => {
            await markSiteComplete(site.id);
            triggerSync();
          },
        },
      ]
    )}
  >
    <Text>Mark as Complete</Text>
  </Pressable>
)}

// Add status badge at the top of the form:
<Text style={isCompleted ? styles.completedBadge : styles.draftBadge}>
  {isCompleted ? 'COMPLETED' : 'DRAFT'}
</Text>

// Make all fields read-only when completed:
// Pass editable={!isCompleted} to every TextInput
// Pass disabled={isCompleted} to every Pressable
```

---

### 3.10 Complete Button — AssessmentFormScreen

**File: `src/screens/AssessmentFormScreen.tsx`**

Same pattern as above using `markAssessmentComplete(assessment.id)`.

---

### 3.11 New — Sync Setup Screen

**New file: `src/screens/SyncSetupScreen.tsx`**

```tsx
import * as SecureStore from 'expo-secure-store';
import { apiClient, AuthError, NetworkError } from '../api/apiClient';

// Two text inputs: API Server URL and API Key
// On Save:
//   SecureStore.setItemAsync('ss_api_url', url.trim())
//   SecureStore.setItemAsync('ss_api_key', apiKey.trim())

// On Test Connection:
//   try {
//     await apiClient.checkPhoto({ checksum: 'test', siteId: 'test', fieldName: 'test' })
//     showSuccess('Connected successfully')
//   } catch (e) {
//     if (e instanceof AuthError) showError('Invalid API key')
//     else if (e instanceof NetworkError) showError('Cannot reach server: ' + e.message)
//     else showError(String(e))
//   }
```

**File: `src/navigation/RootNavigator.tsx`** — add `SyncSetupScreen` to the navigator.

**File: `src/screens/SettingsScreen.tsx`** — add a row:
```tsx
<ListItem title="Sync Configuration" onPress={() => navigation.navigate('SyncSetup')} />
```
On first launch, check SecureStore; if `ss_api_url` is not set, navigate to `SyncSetupScreen` automatically.

---

### 3.12 Diagnostics Screen — Sync Section

**File: `src/screens/DiagnosticsScreen.tsx`**

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getQueueStats, resetFailedForRetry } from '../repositories/uploadQueueRepository';
import { useSyncStatus } from '../services/SyncStatusContext';

// Add a new section "Cloud Sync":
// - API Server URL (from SecureStore ss_api_url, masked after the scheme)
// - Last synced: (from AsyncStorage ss_last_synced_at)
// - Pending uploads / Failed uploads (from getQueueStats())
// - [Run Sync Now] button → triggerSync()
// - [Reset Failed] button → resetFailedForRetry() then triggerSync()
```

---

## API Reference (actual endpoints tested)

**Base URL:** `http://170.64.154.143` (HTTP until domain + HTTPS configured)

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/v1/solarsense/sync/check-photo` | POST | Bearer | Body: `{ checksum, siteId, assessmentId?, fieldName }` |
| `/v1/solarsense/sync/create-upload-session` | POST | Bearer | Body: `{ checksum, siteId, assessmentId?, fieldName, filename, fileSizeBytes }` |
| `/v1/solarsense/sync/upload/:sessionId` | PUT | none | Body: raw bytes. Content-Type: `image/*` |
| `/v1/solarsense/sync/confirm-upload` | POST | Bearer | Body: `{ sessionId, checksum }` |
| `/v1/solarsense/sync/push` | POST | Bearer | Body: `{ sites: Site[], assessments: RooftopAssessment[] }` — all must be `status: 'Completed'` |
| `/v1/solarsense/sync/pull` | GET | Bearer | Query: `?since=ISO8601&siteId=optional` |

**Push payload notes:**
- `sites` and `assessments` must include all fields (null ok for optional ones)
- Both must have `status: 'Completed'` — push rejects Draft records with 400
- `id` is the local UUID; server returns `{ siteIds: { localId → serverId }, assessmentIds: { … } }`

**Photo upload flow (single-request, max 50 MB):**
```
1. POST check-photo → { exists: true,  remoteUrl }  → skip upload, use remoteUrl
                     { exists: false }               → continue

2. POST create-upload-session → { sessionId, uploadUrl, alreadyExists: false }
   (if alreadyExists: true, remoteUrl is returned directly — another concurrent upload won)

3. PUT <uploadUrl> with raw image bytes (no auth header needed)
   → { ok: true, checksum, fileSizeBytes }

4. POST confirm-upload { sessionId, checksum }
   → { remoteUrl }   ← URL to store in the entity
```

---

## Testing Checklist

```
□ Install npm deps: npm install js-sha256 (for checksum calculation)
□ DB migration runs without error — sites and rooftop_assessments gain status column
□ Existing records default to 'Draft' — verify in Drizzle Studio or via SQL
□ Mark a site as Complete → status flips to 'Completed', form becomes read-only
□ Mark an assessment as Complete → same
□ SyncSetupScreen saves and retrieves credentials from SecureStore
□ Test Connection button succeeds against http://170.64.154.143
□ Trigger sync manually → SyncStatusBanner shows progress
□ Photo appears in Diagnostics → Pending uploads count increments during sync
□ After sync → banner shows "Synced · X min ago"
□ Pull: GET /v1/solarsense/sync/pull returns the pushed site and assessments
□ Duplicate photo: upload same photo twice → second attempt hits check-photo → alreadyExists=true
□ Failed upload (kill network mid-upload) → retry works, counter resets
□ Background sync fires after 15 min while app is open
```

---

## New npm Dependency

```bash
cd solarsense-mobile
npm install js-sha256
```

---

## What's NOT in Phase 3

- EcoAudit mobile sync (Phase 5 — depends on Phase 4 EcoAudit server API)
- OneDrive storage (current Phase 2 server uses VM-local; migration to OneDrive is future work)
- Chunked upload (not needed — server accepts single PUT up to 50 MB)
- Background fetch task (optional enhancement — the 15-min interval in `SyncStatusContext` covers most cases)
- Pull-to-merge (pull returns raw server records; merging with local drafts is complex and deferred)
