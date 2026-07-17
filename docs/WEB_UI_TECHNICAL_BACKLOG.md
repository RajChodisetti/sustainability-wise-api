# SustainabilityWiseUI Technical Backlog

Prepared: 18 June 2026

This backlog converts the implementation plan into buildable engineering tasks. Items are grouped by epic and should be refined into tickets before implementation.

## Epic 1: App Shell and Authentication

- [ ] Choose frontend app location and framework setup.
- [ ] Configure environment variables for API base URL and deployment target.
- [ ] Build login page using existing app-level auth.
- [ ] Support app selection during login where required.
- [ ] Store access/refresh tokens securely for browser use.
- [ ] Add token refresh handling.
- [ ] Add logout flow.
- [ ] Add current-user bootstrap from `/me` or equivalent endpoint.
- [ ] Add protected routes.
- [ ] Add unauthenticated redirect behavior.
- [ ] Add global API error handling.
- [ ] Add session expiry handling.

Acceptance checks:

- [ ] Valid users can log in.
- [ ] Invalid users get a clear error.
- [ ] Expired sessions redirect to login.
- [ ] Logged-out users cannot access protected pages directly.

## Epic 2: App Switcher, Navigation, and Access Control

- [ ] Build SustainabilityWiseUI layout.
- [ ] Add top-level app switcher for SolarSense and EcoAudit Pro.
- [ ] Hide apps the logged-in user cannot access.
- [ ] Add module-specific side/top navigation.
- [ ] Add admin/settings navigation where permitted.
- [ ] Add route-level role checks.
- [ ] Add action-level permission checks for create/edit/delete/complete and top-level copy.
- [ ] Add access-denied page/state.
- [ ] Add audit-safe delete confirmations.

Acceptance checks:

- [ ] Admin sees admin actions.
- [ ] Inspector/user sees only allowed actions.
- [ ] A user with one app cannot access the other app by URL.
- [ ] Disabled/hidden actions match backend permissions.

## Epic 3: API Client and Data Layer

- [ ] Create typed API client.
- [ ] Add request helpers for GET/POST/PATCH/DELETE.
- [ ] Add upload/download helpers.
- [ ] Add pagination/search parameter helpers.
- [ ] Add response normalization for list/detail pages.
- [ ] Add shared mutation handling for create/update/delete.
- [ ] Add optimistic or refresh-after-save behavior.
- [ ] Add backend error-to-form-field mapping where available.
- [ ] Add consistent loading, empty, and error states.

Acceptance checks:

- [ ] API errors are visible and useful.
- [ ] Mutations refresh stale list/detail data.
- [ ] Downloads preserve filenames where possible.

## Epic 4: Shared CRUD and Form Components

- [ ] Create reusable list page component.
- [ ] Create reusable detail header with status/actions.
- [ ] Create reusable create/edit form wrapper.
- [ ] Create reusable delete confirmation dialog.
- [ ] Create reusable top-level copy confirmation dialog.
- [ ] Create reusable complete controls.
- [ ] Create reusable field components:
  - [ ] Text.
  - [ ] Multiline text.
  - [ ] Number.
  - [ ] Date.
  - [ ] Select.
  - [ ] Toggle/checkbox.
  - [ ] Repeated section.
  - [ ] Nested child record section.
  - [ ] Photo field.
  - [ ] Multi-photo field.
- [ ] Add validation for required fields and numeric constraints.
- [ ] Add dirty-form warning on navigation.
- [ ] Add completed-record read-only mode.
- [ ] Add top-level copy-as-draft mode.

Acceptance checks:

- [ ] Forms work on desktop and tablet.
- [ ] Long field labels and values do not break layout.
- [ ] Completed records cannot be edited directly; changes require a top-level draft copy.

## Epic 5: Shared Photo, File, ZIP, and PDF Features

