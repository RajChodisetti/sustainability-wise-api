# EcoSense Portal

The combined, online-first web portal for EcoAudit Pro and SolarSense. It is a
standalone Next.js service and does not replace or serve the Fastify API.

## Configuration

Copy the safe template and set the server-only values in `.env.local`:

```bash
cp .env.example .env.local
```

- `INTERNAL_API_URL` is the API origin used by Next.js Route Handlers and
  rewrites. It can use a private network address in production.
- `NEXT_PUBLIC_API_URL` is the non-secret API origin displayed by the UI and
  used by the development rewrites.
- `PORTAL_REGISTRATION_ENABLED=true` enables portal self-registration.
- `REGISTRATION_SECRET` is read only by the registration Route Handler. Never
  prefix it with `NEXT_PUBLIC_`; public variables are embedded in browser code.

Registration stays disabled unless both the enable flag and secret are set.

## Development

```bash
npm ci
npm run dev
```

The portal defaults to <http://localhost:3000>. Run it on a different port when
the API is also local, because the API commonly uses port 3000.

```bash
npm run dev -- --port 3001
```

## Production

```bash
npm ci
# Load INTERNAL_API_URL before building; rewrites are resolved at build time.
npm run lint
npm run build
npm run start -- --port 3001
```

Deploy this directory as its own service and route browser traffic to its port.
The portal forwards API calls to `INTERNAL_API_URL`/`NEXT_PUBLIC_API_URL` and keeps
authenticated thumbnail responses private in the browser cache.

## Features

- Shared portal authentication for EcoAudit Pro and SolarSense
- Audit, zone, equipment, site, and assessment workflows
- Authenticated 400 px photo thumbnails with ETag revalidation
- Photo upload, PDF generation, and original-photo ZIP exports
- Admin, diagnostics, settings, scheduler, and field-app placeholders
