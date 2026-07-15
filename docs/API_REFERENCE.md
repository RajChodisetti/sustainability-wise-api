# API Reference

Full live documentation is available at `GET /v1/docs/` (Swagger UI, JWT required).
For browser use, open `/v1/docs/?access_token=<JWT or API key>` once; the UI stores the token
locally and uses it for the OpenAPI JSON request.

This file is a quick-reference index. Protected endpoints require `Authorization: Bearer <token>`
where the token is either a JWT access token or a service account API key. Public exceptions are
`/health`, `/v1/files/...`, and raw upload session URLs returned by create-upload-session.

---

## Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/v1/auth/login` | Email + password login. Returns JWT access + refresh tokens. |
| POST | `/v1/auth/refresh` | Rotate refresh token. Returns new JWT pair. |
| POST | `/v1/auth/logout` | Revoke refresh token. |
| GET | `/v1/auth/me` | Return current user info from token. |

## API Keys

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/v1/api-keys` | admin | List all non-revoked keys for your app |
| POST | `/v1/api-keys` | admin | Create key — raw value returned once only |
| DELETE | `/v1/api-keys/:id` | admin | Revoke key |

## Files

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/files/:storageKey` | public URL | Download stored file referenced by `remoteUrl` |
| GET | `/v1/thumbnails/:storageKey` | inspector/service/admin | Return a cached JPEG preview, at most 400px wide, for an authorized photo |

Derive a preview URL by replacing `/v1/files/` in the stored original `remoteUrl`
with `/v1/thumbnails/`. Send the normal `Authorization: Bearer <token>` header.
The original URL and checksum remain the canonical references for PDF generation;
the thumbnail URL is display/cache-only. Successful responses include an `ETag`
and are safe to resume or retry. A storage key is accepted only when it belongs to
a confirmed photo in the caller's application and the caller can access its audit
or site.

---

## SolarSense

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/users` | admin | List users |
| POST | `/v1/solarsense/users` | admin | Create user |
| GET | `/v1/solarsense/users/:id` | admin or self | Get user |
| PATCH | `/v1/solarsense/users/:id` | admin | Update user |
| DELETE | `/v1/solarsense/users/:id` | admin | Deactivate user |

### Sites
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/sites` | inspector/admin | List sites (inspector: own only) |
| POST | `/v1/solarsense/sites` | inspector/admin | Create site |
| GET | `/v1/solarsense/sites/:id` | inspector/admin | Get site |
| PATCH | `/v1/solarsense/sites/:id` | inspector/admin | Update site fields |
| DELETE | `/v1/solarsense/sites/:id` | inspector/admin | Soft-delete site |
| PATCH | `/v1/solarsense/sites/:id/complete` | inspector/admin | Mark site Completed — enables sync |

### Assessments
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/sites/:siteId/assessments` | inspector/admin | List assessments for site |
| POST | `/v1/solarsense/sites/:siteId/assessments` | inspector/admin | Create assessment |
| GET | `/v1/solarsense/sites/:siteId/assessments/:id` | inspector/admin | Get assessment |
| PATCH | `/v1/solarsense/sites/:siteId/assessments/:id` | inspector/admin | Update assessment |
| DELETE | `/v1/solarsense/sites/:siteId/assessments/:id` | inspector/admin | Soft-delete |
| PATCH | `/v1/solarsense/sites/:siteId/assessments/:id/complete` | inspector/admin | Mark Completed |

### Photos
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/solarsense/sites/:siteId/photos` | inspector/admin | List all photos for site |
| GET | `/v1/solarsense/sites/:siteId/photos/export` | inspector/admin | Download ZIP of all photos |
| DELETE | `/v1/solarsense/photos/:photoId` | admin | Delete photo from configured storage and registry |

### Sync
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/solarsense/sync/check-photo` | service/inspector | SHA-256 dedup check |
| POST | `/v1/solarsense/sync/create-upload-session` | service/inspector | Create photo upload session |
| PUT | `/v1/solarsense/sync/upload/:sessionId` | session URL | Upload raw image bytes to configured storage |
| POST | `/v1/solarsense/sync/confirm-upload` | service/inspector | Confirm upload complete |
| POST | `/v1/solarsense/sync/push` | service/inspector | Upsert sites + assessments |
| GET | `/v1/solarsense/sync/pull` | service/inspector | Delta pull since timestamp |

### PDF
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/solarsense/sites/:siteId/site-pack/pdf` | inspector/admin | Generate site pack PDF and store generated PDF on the VM |

