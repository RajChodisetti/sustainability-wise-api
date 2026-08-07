# SustainabilityWiseUI Implementation Plan

Prepared: 18 June 2026

## Purpose

This document defines the build plan for **SustainabilityWiseUI**, a web application that exposes the existing SolarSense and EcoAudit Pro workflows through one role-aware web interface.

Although this plan predates the Field App Complete workspace, any shared form,
completion, evidence, or sync component reused under `/installhub` must follow
its current contract: business capture and evidence are optional, and only an
explicit supply/metering/measurement `TBC` blocks completion/readiness.

The web app must copy the key capabilities already present in the mobile apps and backend:

- App-level login.
- App switcher/navigation for SolarSense and EcoAudit Pro.
- Admin and inspector/user access awareness.
- Create, view, edit, delete, and complete workflows.
- Top-level copy only:
  - SolarSense site copy.
  - EcoAudit audit copy.
- CRUD for SQL-backed data, not just photos.
- Photo browsing, upload, delete, and ZIP download.
- PDF generation, job progress, download, and regeneration.
- Desktop and tablet first responsive layout with reasonable mobile browser support.
- Reuse the current API server, PDF jobs, DigitalOcean hosting, and OneDrive backup. The web app must not connect to the database or object storage directly.

## Source Areas Reviewed

- SolarSense mobile workflows: dashboard, site packs, sites, rooftop assessments, PDF, ZIP, photos, user/admin, settings, diagnostics.
- EcoAudit Pro mobile workflows: dashboard, audits, zones, all equipment forms, review, PDF, ZIP, photos, user/admin, settings, diagnostics.
- Backend API modules: auth, users, sites, assessments, audits, zones, equipment, photos, storage browser, PDF jobs, sync, API keys.
- Database schemas: SolarSense, EcoAudit Pro, shared users/auth/API key/version tables.
- File and backup behavior: S3-style file storage, storage browser APIs, OneDrive photo/PDF backup support, name-or-id storage lookup requirements.

## Build Principles

- The web portal only calls authenticated `/v1/*` API endpoints and public API-served download/upload URLs returned by the API server.
- Production API route prefix is `https://api.sustainabilitywise.com.au/v1`. For web builds, configure the API origin as `https://api.sustainabilitywise.com.au` because the web API client adds `/v1` to route paths.
- Database, local file storage, S3-compatible Spaces storage, and OneDrive backup access stay inside the API server.
- If a web workflow needs an action that does not exist yet, add an API endpoint first and then wire the UI to that endpoint.
- The web UI should follow the existing product behavior instead of inventing a new workflow.
- Users should only see modules, records, and actions their app role permits.
- Completed records should stay locked. If a completed resource needs changes, the user copies the top-level SolarSense site or EcoAudit audit and edits the new draft.
- Copy must exist only at the top-level resource. Child assessments, zones, and equipment do not have separate copy actions.
- Copied top-level resources must retain the full parent name plus a short random suffix, for example `Original Name a1b2`, so they do not collide with app-generated copies or clones.
- Top-level copy must create usable editable drafts and preserve
  contract-defined child data.
- Destructive actions must require confirmation and show clearly what will be deleted.
- Photo and PDF actions must work for both existing records and newly created records.
- New storage paths and OneDrive paths must follow the current name-based naming convention, with compatibility for ID-based legacy records.
- Field App Complete must not reuse generic browser `required` rules for business
  capture or evidence. Authentication, ownership, CAS, stable IDs, and
  structural payload/attachment validation remain enforced; unresolved optional
  evidence is omitted from immutable v2.7 snapshots and included confirmed
  media remains exact and immutable.

## Phase 0: Scope, API, and Data Model Confirmation

Goal: remove ambiguity before UI implementation.

Deliverables:

- Confirm frontend stack and repository location.
- Confirm production base URL, API base URL, auth token handling, and deployment process.
- Confirm exact access rules for admin and inspector/user for both apps.
- Map every web screen to existing backend endpoints.
- Map every form field to database/API payload fields.
- Confirm that no web screen reads/writes DB, S3/Spaces, or local storage directly.
- Confirm copy behavior:
  - Top-level only: SolarSense site and EcoAudit audit.
  - Parent plus child records where applicable.
  - Whether copied photos are referenced, cloned in storage, or re-uploaded.
  - Whether generated PDFs are copied or regenerated.
