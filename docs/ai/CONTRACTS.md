# Cross-System Contracts

These are the contracts most likely to cause an existing feature regression.

## Photo Metadata

EcoAudit photo captions and PDF sizing are one value represented as:

```ts
type PhotoMetadata = { name?: string; largeInPdf?: boolean };
type PhotoMetadataMap = Record<string, PhotoMetadata>;
```

- Public/API model: `photoDescs`.
- Database column: `photo_descs`, mapped by Drizzle as `photoDescs`.
- Scalar metadata key: the canonical mobile photo field name.
- Array metadata key: `fieldName.index`.
- Upload/registry array field: `fieldName[index]`.
- Portal authority: `apps/ecoaudit/src/lib/photoMetadata.ts`.
- API authority: `src/routes/ecoaudit/helpers.ts` and field-specific canonical
  helpers such as `lightingPhotoField.ts`.
- PDF authority: the record's canonical `photoDescs`; the PDF must not maintain a
  second caption or sizing field.

The lighting controls image is canonically `switchboardControlsPhoto`.
`switchboardPhotoNotes` is a legacy compatibility alias only. A rename must cover
the equipment JSON metadata, `photo_registry.field_name`, and
`photo_copy_references.target_field_name`, then retain only the minimum read/sync
alias required for installed clients.

## Photos and Copies

`photo_registry` identifies stored originals. `photo_copy_references` grants a
copied record access to an immutable original without duplicating bytes. Keep the
original URL/checksum as the durable reference; thumbnails are previews and must
not replace original references used by PDF or sync. Reconciliation must remain
app-, parent-, entity-, and ownership-scoped.

## Export Jobs

PDF and photo ZIP exports share the `pdf_jobs` table and generic export job API.
The artifact discriminator is `pdf` or `photos-zip`.

- Queue expensive work through `src/services/exportJobQueue.ts`.
- Persist state through `src/services/pdfJobService.ts`.
- Expose status/latest/download through `src/routes/pdfJobs.ts`.
- Portal workflows use `useExportJob` and `ExportJobStatus` so progress survives
  navigation and completed downloads remain available.
- Do not open all object-storage streams at once. Consume each stream before
  requesting the next and upload large artifacts from a file/stream with known
  length.
- Do not impose a fixed browser timeout on server work. Show durable progress and
  let the user leave the page.
- Keep direct endpoints used by mobile clients compatible until mobile versions
  have been migrated and the deprecation is explicit.

EcoAudit photo ZIP paths follow the mobile report inventory hierarchy. The
`by-zone` mode is `Zone / Report section / Item / Photo caption`, while
`by-equipment` is `Report section / Zone / Item / Photo caption`. Folder names
come from zone and equipment records, never entity UUIDs. Duplicate captions get
deterministic numeric suffixes and all path segments are archive-safe.

## Authentication and Ownership

Every protected domain route uses `authenticate`, `requireApp(product)`, and the
minimum role. Role hierarchy does not replace the app boundary. Non-elevated
sync and CRUD operations cannot assign another creator or access another user's
parent. Fleet viewer access is read-only; collector ingestion requires
`service_account`; user administration requires `admin`.

## Sync and Lifecycle

Mobile sync payloads are compatibility contracts. Completed records are eligible
for sync and photo upload; draft records are not. Preserve stable completion
timestamps and idempotent upsert behavior. Copy/import and sync endpoints must
apply the same canonical field normalization as portal CRUD.

## Database Changes

- Add a new numbered migration; never rewrite an applied migration.
- Schema and migration must agree in the same change.
- Renames require data movement and compatibility handling, not just a TypeScript
  rename.
- JSON migrations preserve canonical values when both keys exist.
- Shared-table changes require EcoAudit, SolarSense, and Fleet impact review.
- Production deploy order is migration first only when old code tolerates the
  new schema; otherwise use an expand/migrate/contract sequence across releases.