- [ ] Build photo preview grid/list.
- [ ] Build single-photo upload field.
- [ ] Build multi-photo upload field.
- [ ] Build photo description/metadata editing where supported.
- [ ] Add replace-photo behavior.
- [ ] Add delete-photo behavior with confirmation.
- [ ] Add per-record photo browser.
- [ ] Add file browser for photos, PDFs, and stored files.
- [ ] Add name-or-id lookup support in file browser calls.
- [ ] Add ZIP download flow.
- [ ] Add PDF job create flow.
- [ ] Add PDF job polling/progress.
- [ ] Add PDF download flow.
- [ ] Add PDF regenerate flow.
- [ ] Add failed-job display and retry.
- [ ] Verify browser uploads trigger OneDrive backup where enabled.

Acceptance checks:

- [ ] Existing photos open from old records.
- [ ] New photos upload and can be downloaded.
- [ ] Photo delete removes or unlinks the right asset.
- [ ] ZIP download includes expected photos.
- [ ] PDF generation completes and downloads.
- [ ] Generated PDFs are backed up to OneDrive where configured.

## Epic 6: SolarSense Sites

- [ ] Build SolarSense site list.
- [ ] Build site detail page.
- [ ] Build site create/edit form.
- [ ] Add site copy flow.
- [ ] Add site delete flow.
- [ ] Add mark-complete flow.
- [ ] Enforce copied site naming as full original name plus short random suffix.
- [ ] Add site assessment list within site detail.
- [ ] Add site PDF/ZIP actions.
- [ ] Add appendix item management.
- [ ] Add site storage browser by ID and name.

Fields to support:

- [ ] Site name.
- [ ] Location.
- [ ] Date of assessment.
- [ ] Document classification.
- [ ] Electrical infrastructure summary.
- [ ] Known constraints.
- [ ] Load profile/metering summary.
- [ ] PPA/asset demarcation.
- [ ] Appendix notes.
- [ ] Appendix items.
- [ ] Cloud/sync status where displayed.
- [ ] Report PDF status/link.

## Epic 7: SolarSense Rooftop Assessments

- [ ] Build assessment list.
- [ ] Build assessment detail page.
- [ ] Build assessment create/edit form.
- [ ] Add assessment delete flow.
- [ ] Add mark-complete flow.
- [ ] Add site picker/link.
- [ ] Add switchboard repeated section.
- [ ] Add other considerations repeated section.
- [ ] Add additional photos management.
- [ ] Add assessment storage browser by ID and name.

Fields to support:

- [ ] Site/site name.
- [ ] Building ID/name.
- [ ] Heritage status.
- [ ] Heritage deal breaker.
- [ ] Aerial photo.
- [ ] Total roof area.
- [ ] Roof material.
- [ ] Roof framing type.
- [ ] Roof pitch angle.
- [ ] Roof construction material.
- [ ] Asbestos flag.
- [ ] Roof condition.
- [ ] Roof estimated age.
- [ ] Primary roof orientation.
- [ ] Roof shading sources.
- [ ] Roof shading usable percentage.
- [ ] Roof orientation/shading notes.
- [ ] Structural feasibility.
- [ ] Structural risk flag.
- [ ] Usable roof area.
- [ ] PV size kW DC.
- [ ] AC export kW.
- [ ] Access/safety constraints.
- [ ] MSB details.
- [ ] MSB photo.
- [ ] Existing generation.
- [ ] Distance to connection.
- [ ] Electrical pits entry.
- [ ] Inverter siting.
- [ ] Transformer/supply capacity.
- [ ] DNSP constraints.
- [ ] Load profile/metering.
- [ ] Site representative feedback.
- [ ] Viability status.
- [ ] Deal breaker reason.
- [ ] RAG priority.
- [ ] Key assumptions/gaps.
- [ ] Photo metadata.

Switchboard fields:

- [ ] Panel name/ID.
- [ ] Location in building.
- [ ] Incoming supply voltage.
- [ ] Main breaker rating.
- [ ] Spare breakers.
- [ ] Switchboard photo.

