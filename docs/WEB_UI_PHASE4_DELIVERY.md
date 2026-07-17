# SustainabilityWiseUI Phase 4 Delivery

Prepared: 19 June 2026

## Phase Delivered

Phase 4: **EcoAudit Pro Live CRUD**

This phase connects the EcoAudit Pro web module to the existing API and SQL-backed records. The audit, zone, and equipment screens now persist real data through the current backend.

## Delivered Scope

- EcoAudit audit list, create, copy, edit, complete, and delete.
- EcoAudit zone list, create, edit, and delete.
- API-backed audit copy that can copy zones and equipment into the new draft audit.
- Copy is top-level only. Zones and equipment do not have separate copy actions.
- Copied audit names retain the full original audit name plus a short random suffix.
- EcoAudit equipment list, create, edit, and delete for all categories:
  - Main switchboards.
  - Additional switchboards.
  - HVAC units.
  - Lighting systems.
  - Solar PV.
  - Forklift chargers.
  - Hot water systems.
  - General water.
  - General electricity.
- Equipment category selector.
- Parent-aware workflows:
  - Zones require an audit ID.
  - Equipment requires an audit ID and zone ID.
  - Equipment lists are filtered to the selected zone.
- Completed-record lock state with copy-as-draft support for audits.
- API guardrails prevent direct edits to completed audits and prevent zone/equipment changes under completed audits.
- Audit PDF URL and sync status display.
- Zone photo references and equipment photo URI fields.
- EcoAudit file/photo browsing, photo delete, ZIP download, and PDF job panels from Phase 2 remain available.

## Key Files Added

- `web/src/components/EntityCrudPanel.tsx`
- `web/src/lib/entityConfigs.ts`

## Key Files Updated

- `web/src/components/BusinessWorkflowPanels.tsx`
  - Routes EcoAudit audits, zones, and equipment to live CRUD panels.
- `web/src/lib/api.ts`
  - Adds authenticated PATCH action helper for complete actions.
- `web/src/styles.css`
  - Adds sectioned form styling for larger equipment forms.
- `src/routes/ecoaudit/audits.ts`
  - Adds top-level audit copy endpoint.
- `src/routes/copyUtils.ts`
  - Adds shared copy helpers and the short-suffix copy name convention.

## Business Features Available For Testing

- Create an EcoAudit audit.
- Edit and complete the audit.
- Copy a completed or draft audit into a new draft named with the full original name plus a short suffix.
- Delete a disposable audit.
- Create and edit zones under a known audit ID.
- Create and edit equipment under a known audit ID and zone ID.
- Switch between all nine equipment categories.
- Browse/download EcoAudit files and photos by name or ID.
- Download EcoAudit ZIPs.
- Generate and download EcoAudit PDFs.

## Current Limits

- Copy is intentionally not available on zones or equipment. To change completed zone/equipment data, copy the parent audit and edit the draft copy.
- Copied records intentionally do not duplicate raw stored photo/PDF objects. Existing photo URI fields can carry over, while new uploads continue through API upload-session endpoints.
- Zone and equipment photos are editable as URI/list fields in this pass. Direct browser upload into every field still needs final field-level upload mapping.
- Some equipment fields that are repeated or photo-description based use text, array, or JSON editors first. A later polish pass can turn those into specialized row editors.

## Commands Verified

```bash
npm run typecheck
npm run web:build
```

Both commands passed.

## Deployment Notes

Use the existing deployment flow:

```bash
npm ci
npm run build
pm2 restart sw-api
```

No new hosting service is required.
