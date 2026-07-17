# SustainabilityWiseUI Phase 2-4 Business Testing Runbook

Prepared: 19 June 2026

## Purpose

This runbook verifies the web portal by business workflow instead of testing every field one by one.

Use disposable test records where possible. Do not delete production photos, audits, sites, or PDFs unless they were created specifically for testing.

## Prerequisites

- API environment variables configured.
- Database reachable.
- Web build deployed or local dev server running.
- One SolarSense admin or inspector/user login.
- One EcoAudit Pro admin or inspector/user login.
- At least one known existing SolarSense site with photos or PDFs, if available.
- At least one known existing EcoAudit audit with photos or PDFs, if available.

## Build Verification

Run:

```bash
npm install
npm run typecheck
npm run web:build
```

Pass criteria:

- API typecheck passes.
- Web typecheck passes.
- Web build succeeds.
- `web/dist/index.html` is generated.

## API Boundary Verification

The web portal must use the API server only.

Check:

```bash
rg "fetch\\(|DATABASE|postgres|S3|s3|storage|db\\." web/src
```

Pass criteria:

- Web code uses `fetch` only through the shared API client.
- No web code imports database, storage, S3/Spaces, or OneDrive server modules.
- File download/upload URLs are API-served URLs returned by the API server.

## Local Web Smoke

Start the API:

```bash
npm run dev
```

Start the web app:

```bash
npm run web:dev
```

To point local web testing at the production API server, use the API origin, not the `/v1` route prefix:

```bash
VITE_API_BASE_URL=https://api.sustainabilitywise.com.au npm run web:dev
```

Open:

```text
http://127.0.0.1:5173/
```

Pass criteria:

- Login screen opens.
- SolarSense and EcoAudit Pro can be selected.
- No crash page appears.

## Test 1: Login, Roles, and App Switching

1. Sign in to SolarSense.
2. Confirm SolarSense navigation opens.
3. Switch to EcoAudit Pro.
4. If no EcoAudit session exists, confirm EcoAudit login opens.
5. Sign in to EcoAudit Pro.
6. Switch back to SolarSense.
7. Compare admin vs inspector/user navigation if both logins are available.

Pass criteria:

- Each app keeps its own session.
- App switcher opens an existing session or asks for login.
- Users only see pages and actions allowed by their role.

## Test 2: SolarSense Business Workflow

Use a disposable site and assessment.

1. Open `SolarSense > Sites`.
2. Create a new site with site name, location, assessment date, and report notes.
3. Save, reload the list, and confirm the site appears.
4. Edit the site and change one report note.
5. Open `SolarSense > Assessments`.
6. Enter the site ID for the disposable site and load assessments.
7. Create an assessment with building name, roof area, roof material, viability status, and one JSON field such as `additionalPhotos`.
8. Edit the assessment and change one roof/electrical field.
9. Complete the assessment and confirm it becomes locked.
10. Confirm there is no assessment-level copy action.
11. Go back to `SolarSense > Sites`.
12. Copy the site and save the copy as a draft.
13. Confirm the copied site name keeps the full original site name plus a short random suffix.
14. Load assessments for the copied site and confirm the child assessment was copied.
15. Complete the original disposable site and confirm it becomes locked.
16. Confirm there is no reopen action; changes should happen on the draft copy.
17. Delete only the disposable copied records.

Pass criteria:

- Site create, edit, copy, complete, and delete work.
- Server-side site copy can copy child assessments.
- Site copy names follow `Full Original Name xxxx`.
- Assessment create, edit, complete, and delete work under a site.
- Assessment copy is not available.
- Completed records cannot be edited directly.
- Completed records do not reopen; copy the top-level site to change completed child data.
- JSON fields show readable validation errors if invalid JSON is entered.

## Test 3: EcoAudit Pro Business Workflow

Use a disposable audit, zone, and equipment records.

1. Open `EcoAudit Pro > Audits`.
2. Create a new audit with site name, address, inspector name, and audit date.
3. Save, reload the list, and confirm the audit appears.
4. Edit the audit and change one field.
5. Open `EcoAudit Pro > Zones`.
6. Enter the audit ID and create a zone with a zone name and description.
7. Open `EcoAudit Pro > Equipment`.
8. Enter the audit ID and zone ID.
9. Create one `Main Switchboards` record.
10. Switch to `HVAC Units` and create one record with numeric capacity fields.
11. Switch to `General Water` or `General Electricity` and create one question/answer record with photo references.
12. Quickly switch through the remaining equipment categories and confirm each loads a form without crashing.
13. Confirm there is no zone-level or equipment-level copy action.
14. Go back to `EcoAudit Pro > Audits`.
15. Copy the audit and save the copy as a draft.
16. Confirm the copied audit name keeps the full original audit name plus a short random suffix.
17. Confirm the copied audit has copied zones and representative equipment.
18. Complete the original disposable audit and confirm it becomes locked.
19. Confirm there is no reopen action; changes should happen on the draft copy.
20. Delete only disposable equipment, zone, and copied audit records.