- Confirm completed-record behavior:
  - Edit locked completed records.
  - Changes require a top-level copy.
  - Delete completed records.
- Confirm storage naming behavior:
  - New records use readable names in storage/OneDrive.
  - APIs can resolve by ID or exact name for browsing, download, and delete.
  - Existing legacy folders/files are migrated or aliased.

Exit criteria:

- Field map exists for SolarSense and EcoAudit Pro.
- Backend gaps are listed and assigned.
- CRUD and file operations have agreed behavior.

## Phase 1: Web App Foundation

Goal: build the shared shell once and reuse it for both modules.

Deliverables:

- App layout with top-level navigation and app switcher:
  - SolarSense.
  - EcoAudit Pro.
  - Admin/settings where permitted.
- App-level login using existing auth APIs.
- Token refresh/logout handling.
- Route guards for logged-in users.
- Role-aware menus and action visibility.
- Shared API client with:
  - Auth headers.
  - Error handling.
  - Loading states.
  - Retry behavior where safe.
  - Typed request/response models.
- Shared UI patterns:
  - Tables/lists.
  - Search/filter controls.
  - Detail pages.
  - Create/edit forms.
  - Confirmation dialogs.
  - Toast/error messages.
  - Empty states.
  - Progress indicators.

Exit criteria:

- Admin and inspector/user can log in.
- App switcher shows only permitted modules.
- Protected pages cannot be opened without auth.
- API errors are visible and understandable.

## Phase 2: Shared CRUD, Forms, Photos, and Files

Goal: implement reusable building blocks before app-specific screens.

Deliverables:

- Shared CRUD page pattern:
  - List.
  - View.
  - Create.
  - Edit.
  - Top-level copy only.
  - Delete.
  - Complete where available.
- Shared form system for:
  - Text inputs.
  - Long text areas.
  - Dates.
  - Numbers.
  - Selects.
  - Boolean/toggle fields.
  - Repeated sections.
  - Nested child records.
  - Photo fields.
  - Product-contract-driven validation. Required-field rules apply only where
    that product defines them; Field App Complete business fields/evidence stay
    optional and use TBC-only completion readiness.
- Shared photo component:
  - Preview.
  - Upload.
  - Replace.
  - Delete.
  - Description/metadata where supported.
  - Multiple-photo fields.
- Shared file browser:
  - Photos.
  - PDFs.
  - Other generated/downloadable files.
  - Name-or-id lookup support.
- Shared ZIP download flow.
- Shared PDF job flow:
  - Start job.
  - Show progress/status.
  - Download result.
  - Regenerate result.
  - Show failures clearly.

Exit criteria:

- One representative top-level record can be created, edited, copied, deleted, and file-managed using shared components.
- Photo upload/download/delete is proven in the browser.
- PDF job polling and download is proven in the browser.

## Phase 3: SolarSense Module

Goal: deliver complete SolarSense web parity for editable data, photos, ZIPs, and PDFs.

Deliverables:

- SolarSense dashboard/list landing page.
- Site pack list and detail.
- Site CRUD:
  - Create, view, copy, edit, delete.
  - Mark complete where supported.
  - Manage appendix items.
  - Manage site-level PDF and ZIP downloads.
- Rooftop assessment CRUD:
  - Create, view, edit, delete.
  - Mark complete where supported.
  - Edit roof, structure, electrical, viability, and notes data.
  - Edit switchboards.
  - Edit other considerations.
  - Edit all assessment photo fields.
- SolarSense photo browser:
  - Per site.
  - Per assessment.
  - Delete photos where permitted.
  - ZIP selected/all photos.
- SolarSense PDF:
  - Generate site pack PDF.
  - Generate/regenerate assessment report where available.
  - Show job progress and download history/current report.
- SolarSense admin/settings:
  - User list.
  - Add/edit inspectors/users where permitted.
  - Change/reset password where supported.
  - Diagnostics and sync/account status where useful.

Exit criteria:

