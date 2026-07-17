# SustainabilityWiseUI Feature Parity Checklist

Prepared: 18 June 2026

Use this checklist to make sure the web application covers the editable data and workflows already present in SolarSense and EcoAudit Pro.

Legend:

- `[ ]` Required for web implementation.
- `[VERIFY]` Confirm backend/API behavior or field mapping before implementation.
- `[BACKEND]` Backend work may be required.

## Shared Application Features

- [ ] App-level login.
- [ ] App switcher/navigation for SolarSense and EcoAudit Pro.
- [ ] Role-aware pages and actions.
- [ ] Access-aware record lists.
- [ ] Admin and inspector/user personas.
- [ ] Responsive desktop layout.
- [ ] Responsive tablet layout.
- [ ] Reasonable mobile browser support.
- [ ] Create records.
- [ ] View records.
- [ ] Copy records.
- [ ] Edit records.
- [ ] Delete records.
- [ ] Complete records where supported.
- [VERIFY] Reopen completed records.
- [ ] Completed-record read-only state where required.
- [ ] Search/filter lists.
- [ ] Confirmation dialogs for destructive actions.
- [ ] Error handling and validation messages.
- [ ] Storage browser for photos/PDFs/files.
- [ ] File lookup by record ID.
- [ ] File lookup by readable record name.
- [ ] Photo preview.
- [ ] Photo upload.
- [ ] Photo replace.
- [ ] Photo delete.
- [ ] Photo ZIP download.
- [ ] PDF generation.
- [ ] PDF job progress.
- [ ] PDF download.
- [ ] PDF regeneration.
- [ ] OneDrive backup verification for photos.
- [ ] OneDrive backup verification for PDFs.

## Shared Admin and Settings

- [ ] Current user/account page.
- [ ] User list.
- [ ] Add inspector/user.
- [ ] Edit inspector/user.
- [VERIFY] Reset user password.
- [VERIFY] Change own password.
- [VERIFY] Enable/disable user.
- [VERIFY] Edit user role/app access.
- [ ] App/cloud/sync status display.
- [ ] Diagnostics page.
- [ ] Storage/backup health display without exposing secrets.
- [VERIFY] API key management for admins if required.

## SolarSense Screens and Workflows

- [ ] SolarSense dashboard/list landing page.
- [ ] Site pack list.
- [ ] Site pack detail.
- [ ] Site create screen.
- [ ] Site edit screen.
- [ ] Site copy flow.
- [ ] Site delete flow.
- [ ] Site complete flow.
- [VERIFY] Site reopen flow.
- [ ] Assessment list.
- [ ] Assessment create screen.
- [ ] Assessment edit screen.
- [ ] Assessment detail screen.
- [ ] Assessment copy flow.
- [ ] Assessment delete flow.
- [ ] Assessment complete flow.
- [VERIFY] Assessment reopen flow.
- [ ] Site/assessment file browser.
- [ ] Site/assessment photo ZIP download.
- [ ] SolarSense PDF options.
- [ ] SolarSense PDF generation.
- [ ] SolarSense PDF progress/download/regenerate.
- [ ] SolarSense admin/settings.
- [ ] SolarSense diagnostics.

## SolarSense Site Editable Data

Every item below needs a web view/edit path and must persist to SQL/API.

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
- [ ] Appendix item type.
- [ ] Appendix item URI/file.
- [ ] Appendix item name.
- [ ] Report PDF local/remote status display where relevant.
- [ ] Sync/cloud status display where relevant.
- [ ] Imported-copy metadata display where relevant.

SolarSense site operations:

- [ ] List sites.
- [ ] View site.
- [ ] Create site.
- [ ] Copy site as editable draft.
- [ ] Edit site.
- [ ] Delete site.
- [ ] Mark site complete.
- [VERIFY] Reopen site.
- [ ] View linked assessments.
- [ ] Create assessment from site.
- [ ] Generate/download site pack PDF.
- [ ] Download site photos as ZIP.

## SolarSense Assessment Editable Data

Every item below needs a web view/edit path and must persist to SQL/API.

