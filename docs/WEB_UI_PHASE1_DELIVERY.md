# SustainabilityWiseUI Phase 1 Delivery

Prepared: 19 June 2026

## Phase Delivered

Phase 1: **Web App Foundation**

This phase adds the frontend foundation for SustainabilityWiseUI inside the existing API repository. It does not implement CRUD forms yet; those start in the later shared CRUD and app-module phases.

## Delivered Scope

- React + TypeScript + Vite web portal under `web/`.
- App-level login screen for:
  - SolarSense.
  - EcoAudit Pro.
- Existing API auth integration:
  - `POST /v1/auth/login`.
  - `POST /v1/auth/refresh`.
  - `POST /v1/auth/logout`.
  - `GET /v1/auth/me`.
- Stored browser sessions per app namespace.
- App switcher for SolarSense and EcoAudit Pro.
- Protected route handling.
- App namespace route handling.
- Admin-only navigation visibility.
- Access denied state for admin-only pages.
- Shared page shell:
  - Sidebar navigation.
  - Top user/session area.
  - Sign-out action.
  - Responsive desktop/tablet/mobile layout.
- Phase 1 module landing pages for:
  - SolarSense overview, sites, assessments, photos, PDFs, ZIP downloads, admin.
  - EcoAudit overview, audits, zones, equipment, photos, PDFs, ZIP downloads, admin.
- Utility pages:
  - Settings.
  - Diagnostics.
  - API Keys placeholder for admins.
  - System placeholder for admins.
  - Backlog view.
- API health check display on Diagnostics.
- Production frontend build script.
- Fastify static serving for `web/dist`.
- SPA route fallback for browser routes.
- `/v1/*` routes remain API-only and are not swallowed by the SPA fallback.

## Key Files Added

- `web/index.html`
- `web/vite.config.ts`
- `web/tsconfig.json`
- `web/src/main.tsx`
- `web/src/App.tsx`
- `web/src/styles.css`
- `web/src/lib/api.ts`
- `web/src/lib/auth.tsx`
- `web/src/lib/navigation.ts`
- `web/src/lib/types.ts`
- `web/src/components/Shell.tsx`
- `web/src/pages/LoginPage.tsx`
- `web/src/pages/ModulePage.tsx`
- `web/src/pages/DiagnosticsPage.tsx`
- `web/src/pages/SettingsPage.tsx`
- `web/src/pages/BacklogPage.tsx`
- `web/src/pages/AccessDeniedPage.tsx`

## Existing Files Updated

- `package.json`
  - Added web scripts.
  - Added frontend dependencies.
  - Extended `typecheck` to check API and web code.
- `package-lock.json`
  - Updated dependency lockfile.
- `.gitignore`
  - Ignores generated web build output.
- `src/app.ts`
  - Serves built web portal when `web/dist` exists.
  - Keeps API 404 behavior for `/v1/*`.

## Commands Verified

```bash
npm run typecheck
npm run web:build
```

Both commands passed.

Frontend build output was generated successfully:

```text
web/dist/index.html
web/dist/assets/*.css
web/dist/assets/*.js
```

HTTP smoke checks against Vite preview passed:

```bash
npm run web:preview -- --host 127.0.0.1
curl -I http://127.0.0.1:4173/
curl -I http://127.0.0.1:4173/solarsense/sites
curl -I 'http://127.0.0.1:4173/login?app=ecoaudit'
```

All returned `200 OK`.

## Browser Verification Note

The in-app browser connector was unavailable in this session, so visual browser automation could not be completed through that tool. The production build, static HTML entry, asset delivery, and SPA route fallback were verified with Vite preview and HTTP checks.

Manual browser verification should be run with real credentials using the testing runbook.

## What Is Not Included Yet

The following are intentionally left for later phases:

- Shared CRUD forms.
- SolarSense site CRUD.
- SolarSense assessment CRUD.
- EcoAudit audit CRUD.
- EcoAudit zone CRUD.
- EcoAudit equipment CRUD.
- Photo upload/delete UI.
- ZIP download UI.
- PDF job UI.
- OneDrive backup UI/status beyond planning.
- User management CRUD UI.
- API key CRUD UI.

## Deployment Notes

The existing DigitalOcean hosting can serve the portal through the Fastify process after building the frontend:

```bash
npm ci
npm run build
pm2 restart sw-api
```

No Caddy change is expected for Phase 1 because Caddy already reverse-proxies all traffic to the Fastify API process.