Other consideration fields:

- [ ] Issue.
- [ ] Details.
- [ ] Photos.

## Epic 8: EcoAudit Audits and Zones

- [ ] Build EcoAudit audit list.
- [ ] Build audit detail/review page.
- [ ] Build audit create/edit form.
- [ ] Add audit copy flow.
- [ ] Add audit delete flow.
- [ ] Add mark-complete flow.
- [ ] Enforce copied audit naming as full original name plus short random suffix.
- [ ] Add assigned inspector picker.
- [ ] Add zone list within audit.
- [ ] Add zone create/edit/delete.
- [ ] Add zone photos and descriptions.
- [ ] Add audit PDF/ZIP actions.
- [ ] Add audit storage browser by ID and name.

Audit fields:

- [ ] Site name.
- [ ] Site address.
- [ ] Inspector name.
- [ ] Assigned inspector user.
- [ ] Audit date.
- [ ] Status.
- [ ] Sync/cloud mode where displayed.
- [ ] Report PDF status/link.

Zone fields:

- [ ] Zone name.
- [ ] Zone description.
- [ ] Zone photos.
- [ ] Photo descriptions.

## Epic 9: EcoAudit Equipment CRUD

Build list/create/edit/delete support for every equipment category below. Each category must be reachable from the audit/zone workspace and must respect completed-record locks and user permissions. Equipment copy is intentionally not available; copy happens only at the audit level.

### Main Switchboards

- [ ] Name.
- [ ] Location.
- [ ] Map locator.
- [ ] Site NMI.
- [ ] Photo.
- [ ] Sub-circuits description.
- [ ] Comments.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### Additional Switchboards

- [ ] Name.
- [ ] Location.
- [ ] Map locator.
- [ ] Type.
- [ ] Photo.
- [ ] Sub-circuits description.
- [ ] Comments.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### HVAC Units

- [ ] Unit name.
- [ ] Make.
- [ ] Photo.
- [ ] Location.
- [ ] Type.
- [ ] Model.
- [ ] Serial number.
- [ ] Heating capacity kW.
- [ ] Cooling capacity kW.
- [ ] Power supply phase.
- [ ] Nameplate photos.
- [ ] Indoor unit model.
- [ ] Indoor unit serial.
- [ ] Indoor unit nameplate photo.
- [ ] Controller type.
- [ ] Controller model.
- [ ] Controller photo.
- [ ] Temperature sensor type.
- [ ] System coverage.
- [ ] Energy improvement observations.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### Lighting Systems

- [ ] Light type.
- [ ] Brand/model.
- [ ] Photo.
- [ ] Rated wattage.
- [ ] Quantity.
- [ ] Fixtures installed.
- [ ] Fixtures photo.
- [ ] Area/location.
- [ ] Controls type.
- [ ] Operating hours.
- [ ] Mounting height.
- [ ] Mounting constraints photo.
- [ ] Circuit grouping.
- [ ] Sensors photo.
- [ ] Access limitations.
- [ ] Switchboard/control photo or notes mapping.
- [ ] Energy improvement observations.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### Solar PV

- [ ] System size kW.
- [ ] Roof photo.
- [ ] Inverter brand/model.
- [ ] Inverter location.
- [ ] Inverter label photo.
- [ ] Power supply to PV.
- [ ] Electricity meter photo.
- [ ] Available roof space.
- [ ] Roof space amount.
- [ ] Additional solar space photo.
- [ ] Suitable switchboard.
- [ ] Switchboard photo.
- [ ] Switchboard location.
- [ ] Cable distance.
- [ ] Cable route description.
- [ ] Energy improvement observations.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### Forklift Chargers