- [ ] Site ID/site link.
- [ ] Site name.
- [ ] Building ID/name.
- [ ] Heritage status.
- [ ] Heritage deal breaker.
- [ ] Aerial photo.
- [ ] Total roof area m2.
- [ ] Roof material.
- [ ] Roof framing type.
- [ ] Roof pitch angle.
- [ ] Roof construction material.
- [ ] Asbestos flag.
- [ ] Roof condition.
- [ ] Roof estimated age.
- [ ] Primary roof orientation.
- [ ] Roof shading sources.
- [ ] Roof shading usable percent.
- [ ] Roof orientation/shading notes.
- [ ] Structural feasibility.
- [ ] Structural risk flag.
- [ ] Usable roof area m2.
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
- [ ] Other considerations.
- [ ] Site representative feedback.
- [ ] Viability status.
- [ ] Deal breaker reason.
- [ ] RAG priority.
- [ ] Key assumptions/gaps.
- [ ] Additional photos.
- [ ] Photo metadata.
- [ ] Imported-copy metadata display where relevant.

SolarSense switchboards:

- [ ] Add switchboard.
- [ ] Edit switchboard.
- [ ] Delete switchboard.
- [ ] Panel name/ID.
- [ ] Location in building.
- [ ] Incoming supply voltage.
- [ ] Main breaker rating.
- [ ] Spare breakers.
- [ ] Photo.

SolarSense other considerations:

- [ ] Add other consideration.
- [ ] Edit other consideration.
- [ ] Delete other consideration.
- [ ] Issue.
- [ ] Details.
- [ ] Photos.

SolarSense assessment operations:

- [ ] List assessments.
- [ ] View assessment.
- [ ] Create assessment.
- [ ] Copy assessment as editable draft.
- [ ] Edit assessment.
- [ ] Delete assessment.
- [ ] Mark assessment complete.
- [VERIFY] Reopen assessment.
- [ ] Upload/download/delete assessment photos.
- [ ] Generate/download assessment PDF if supported separately.
- [ ] Include assessment data in site pack PDF.
- [ ] Download assessment photos as ZIP.

## SolarSense Photo Fields

- [ ] Assessment aerial photo.
- [ ] Assessment MSB photo.
- [ ] Switchboard photos.
- [ ] Other consideration photos.
- [ ] Additional assessment photos.
- [ ] Site appendix image/document files.
- [ ] Photo metadata/descriptions where stored.
- [ ] Existing photo download.
- [ ] Existing photo delete.
- [ ] New photo upload.
- [ ] OneDrive backup for new photos.
- [ ] Existing photo backfill/backup verification.

## EcoAudit Pro Screens and Workflows

- [ ] EcoAudit dashboard/list landing page.
- [ ] Audit list.
- [ ] Audit create screen.
- [ ] Audit edit screen.
- [ ] Audit detail/review screen.
- [ ] Audit copy flow.
- [ ] Audit delete flow.
- [ ] Audit complete flow.
- [VERIFY] Audit reopen flow.
- [ ] Zone list.
- [ ] Zone create screen.
- [ ] Zone edit screen.
- [ ] Zone delete flow.
- [ ] Zone workspace.
- [ ] Equipment category lists.
- [ ] Equipment create/edit/delete forms.
- [ ] Audit/zone/equipment photo browser.
- [ ] Audit photo ZIP download.
- [ ] EcoAudit PDF options.
- [ ] EcoAudit PDF generation.
- [ ] EcoAudit PDF progress/download/regenerate.
- [ ] EcoAudit admin/settings.
- [ ] EcoAudit diagnostics.

## EcoAudit Audit Editable Data

- [ ] Site name.
- [ ] Site address.
- [ ] Inspector name.
- [ ] Assigned inspector user.
- [ ] Audit date.
- [ ] Status.
- [ ] Sync/cloud mode where displayed.
- [ ] Report PDF local/remote status display where relevant.
- [ ] Imported-copy metadata display where relevant.

EcoAudit audit operations:

- [ ] List audits.
- [ ] View audit.
- [ ] Create audit.
- [ ] Copy audit as editable draft.
- [ ] Edit audit.
- [ ] Delete audit.
- [ ] Mark audit complete.
- [VERIFY] Reopen audit.
- [ ] Manage zones.
- [ ] Manage equipment.
- [ ] Generate/download audit PDF.
- [ ] Download audit photos as ZIP.

## EcoAudit Zone Editable Data

- [ ] Zone name.
- [ ] Zone description.
- [ ] Zone photos.
- [ ] Zone photo descriptions.

EcoAudit zone operations:

- [ ] List zones.
- [ ] View zone.
- [ ] Create zone.
- [ ] Copy zone if part of audit deep-copy.
- [ ] Edit zone.
- [ ] Delete zone.
- [ ] Manage zone equipment.
- [ ] Upload/download/delete zone photos.

## EcoAudit Equipment Editable Data

Each equipment category must support list, view, create, copy where applicable, edit, delete, photo upload, photo download, and photo delete.

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
- [VERIFY] Switchboard controls photo vs switchboard photo notes backend mapping.
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

