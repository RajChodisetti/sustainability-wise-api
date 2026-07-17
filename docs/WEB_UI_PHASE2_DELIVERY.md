# SustainabilityWiseUI Phase 2 Delivery

Prepared: 19 June 2026

## Phase Delivered

Phase 2: **Shared CRUD, Forms, Photos, Files, ZIP, and PDF Workflow Foundation**

This phase adds the reusable business workflow layer that later SolarSense and EcoAudit Pro entity screens will use. It also exposes useful file/photo/ZIP/PDF panels in the portal now, backed by the existing API endpoints.

## Delivered Scope

- Shared API helpers for:
  - Authenticated CRUD requests.
  - Stored file listing by record name or ID.
  - Photo registry listing.
  - Photo delete.
  - Photo ZIP download.
  - Async PDF job start, poll, and download.
  - Upload-session primitives for later schema-specific photo upload wiring.
- Shared UI components:
  - Data table.
  - Confirmation dialog.
  - Text/number/date/textarea controls.
  - Select control.
  - Toggle control.
  - Repeated-section control.
  - Photo upload/preview control.
- Shared record workflow panel:
  - Create.
  - View.
  - Copy.
  - Edit.
  - Delete.
  - Completed-record lock state.
  - Repeated data section.
  - Photo-field preview.
- Shared file/photo browser:
  - SolarSense site files by site name or ID.
  - SolarSense assessment files by assessment name or ID.
  - EcoAudit audit files by audit name or ID.
  - Photo registry table for site/audit level records.
  - Admin-only photo delete confirmation.
- Shared ZIP panel:
  - SolarSense site photo ZIP by site name or ID.
  - EcoAudit audit photo ZIP by audit name or ID.
- Shared PDF panel:
  - SolarSense site pack PDF job by site ID.
  - EcoAudit report PDF job by audit ID.
  - Job polling.
  - Progress display.
  - Completed PDF download.
- Portal navigation now shows Phase 2 workflow panels under the relevant module sections.

## Key Files Added

- `web/src/components/BusinessWorkflowPanels.tsx`
- `web/src/components/ConfirmDialog.tsx`
- `web/src/components/DataTable.tsx`
- `web/src/components/FormControls.tsx`
- `web/src/lib/format.ts`

## Key Files Updated

- `web/src/lib/api.ts`
  - Added shared CRUD, file, photo, ZIP, PDF, and upload-session helpers.
- `web/src/lib/types.ts`
  - Added shared data contracts for files, photos, PDF jobs, upload sessions, and generic pagination.
- `web/src/pages/ModulePage.tsx`
  - Added Phase 2 panels to module pages.
- `web/src/pages/BacklogPage.tsx`
  - Updated completed and next-phase items.
- `web/src/styles.css`
  - Added table, form, workflow, dialog, file result, PDF job, and responsive styles.

## Business Features Available For Testing Now

- Login and switch between SolarSense and EcoAudit Pro.
- Open any module area and see the relevant workflow foundation.
- Exercise a representative record create/copy/edit/delete workflow in:
  - SolarSense Sites or Assessments.
  - EcoAudit Audits, Zones, or Equipment.
- Browse stored files/photos for a known existing record.
- Download photo ZIPs for known existing records.
- Start and download PDF jobs for known existing records.
- Confirm admin-only photo delete controls are role-aware.

## Current Limits

- Entity-specific CRUD persistence is not connected yet. That starts in the SolarSense and EcoAudit Pro implementation phases.
- The shared record workflow panel is currently a reusable UI/data-flow foundation with local representative records.
- Photo upload preview is implemented, but upload-session wiring needs entity-specific field mapping before real uploads are enabled.
- PDF generation currently requires server IDs because the existing PDF job endpoints require IDs.
- File/photo browsing and ZIP download can use name or ID where the existing backend supports name-or-id lookup.

## Commands Verified

```bash
npm run typecheck
npm run web:build
```

Both commands passed.

## Deployment Notes

The existing deployment flow still applies:

```bash
npm ci
npm run build
pm2 restart sw-api
```

No additional hosting service is required.