Pass criteria:

- Audit create, edit, copy, complete, and delete work.
- Server-side audit copy can copy zones and equipment.
- Audit copy names follow `Full Original Name xxxx`.
- Zone create, edit, and delete work under an audit.
- Zone copy is not available.
- Equipment create, edit, and delete work for representative categories.
- Equipment copy is not available.
- All nine equipment category forms load.
- Equipment lists are scoped to the selected audit and zone.

## Test 4: Stored Files and Photos

SolarSense:

1. Open `SolarSense > Photos`.
2. Select `SolarSense site`.
3. Enter a known site name or site ID.
4. Click `Load`.
5. Repeat for `SolarSense assessment` if an assessment record is available.

EcoAudit Pro:

1. Open `EcoAudit Pro > Photos`.
2. Enter a known audit name or audit ID.
3. Click `Load`.

Pass criteria:

- Stored file table loads for records with files.
- Empty states are clear for records without files.
- Download links open stored files.
- Photo registry table loads for site/audit level records.
- Errors are readable when a record is not found.

## Test 5: Admin Photo Delete Guardrail

Use only a disposable photo.

1. Sign in as inspector/user.
2. Open the photo browser for a record with photos.
3. Confirm delete controls are not available.
4. Sign in as admin.
5. Open the same record.
6. Delete the disposable photo.
7. Confirm the delete dialog appears before deletion.

Pass criteria:

- Inspector/user cannot delete photos.
- Admin can delete photos.
- Delete requires confirmation.
- The list reloads after delete.

## Test 6: ZIP Downloads

SolarSense:

1. Open `SolarSense > ZIP Downloads`.
2. Enter a known site name or ID.
3. Click `Download ZIP`.

EcoAudit Pro:

1. Open `EcoAudit Pro > ZIP Downloads`.
2. Enter a known audit name or ID.
3. Click `Download ZIP`.

Pass criteria:

- ZIP download starts for records with photos.
- Records without photos return a clear result and do not crash the page.
- Invalid names/IDs show readable errors.

## Test 7: PDF Jobs

SolarSense:

1. Open `SolarSense > PDFs`.
2. Enter a known SolarSense site ID.
3. Optionally enter assessment IDs.
4. Start the PDF job.
5. Wait for completion.
6. Download the PDF.

EcoAudit Pro:

1. Open `EcoAudit Pro > PDFs`.
2. Enter a known EcoAudit audit ID.
3. Choose `By equipment` or `By zone`.
4. Optionally enter zone IDs.
5. Start the PDF job.
6. Wait for completion.
7. Download the PDF.

Pass criteria:

- Job starts.
- Status/progress updates.
- Completed job can be downloaded.
- Failed jobs show readable errors.

## Test 8: Responsive Layout

Check these widths:

- Desktop around `1440 px`.
- Tablet around `768 px`.
- Mobile around `390 px`.

Pass criteria:

- Sidebar works on desktop.
- Mobile navigation opens and closes.
- Tables scroll inside their container instead of breaking the page.
- Forms stack cleanly on narrow screens.
- No text overlaps controls.

## Production Smoke Test

After deploying:

```bash
curl -I https://api.sustainabilitywise.com.au/
curl -I https://api.sustainabilitywise.com.au/v1
curl -I https://api.sustainabilitywise.com.au/solarsense/sites
curl -I https://api.sustainabilitywise.com.au/ecoaudit/audits
curl -sS https://api.sustainabilitywise.com.au/health
```

Pass criteria:

- Web routes return HTML.
- `/v1` may return API JSON 404 because it is a route prefix, not a standalone endpoint.
- `/health` returns JSON.
- Existing `/v1/*` API routes still work.

Then run the business tests above against production using safe sample records.

## Overall Pass Criteria

- Build and typecheck pass.
- Login and app switching work.
- SolarSense live CRUD works for sites and assessments.
- EcoAudit live CRUD works for audits, zones, and representative equipment categories.
- All nine equipment category forms load.
- File/photo browser works for known records.
- ZIP download works for known records.
- PDF job flow works for known records.
- Admin/inspector photo delete permissions are respected.
- Layout is usable on desktop and tablet, with reasonable mobile browser behavior.