## EcoAudit Photo Fields

- [ ] Zone photos.
- [ ] Main switchboard photo.
- [ ] Main switchboard extra photos.
- [ ] Additional switchboard photo.
- [ ] Additional switchboard extra photos.
- [ ] HVAC photo.
- [ ] HVAC nameplate photos.
- [ ] HVAC indoor unit nameplate photo.
- [ ] HVAC controller photo.
- [ ] HVAC extra photos.
- [ ] Lighting system photo.
- [ ] Lighting fixtures photo.
- [ ] Lighting mounting constraints photo.
- [ ] Lighting sensors photo.
- [VERIFY] Lighting switchboard/control photo field mapping.
- [ ] Lighting extra photos.
- [ ] Solar PV roof photo.
- [ ] Solar PV inverter label photo.
- [ ] Solar PV electricity meter photo.
- [ ] Solar PV additional solar space photo.
- [ ] Solar PV switchboard photo.
- [ ] Solar PV extra photos.
- [ ] Forklift charger photo.
- [ ] Forklift charger label photo.
- [ ] Forklift electric connection photo.
- [ ] Forklift charger space photo.
- [ ] Forklift socket connection photo.
- [ ] Forklift extra photos.
- [ ] Hot water system photo.
- [ ] Hot water additional photo.
- [ ] Hot water extra photos.
- [ ] General water photos.
- [ ] General water extra photos.
- [ ] General electricity photos.
- [ ] General electricity extra photos.
- [ ] Photo descriptions.
- [ ] Existing photo download.
- [ ] Existing photo delete.
- [ ] New photo upload.
- [ ] OneDrive backup for new photos.
- [ ] Existing photo backfill/backup verification.

## Copy and Delete Behavior Checklist

- [VERIFY] Copy SolarSense site should copy linked assessments or ask user which assessments to include.
- [VERIFY] Copy SolarSense assessment should include switchboards, other considerations, and photo references.
- [VERIFY] Copy EcoAudit audit should copy zones and equipment.
- [VERIFY] Copy EcoAudit zone should copy equipment if exposed as a direct action.
- [VERIFY] Copied records should become draft/editable records.
- [VERIFY] Copied records should not reuse completed status unless explicitly required.
- [VERIFY] Copied photos should either reference the same stored files or duplicate files based on agreed behavior.
- [VERIFY] Generated PDFs should normally be regenerated for copied records.
- [ ] Delete parent records should show impacted children/photos.
- [ ] Delete site should explain linked assessment impact.
- [ ] Delete audit should explain linked zone/equipment/photo impact.
- [ ] Delete photo should update both storage and SQL/API references.
- [ ] Delete actions should be blocked when role or status does not allow deletion.

## Storage, Naming, and OneDrive Checklist

- [ ] New SolarSense site folders use readable site names.
- [ ] New SolarSense assessment folders use readable assessment/building names.
- [ ] New EcoAudit audit folders use readable audit/site names.
- [ ] Existing legacy ID-based folders remain accessible.
- [ ] APIs accept record ID for file browsing.
- [ ] APIs accept readable name for file browsing.
- [ ] APIs accept record ID for file delete/download.
- [ ] APIs accept readable name for file delete/download.
- [ ] OneDrive path names match app storage naming convention.
- [ ] OneDrive receives photo backups.
- [ ] OneDrive receives PDF backups.
- [ ] Existing photos can be backfilled to OneDrive.
- [ ] Existing PDFs can be backfilled to OneDrive if required.
- [ ] Backfill job is idempotent.
- [ ] Backfill job avoids duplicate copies.
- [ ] Verification report lists sample records and OneDrive paths.

## Final Release Checklist

- [ ] SolarSense admin login tested.
- [ ] SolarSense inspector/user login tested.
- [ ] EcoAudit admin login tested.
- [ ] EcoAudit inspector/user login tested.
- [ ] User with both app accesses tested.
- [ ] SolarSense CRUD tested.
- [ ] EcoAudit audit/zone CRUD tested.
- [ ] EcoAudit all equipment CRUD tested.
- [ ] Copy flows tested.
- [ ] Delete flows tested.
- [ ] Completed-record behavior tested.
- [ ] Photo upload/download/delete tested.
- [ ] ZIP download tested.
- [ ] PDF generate/download/regenerate tested.
- [ ] OneDrive backup tested.
- [ ] Existing records tested.
- [ ] New records tested.
- [ ] Production build tested.
- [ ] DigitalOcean deployment tested.
- [ ] Rollback notes written.
- [ ] Handover notes written.

