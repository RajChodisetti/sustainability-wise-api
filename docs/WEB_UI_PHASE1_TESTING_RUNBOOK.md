# SustainabilityWiseUI Phase 1 Testing Runbook

Prepared: 19 June 2026

## Purpose

Use this runbook to verify Phase 1 of the SustainabilityWiseUI web portal.

Phase 1 validates the app shell, login, sessions, app switching, route guards, role-aware navigation, diagnostics, build output, and production static serving behavior.

## Prerequisites

- Node.js 22 or newer.
- API environment variables configured.
- Database reachable for authenticated login tests.
- At least one SolarSense admin or inspector account.
- At least one EcoAudit Pro admin or inspector account.

## Local Build Checks

Run from the API repository root:

```bash
npm install
npm run typecheck
npm run web:build
```

Expected result:

- API TypeScript passes.
- Web TypeScript passes.
- Vite production build succeeds.
- `web/dist/index.html` exists.
- `web/dist/assets/` contains hashed JS/CSS assets.

## Local Preview Smoke Test

Start the built web preview:

```bash
npm run web:preview -- --host 127.0.0.1
```

In another terminal:

```bash
curl -I http://127.0.0.1:4173/
curl -I http://127.0.0.1:4173/solarsense/sites
curl -I 'http://127.0.0.1:4173/login?app=ecoaudit'
```

Expected result:

- Each command returns `200 OK`.
- The response content type is HTML for page routes.

Check static assets:

```bash
asset_js=$(sed -n 's/.*src="\([^"]*index-[^"]*\.js\)".*/\1/p' web/dist/index.html)
asset_css=$(sed -n 's/.*href="\([^"]*index-[^"]*\.css\)".*/\1/p' web/dist/index.html)
curl -I "http://127.0.0.1:4173${asset_js}"
curl -I "http://127.0.0.1:4173${asset_css}"
```

Expected result:

- JS asset returns `200 OK`.
- CSS asset returns `200 OK`.

## Local Dev Server Test

Start the API on port 3000:

```bash
npm run dev
```

Start the web dev server in another terminal:

```bash
npm run web:dev
```

Open:

```text
http://127.0.0.1:5173/
```

Expected result:

- The browser redirects to the login screen.
- The SolarSense and EcoAudit Pro app selector is visible.
- The page has no horizontal scroll at desktop, tablet, or mobile widths.

## Login Tests

SolarSense:

1. Open `http://127.0.0.1:5173/login?app=solarsense`.
2. Select SolarSense.
3. Sign in with a valid SolarSense user.
4. Confirm the app opens at `/solarsense`.
5. Confirm SolarSense navigation is visible.

EcoAudit Pro:

1. Open `http://127.0.0.1:5173/login?app=ecoaudit`.
2. Select EcoAudit Pro.
3. Sign in with a valid EcoAudit Pro user.
4. Confirm the app opens at `/ecoaudit`.
5. Confirm EcoAudit Pro navigation is visible.

Invalid credentials:

1. Enter an invalid password.
2. Confirm the form shows a clear error.
3. Confirm no session is created.

## App Switcher Tests

Single app session:

1. Sign into SolarSense only.
2. Click EcoAudit Pro in the app switcher.
3. Confirm the login page opens with EcoAudit Pro selected.

Two app sessions:

1. Sign into SolarSense.
2. Switch to EcoAudit Pro and sign in.
3. Use the app switcher to move between apps.
4. Confirm each app keeps its own session.

Expected result:

- Switching to an app with a stored session opens that app.
- Switching to an app without a stored session opens login for that app.

## Route Guard Tests

Unauthenticated:

```text
http://127.0.0.1:5173/solarsense/sites
http://127.0.0.1:5173/ecoaudit/audits
```

Expected result:

- Login page is shown.
- App selector matches the requested app route.

Wrong app session:

1. Sign into SolarSense only.
2. Open `/ecoaudit/audits`.

Expected result:

- EcoAudit login is shown unless an EcoAudit session already exists.

Admin-only:

1. Sign in as inspector/user.
2. Open `/solarsense/admin`, `/ecoaudit/admin`, `/api-keys`, or `/system`.

Expected result:

- Access denied is shown.
- Admin-only navigation items are not shown.

Admin:

1. Sign in as admin.
2. Confirm Admin navigation is visible for the active app.
3. Confirm `/api-keys` and `/system` are accessible.

## Diagnostics Tests

Open:

```text
http://127.0.0.1:5173/diagnostics
```

Expected result:

- API health status is shown.
- Current app namespace is shown.
- Current role is shown.
- Token issued time is shown.
- No secrets are displayed.

## Production Static Serving Test

Build the web portal:

```bash
npm run web:build
```

Start the API using a safe local environment:

```bash
npm run start
```

Check browser routes:

```bash
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3000/solarsense/sites
curl -I http://127.0.0.1:3000/ecoaudit/audits
```

Expected result:

- Browser routes return `200 OK` with HTML.

Check API routes remain separate:

```bash
curl -sS http://127.0.0.1:3000/v1/does-not-exist
```

Expected result:

```json
{"error":"Route /v1/does-not-exist not found","statusCode":404}
```

Check health:

```bash
curl -sS http://127.0.0.1:3000/health
```

Expected result:

```json
{"status":"ok","uptime":123}
```

The `uptime` value will vary.

## Production Deployment Check

On the DigitalOcean VM:

```bash
cd /opt/sw-api
git pull origin main
npm ci
npm run build
pm2 restart sw-api
pm2 logs sw-api --lines 80
```

Then verify:

```bash
curl -I https://api.sustainabilitywise.com.au/
curl -I https://api.sustainabilitywise.com.au/solarsense/sites
curl -I https://api.sustainabilitywise.com.au/ecoaudit/audits
curl -sS https://api.sustainabilitywise.com.au/health
```

Expected result:

- Web routes return HTML.
- `/health` returns JSON.
- Existing `/v1/*` API routes still work.

## Pass Criteria

- `npm run typecheck` passes.
- `npm run web:build` passes.
- Login works for at least one valid account.
- Invalid login fails clearly.
- Route guards protect app routes.
- App switcher works with one and two app sessions.
- Admin-only routes are hidden or blocked for inspector/user.
- Diagnostics shows health/session status without secrets.
- Production build is served from the API process.
- `/v1/*` API behavior is preserved.

