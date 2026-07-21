# EcoAudit Backend Contract

EcoAudit routes are mounted at `/v1/ecoaudit` and require the `ecoaudit` auth
namespace. Inspectors are ownership-scoped; admins may use the established
elevated paths.

## Domain Shape

- Parent flow: audit -> zones -> nine equipment collections.
- Equipment route files, `equipment/index.ts`, Drizzle tables, portal
  `equipmentConfig.ts`, portal domain types, sync payloads, photos, and PDF output
  must stay aligned.
- Audit completion and timing are business lifecycle values. Preserve the first
  stable start/completion timestamps and legacy fallback behavior.
- Mobile sync is an installed-client contract. Accept known legacy fields at the
  boundary and write canonical fields internally.

## Photo Metadata

- The one canonical metadata property is `photoDescs`; entries are
  `{ name?: string, largeInPdf?: boolean }`.
- Use `photoMetadata()` for API input and field canonicalization helpers before
  persistence, sync, registry lookup, or PDF generation.
- Array metadata keys use `field.index`; upload registry fields use
  `field[index]`. Do not invent a page-specific key format.
- `switchboardControlsPhoto` is canonical for the lighting controls image.
  `switchboardPhotoNotes` is read/sync compatibility only.
- Any rename must update database JSON, `photo_registry`, copy references, API
  normalization, portal normalization, sync compatibility, PDF lookup, and tests.
- Photo ZIP entries mirror the mobile report hierarchy: zone/section/item/photo
  for by-zone and section/zone/item/photo for by-equipment. Use saved names and
  captions; entity UUIDs must not become user-facing folder names.

## Required Impact Review

For a CRUD field change inspect:

- `src/db/schema/ecoaudit.ts` and migrations;
- this route, `sync.ts`, `photos.ts`, and `pdf.ts`;
- `apps/ecoaudit/src/types/domain.ts` and `src/api/`;
- `apps/ecoaudit/src/lib/equipmentConfig.ts` or `photoMetadata.ts`;
- affected portal create, edit, detail, report, and photo pages;
- `docs/MOBILE_INTEGRATION.md` and mobile compatibility.

Add regression tests for canonical writes and legacy reads. Run API and portal
checks for any wire field, photo, report, or export change.