- [ ] Charger type.
- [ ] Charger photo.
- [ ] Brand/model.
- [ ] Rating.
- [ ] Charger label photo.
- [ ] Power supply.
- [ ] Electric connection photo.
- [ ] Location.
- [ ] Quantity.
- [ ] Charger space photo.
- [ ] Connection description.
- [ ] Socket connection photo.
- [ ] Local isolator.
- [ ] Circuit identifiable.
- [ ] Distance to switchboard.
- [ ] Space for additional charger.
- [ ] Hardwired/socket.
- [ ] Scheduling opportunity.
- [ ] Energy improvement observations.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### Hot Water Systems

- [ ] DHW details/type.
- [ ] Photo.
- [ ] Serial number.
- [ ] Size litres.
- [ ] Fuel type.
- [ ] Location.
- [ ] Pipe insulation.
- [ ] Pipe insulation thickness.
- [ ] Tempering valve.
- [ ] Additional photo.
- [ ] More DHW systems.
- [ ] Additional comments.
- [ ] Energy improvement observations.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### General Water

- [ ] Question.
- [ ] Answer.
- [ ] Photos.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

### General Electricity

- [ ] Question.
- [ ] Answer.
- [ ] Photos.
- [ ] Extra notes.
- [ ] Extra photos.
- [ ] Photo descriptions.

## Epic 10: Admin, Users, Settings, and Diagnostics

- [ ] Build admin user list for each app.
- [ ] Build add inspector/user flow.
- [ ] Build user detail/edit flow.
- [ ] Build role/status update flow if backend supports it.
- [ ] Build password reset/change-password flows where supported.
- [ ] Build current-account page.
- [ ] Build cloud/sync account status view.
- [ ] Build diagnostics page:
  - [ ] API health.
  - [ ] Auth/session state.
  - [ ] Storage/backup config visible status.
  - [ ] Last PDF job status where useful.
- [ ] Build admin-only API key page if required.

Acceptance checks:

- [ ] Admin can manage users within allowed app scope.
- [ ] Inspector/user cannot access admin screens.
- [ ] Diagnostics do not expose secrets.

## Epic 11: Backend Support Tasks

- [ ] Add or confirm top-level copy APIs for SolarSense sites and EcoAudit audits only.
- [ ] Confirm completed records remain locked and do not expose reopen actions.
- [ ] Add or confirm direct web photo upload endpoint/session flow.
- [ ] Add or confirm photo delete APIs update SQL fields and storage consistently.
- [ ] Add or confirm PDF backup to OneDrive.
- [ ] Add or confirm storage browser supports ID and readable-name parameters.
- [ ] Add or confirm name-based storage path generation for new records.
- [ ] Add one-time storage/OneDrive migration script for old ID-based paths if required.
- [ ] Ensure migration is idempotent and duplicate-safe.
- [ ] Verify lighting system switchboard/control photo field mapping.
- [ ] Verify user management endpoint coverage.
- [ ] Add backend tests for new or changed routes.

Acceptance checks:

- [ ] Existing mobile sync still works.
- [ ] Existing old records still open.
- [ ] New web-created records sync/display correctly.
- [ ] OneDrive backup does not create duplicate files on retry.

## Epic 12: QA, Deployment, and Release

- [ ] Create test users for each app/role combination.
- [ ] Build QA checklist for SolarSense.
- [ ] Build QA checklist for EcoAudit Pro.
- [ ] Run CRUD tests for all entities.
- [ ] Run photo upload/download/delete tests.
- [ ] Run ZIP download tests.
- [ ] Run PDF generation/download/regeneration tests.
- [ ] Run OneDrive backup verification.
- [ ] Run production build.
- [ ] Deploy to current DigitalOcean environment.
- [ ] Run production smoke test.
- [ ] Document rollback steps.
- [ ] Document admin handover steps.

Release gate:

- [ ] Login works in production.
- [ ] Both modules load in production.
- [ ] Admin and inspector/user access are correct.
- [ ] CRUD works for representative records in both modules.
- [ ] Photos, ZIPs, PDFs, and OneDrive backup work in production.
