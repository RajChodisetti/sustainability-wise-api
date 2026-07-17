# SustainabilityWiseUI Phase 3 Delivery

Prepared: 19 June 2026

## Phase Delivered

Phase 3: **SolarSense Live CRUD**

This phase connects the SolarSense web module to the existing API and SQL-backed records. The SolarSense screens now use real persisted data instead of the Phase 2 representative workflow panel.

## Delivered Scope

- SolarSense site list, create, copy, edit, complete, and delete.
- SolarSense rooftop assessment list, create, edit, complete, and delete.
- API-backed site copy that can copy child assessments into the new draft site.
- Copy is top-level only. Assessments do not have separate copy actions.
- Copied site names retain the full original site name plus a short random suffix.
- Parent-aware assessment workflow using the selected SolarSense site ID.
- Completed-record lock state with copy-as-draft support.
- API guardrails prevent direct edits to completed sites and prevent child assessment changes under completed sites.
- Role-aware access through the existing authenticated API calls.
- Site report fields:
  - Site metadata.
  - Electrical infrastructure summary.
  - Known constraints.
  - Load profile and metering summary.
  - PPA / asset demarcation.
  - Appendix notes and appendix item JSON.
  - PDF URL and sync status display.
- Assessment fields:
  - Building, roof, structure, orientation, shading, solar potential, electrical, viability, notes, and photo metadata fields.
  - Switchboards, other considerations, additional photos, and photo metadata through JSON editors.
- SolarSense file/photo browsing, photo delete, ZIP download, and PDF job panels from Phase 2 remain available.

## Key Files Added

- `web/src/components/EntityCrudPanel.tsx`
- `web/src/lib/entityConfigs.ts`

## Key Files Updated

- `web/src/components/BusinessWorkflowPanels.tsx`
  - Routes SolarSense sites and assessments to live CRUD panels.
- `web/src/lib/api.ts`
  - Adds authenticated PATCH action helper for complete actions.
- `web/src/styles.css`
  - Adds sectioned form styling for larger entity forms.
- `src/routes/solarsense/sites.ts`
  - Adds top-level site copy endpoint.
- `src/routes/copyUtils.ts`
  - Adds shared copy helpers and the short-suffix copy name convention.

## Business Features Available For Testing

- Create a SolarSense site.
- Edit and complete the site.
- Copy a completed or draft site into a new draft named with the full original name plus a short suffix.
- Delete a disposable site.
- Create a rooftop assessment under a known site ID.
- Edit roof, electrical, viability, notes, and JSON-backed repeated data.
- Complete and delete a disposable assessment.
- Browse/download SolarSense files and photos by name or ID.
- Download SolarSense ZIPs.
- Generate and download SolarSense PDFs.

## Current Limits

- Copy is intentionally not available on assessments. To change completed assessment data, copy the parent site and edit the draft copy.
- Copied records intentionally do not duplicate raw stored photo/PDF objects. Existing photo URI fields can carry over, while new uploads continue through API upload-session endpoints.
- Complex repeated mobile sections are editable through JSON fields in this pass. A later polish pass can turn those into row-by-row form editors.
- Direct browser photo upload into each schema field still needs final field-level upload mapping. Existing photo browsing, delete, ZIP, PDF, and storage workflows are available.

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