---

## EcoAudit Pro

### Users
Same shape as SolarSense Users at `/v1/ecoaudit/users/…`

### Audits
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits` | inspector/admin | List audits |
| POST | `/v1/ecoaudit/audits` | inspector/admin | Create audit |
| GET | `/v1/ecoaudit/audits/:id` | inspector/admin | Get audit |
| PATCH | `/v1/ecoaudit/audits/:id` | inspector/admin | Update audit |
| DELETE | `/v1/ecoaudit/audits/:id` | inspector/admin | Soft-delete |
| PATCH | `/v1/ecoaudit/audits/:id/complete` | inspector/admin | Mark Completed — enables sync |

### Zones
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits/:auditId/zones` | inspector/admin | List zones |
| POST | `/v1/ecoaudit/audits/:auditId/zones` | inspector/admin | Create zone |
| GET | `/v1/ecoaudit/zones/:id` | inspector/admin | Get zone |
| PATCH | `/v1/ecoaudit/zones/:id` | inspector/admin | Update zone |
| DELETE | `/v1/ecoaudit/zones/:id` | inspector/admin | Soft-delete |

### Equipment (× 9 types)
Each type has identical CRUD. Replace `{type}` with one of:
`main-switchboards`, `additional-switchboards`, `hvac-units`, `lighting-systems`,
`solar-pv`, `forklift-chargers`, `hot-water-systems`, `general-water`, `general-electricity`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits/:auditId/{type}` | inspector/admin | List items for an audit |
| POST | `/v1/ecoaudit/audits/:auditId/{type}` | inspector/admin | Create item; body includes `zoneId` |
| GET | `/v1/ecoaudit/{type}/:id` | inspector/admin | Get item |
| PATCH | `/v1/ecoaudit/{type}/:id` | inspector/admin | Update item |
| DELETE | `/v1/ecoaudit/{type}/:id` | inspector/admin | Soft-delete |

### Photos
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/ecoaudit/audits/:auditId/photos` | inspector/admin | List all photos for audit |
| GET | `/v1/ecoaudit/audits/:auditId/photos/export` | inspector/admin | Download ZIP |
| DELETE | `/v1/ecoaudit/photos/:photoId` | admin | Delete from configured storage and registry |

### Sync
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/ecoaudit/sync/check-photo` | service/inspector | SHA-256 dedup check |
| POST | `/v1/ecoaudit/sync/create-upload-session` | service/inspector | Create photo upload session |
| PUT | `/v1/ecoaudit/sync/upload/:sessionId` | session URL | Upload raw image bytes to configured storage |
| POST | `/v1/ecoaudit/sync/confirm-upload` | service/inspector | Confirm upload complete |
| POST | `/v1/ecoaudit/sync/push` | service/inspector | Upsert audit + zones + all 9 equipment types |
| GET | `/v1/ecoaudit/sync/pull` | service/inspector | Delta pull since timestamp |

### PDF
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/ecoaudit/audits/:auditId/report/pdf` | inspector/admin | Generate full audit PDF (server-side Puppeteer) |

---

## Common Response Shapes

### Error
```json
{ "error": "string", "statusCode": 400, "detail": "optional extra info" }
```

### Pagination (list endpoints)
```json
{
  "data": [...],
  "meta": { "total": 47, "page": 1, "limit": 20, "pages": 3 }
}
```

### SolarSense Sync Push Response
```json
{
  "siteIds": { "<localId>": "<serverId>", ... },
  "assessmentIds": { "<localId>": "<serverId>", ... }
}
```

### EcoAudit Sync Push Response
```json
{
  "auditId": "<localId>",
  "serverId": "<serverId>"
}
```

### Upload Session Response
```json
{
  "sessionId": "uuid",
  "uploadUrl": "https://api.sustainabilitywise.com.au/v1/solarsense/sync/upload/uuid",
  "alreadyExists": false
}
```
