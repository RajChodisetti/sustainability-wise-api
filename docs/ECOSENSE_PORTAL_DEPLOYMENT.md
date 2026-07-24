# EcoSense Portal Deployment

The combined Next.js portal is deployed as a separate process beside the
existing Fastify API. The existing `sw-api` PM2 process and port `3000` remain
unchanged. The portal listens only on `127.0.0.1:3210` and is not started by
the existing `deploy/ecosystem.config.cjs`.

## Deployment boundary

- API: existing process on `127.0.0.1:3000`
- Combined Next.js portal: `ecosense-portal` process on
  `127.0.0.1:3210`
- Public entry point: `https://api.sustainabilitywise.com.au/portal`
- Portal checkout: `/opt/ecosense-portal`, isolated from the live API checkout
  at `/opt/sw-api`

The `/portal` endpoint redirects to the portal gateway at `/`. Caddy keeps
`/v1`, `/v1/*`, and `/health` on port `3000`; every other route goes to the
root-relative portal on port `3210`. This keeps the public API origin unchanged
and requires no additional DNS record.

## Checkout

Clone the deployment branch into its own directory so API updates and local
changes in `/opt/sw-api` cannot be disturbed:

```bash
sudo -u swapi -H git clone --branch deploy/ecosense-portal-vm \
  https://github.com/RajChodisetti/sustainability-wise-api.git \
  /opt/ecosense-portal
```

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
  cd /opt/ecosense-portal/apps/ecoaudit
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
- `ECOSENSE_PORTAL_PORT=3210` keeps the portal on its dedicated loopback port.
- `ECOSENSE_PORTAL_ROOT=/opt/ecosense-portal/apps/ecoaudit` points PM2 at the
  isolated portal checkout.
- `PORTAL_REGISTRATION_ENABLED=false` keeps public registration disabled. Set
  it to `true` only after the portal's server-side registration endpoint has
  been intentionally enabled and reviewed.
- When registration is enabled, `ECOAUDIT_REGISTRATION_SECRET` and/or
  `SOLARSENSE_REGISTRATION_SECRET` must match the corresponding API secret.
  They are server-only credentials and must never use a `NEXT_PUBLIC_` prefix.

Do not configure any `NEXT_PUBLIC_*REGISTRATION_SECRET`. A `NEXT_PUBLIC_` value is
included in browser JavaScript. The portal should call same-origin routes, and
only its server-side code should read `INTERNAL_API_URL` or
the app-specific registration secrets.

## Explicit start

Starting this file is an explicit operation; it is not referenced by the
existing API ecosystem file:

```bash
sudo -u swapi -H bash -lc '
  set -a
  source /etc/sustainability-wise/ecosense-portal.env
  set +a
  cd /opt/ecosense-portal
  pm2 start deploy/ecosense-portal.ecosystem.config.cjs \
    --env production --only ecosense-portal
'
```

Verify the loopback service before exposing it:

```bash
curl --fail --head http://127.0.0.1:3210/login
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
  cd /opt/ecosense-portal
  pm2 restart deploy/ecosense-portal.ecosystem.config.cjs \
    --env production --only ecosense-portal --update-env
'
```

To remove the optional process without touching the API:

```bash
sudo -u swapi -H pm2 delete ecosense-portal
```

## Reverse proxy

After the loopback check passes, replace the existing
`api.sustainabilitywise.com.au` block with the shared-host block from
`deploy/ecosense-portal.Caddyfile.example`. No DNS change is required. Validate
and reload Caddy explicitly:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Verify both services and the redirect endpoint:

```bash
curl --fail https://api.sustainabilitywise.com.au/health
curl --fail --head https://api.sustainabilitywise.com.au/login
curl --head https://api.sustainabilitywise.com.au/portal
```

The final command must return `308` with `Location: /`. API traffic remains on
port `3000`; all non-API routes are sent to port `3210`.
