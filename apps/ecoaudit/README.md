# EcoSense Portal

The combined, online-first web portal for EcoAudit Pro, SolarSense, InstallHub,
and Wattwatchers Fleet. It is a standalone Next.js service and does not replace
or serve the Fastify API.

## Configuration

Copy the safe template and set the server-only values in `.env.local`:

```bash
cp .env.example .env.local
```

- `INTERNAL_API_URL` is the API origin used by Next.js Route Handlers and
  rewrites. It can use a private network address in production.
- `NEXT_PUBLIC_API_URL` is the non-secret API origin displayed by the UI and
  used by the development rewrites.
- `ECOSENSE_PORTAL_PORT` configures the dedicated PM2 listener and defaults to
  `3210`; the local npm scripts use that same port.
- `PORTAL_REGISTRATION_ENABLED=true` enables portal self-registration.
- `ECOAUDIT_REGISTRATION_SECRET` and `SOLARSENSE_REGISTRATION_SECRET` are
  app-specific and read only by the registration Route Handler. Never prefix
  them with `NEXT_PUBLIC_`; public variables are embedded in browser code.

Registration stays disabled unless both the enable flag and secret are set.

## Development

```bash
npm ci
npm run dev
```

The portal has its own dedicated local address at <http://127.0.0.1:3210>. The
API commonly uses port 3000, so the two services do not compete for a port.
The development server also listens on the machine's LAN address for testing
from a connected phone; the production process remains loopback-only.

## Production

```bash
npm ci
# Load INTERNAL_API_URL before building; rewrites are resolved at build time.
npm run lint
npm run build
npm run start
```

Deploy this directory as its own service and route browser traffic to its port.
The portal forwards API calls to `INTERNAL_API_URL`/`NEXT_PUBLIC_API_URL` and keeps
authenticated thumbnail responses private in the browser cache.

## Features

- App-isolated portal authentication for EcoAudit Pro, SolarSense, InstallHub,
  and Wattwatchers Fleet
- Audit, zone, equipment, site, and assessment workflows
- InstallHub installation hierarchy, switchboards, embedded meters, site
  assets, commissioning forms, TBC resolution, evidence, reports, and cloud
  history
- InstallHub access assignment, password security, diagnostics, and
  administrator user management
- Authenticated 400 px photo thumbnails with ETag revalidation
- Photo upload, PDF generation, and original-photo ZIP exports
- Admin, diagnostics, settings, and scheduler workflows