- Every SolarSense mobile-editable data item has a web edit path.
- Existing SolarSense records can be opened and edited based on role.
- SolarSense PDFs and ZIP downloads work from the web.
- SolarSense photo upload, delete, and backup behavior are verified.

## Phase 4: EcoAudit Pro Module

Goal: deliver complete EcoAudit Pro web parity for editable data, photos, ZIPs, and PDFs.

Deliverables:

- EcoAudit dashboard/list landing page.
- Audit CRUD:
  - Create, view, copy, edit, delete.
  - Mark complete where supported.
  - Edit audit metadata and inspector assignment.
- Zone CRUD:
  - Create, view, edit, delete.
  - Manage zone photos and photo descriptions.
- Equipment CRUD for every equipment category:
  - Main switchboards.
  - Additional switchboards.
  - HVAC units.
  - Lighting systems.
  - Solar PV.
  - Forklift chargers.
  - Hot water systems.
  - General water.
  - General electricity.
- EcoAudit photo browser:
  - Per audit.
  - Per zone/equipment group where useful.
  - Delete photos where permitted.
  - ZIP selected/all photos.
- EcoAudit PDF:
  - Generate audit report PDF.
  - Show job progress.
  - Download current generated report.
  - Regenerate report.
- EcoAudit admin/settings:
  - User list.
  - Add/edit inspectors/users where permitted.
  - Change/reset password where supported.
  - Diagnostics and sync/account status where useful.

Exit criteria:

- Every EcoAudit mobile-editable data item has a web edit path.
- Existing EcoAudit records can be opened and edited based on role.
- All nine equipment categories have complete CRUD forms.
- EcoAudit PDFs and ZIP downloads work from the web.
- EcoAudit photo upload, delete, and backup behavior are verified.

## Phase 5: Existing Data, Storage, and OneDrive Alignment

Goal: make old and new data behave consistently in the web UI and backup storage.

Deliverables:

- Backfill/migration plan for existing storage names if needed.
- Verify name-based folder convention for:
  - SolarSense sites.
  - SolarSense assessments.
  - EcoAudit audits.
  - EcoAudit zones/equipment where applicable.
- Verify legacy ID-based storage remains accessible.
- Verify APIs can browse files by record ID or exact readable name.
- Verify delete/download operations do not break old records.
- Verify OneDrive backup for:
  - New photos.
  - Existing/backfilled photos.
  - Generated PDFs.
- Add one-time job or admin script if existing files must be renamed or copied.
- Produce verification report showing sample old and new records.

Exit criteria:

- Existing records are visible in web UI.
- Existing photos and PDFs are accessible.
- New uploads use the latest naming convention.
- OneDrive contains the expected name-based folder structure after migration/backfill.

## Phase 6: QA, Deployment, and Handover

Goal: prove production readiness and leave a repeatable operating process.

Deliverables:

- Role/access test pass:
  - Admin SolarSense.
  - Inspector/user SolarSense.
  - Admin EcoAudit.
  - Inspector/user EcoAudit.
  - Users with access to both apps.
- CRUD test pass for every entity.
- File test pass:
  - Upload photo.
  - Download photo.
  - Delete photo.
  - ZIP download.
  - PDF generation.
  - PDF download.
  - OneDrive backup verification.
- Regression checks for existing mobile API behavior, including installed Field
  App Complete client compatibility if shared components or contracts change.
- Production deploy to current DigitalOcean environment.
- Smoke test production login, CRUD, PDF, ZIP, and OneDrive backup.
- Rollback notes.
- Admin/user handover notes.

Exit criteria:

- Production smoke test passes.
- No critical CRUD, access, PDF, ZIP, or photo backup blockers remain.
- Handover instructions are available.

## Known Backend Dependencies and Gaps to Confirm

- Top-level copy endpoints must remain the only copy endpoints exposed to the web UI.
- Direct browser photo upload must be supported using existing upload session/sync APIs or a new web-specific upload endpoint.
- User management coverage must be confirmed for edit/reset-password/role changes.
- Lighting system field mapping should be verified between mobile and backend naming for switchboard/control photos or notes.
- Storage browser routes must support both ID and readable-name lookup for all required file operations.
- OneDrive backup should cover PDFs as well as photos.
- Existing record/file migration must be idempotent to avoid duplicate files.
