# Optional EcoSense Portal Deployment

The combined Next.js portal is deployed as an optional process, separate from
the existing Fastify API and its Vite UI. The existing `sw-api` PM2 process and
port `3000` remain unchanged. The portal listens only on `127.0.0.1:3001` and
is not started by the existing `deploy/ecosystem.config.cjs`.

## Deployment boundary

- API and existing Vite UI: existing process on `127.0.0.1:3000`
- Combined Next.js portal: optional `ecosense-portal` process on
  `127.0.0.1:3001`
- Public entry point: a dedicated hostname such as
  `portal.sustainabilitywise.com.au`

Use a dedicated hostname instead of mounting the portal at `/` on the API
hostname. The portal and the existing Vite UI both own routes such as `/`,
`/login`, `/ecoaudit/*`, and `/solar/*`; sharing one URL path would make route
selection ambiguous.

## Build

The portal must be integrated at `apps/ecoaudit` and built before it can be
started. Provision the protected environment file described below first, then
load that same file for the build so Next.js bakes the intended rewrite target
into the production bundle:

```bash
sudo -u swapi -H bash -lc '
  set -a
  source /etc/sustainability-wise/ecosense-portal.env
  set +a
  cd /opt/sw-api/apps/ecoaudit
  npm ci
  npm run build
'
```

The PM2 configuration runs `next start`; it intentionally does not install
dependencies, build the portal, alter the API process, or update the reverse
proxy.

## Server-only environment

Copy `deploy/ecosense-portal.env.example` to a location outside the repository
and restrict it to the service account:

```bash
sudo install -o swapi -g swapi -m 0600 /dev/null \
  /etc/sustainability-wise/ecosense-portal.env
sudoedit /etc/sustainability-wise/ecosense-portal.env
```

Configure these values:

- `INTERNAL_API_URL=http://127.0.0.1:3000` routes server-side API requests to
  the existing local API without a public network round trip. It must be
  present during both `npm run build` (for rewrites) and `next start` (for
  Route Handlers).
- `REGISTRATION_SECRET` must match the API registration secret. It is a
  server-only credential and must never use a `NEXT_PUBLIC_` prefix.
- `PORTAL_REGISTRATION_ENABLED=false` keeps public registration disabled. Set
  it to `true` only after the portal's server-side registration endpoint has
  been intentionally enabled and reviewed.

Do not configure `NEXT_PUBLIC_REGISTRATION_SECRET`. A `NEXT_PUBLIC_` value is
included in browser JavaScript. The portal should call same-origin routes, and
only its server-side code should read `INTERNAL_API_URL` or
`REGISTRATION_SECRET`.

## Explicit start

Starting this file is an explicit operation; it is not referenced by the
existing API ecosystem file:

```bash
sudo -u swapi -H bash -lc '
  set -a
  source /etc/sustainability-wise/ecosense-portal.env
  set +a
  cd /opt/sw-api
  pm2 start deploy/ecosense-portal.ecosystem.config.cjs \
    --env production --only ecosense-portal
'
```

Verify the loopback service before exposing it:

```bash
curl --fail --head http://127.0.0.1:3001/login
sudo -u swapi -H pm2 logs ecosense-portal --lines 100
```

Do not run `pm2 save` during evaluation. Saving the process list makes the
portal eligible for automatic resurrection after reboot. Run it only when the
portal has been deliberately approved as a permanent service.

To update runtime environment values after editing the protected environment
file, source it again and restart with `--update-env`:

```bash
sudo -u swapi -H bash -lc '
  set -a
  source /etc/sustainability-wise/ecosense-portal.env
  set +a
  cd /opt/sw-api
  pm2 restart deploy/ecosense-portal.ecosystem.config.cjs \
    --env production --only ecosense-portal --update-env
'
```

To remove the optional process without touching the API:

```bash
sudo -u swapi -H pm2 delete ecosense-portal
```

## Reverse proxy and DNS

After the loopback check passes, choose a dedicated hostname, add its DNS
record, and copy the block from
`deploy/ecosense-portal.Caddyfile.example` into the active Caddy configuration.
Validate and reload Caddy explicitly:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

This proxy addition is independent of the existing
`api.sustainabilitywise.com.au -> 127.0.0.1:3000` route and must not replace it.
