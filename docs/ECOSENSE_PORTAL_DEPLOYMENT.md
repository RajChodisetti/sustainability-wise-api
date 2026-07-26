# EcoSense Portal Deployment

The combined Next.js portal runs beside the Fastify API. Both processes are
switched only to immutable release artifacts created from verified `main`
commits. The portal listens on `127.0.0.1:3210`; the API remains on
`127.0.0.1:3000`.

## Deployment boundary

- API: existing process on `127.0.0.1:3000`
- Combined Next.js portal: `ecosense-portal` process on
  `127.0.0.1:3210`
- Public entry point: `https://api.sustainabilitywise.com.au/portal`
- Deployment source and protected environment: `/opt/ecosense-portal`
- Immutable runtime artifact: `/opt/sw-releases/<shortsha>`
- API runtime: `/opt/sw-releases/<shortsha>`
- Portal runtime: `/opt/sw-releases/<shortsha>/apps/ecoaudit`

The `/portal` endpoint redirects to the portal gateway at `/`. Caddy keeps
`/v1`, `/v1/*`, and `/health` on port `3000`; every other route goes to the
root-relative portal on port `3210`. This keeps the public API origin unchanged
and requires no additional DNS record.

Do not deploy from `/opt/sw-api`. It is a mutable maintenance checkout and may
contain unrelated work.

## Source checkout

```bash
sudo -u swapi -H git clone --branch main \
  https://github.com/RajChodisetti/sustainability-wise-api.git \
  /opt/ecosense-portal
```

Before each release, require a clean source checkout and fast-forward it:

```bash
sudo -u swapi -H git -C /opt/ecosense-portal status --short
sudo -u swapi -H git -C /opt/ecosense-portal switch main
sudo -u swapi -H git -C /opt/ecosense-portal pull --ff-only origin main
```

The status command must be empty. Record the full commit and confirm it is the
same commit that passed `npm run verify` locally.

## Immutable release build

Create a new artifact without modifying a running release. Replace the example
SHA values with the verified commit:

```bash
sudo -u swapi -H bash -lc '
  set -euo pipefail
  release_sha=0123456789abcdef0123456789abcdef01234567
  release_short=0123456
  release_dir=/opt/sw-releases/$release_short
  test ! -e "$release_dir"
  git clone --local --no-hardlinks --no-checkout \
    /opt/ecosense-portal "$release_dir"
  git -C "$release_dir" checkout --detach "$release_sha"
  test "$(git -C "$release_dir" rev-parse HEAD)" = "$release_sha"
  test -z "$(git -C "$release_dir" status --short)"
  ln -s /opt/ecosense-portal/.env "$release_dir/.env"
  cd "$release_dir"
  npm ci
  npm run web:build
  cd "$release_dir/apps/ecoaudit"
  npm ci
  set -a
  source /opt/ecosense-portal/.env
  set +a
  npm run build
'
```

The PM2 configurations only start their processes. They do not install
dependencies, build assets, apply migrations, or update Caddy.

## Server-only environment

The current VM keeps the ignored, protected environment at
`/opt/ecosense-portal/.env`. Restrict it to the service account:

```bash
sudo chown swapi:swapi /opt/ecosense-portal/.env
sudo chmod 0600 /opt/ecosense-portal/.env
```

Configure these values:

- `INTERNAL_API_URL=http://127.0.0.1:3000` routes server-side API requests to
  the existing local API without a public network round trip. It must be
  present during both `npm run build` (for rewrites) and `next start` (for
  Route Handlers).
- `ECOSENSE_PORTAL_PORT=3210` keeps the portal on its dedicated loopback port.
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

## Atomic process switch

Record both current PM2 working directories as rollback targets. Then switch the
API and portal explicitly to the new release. Replace the example release path:

```bash
sudo -u swapi -H bash -lc '
  set -euo pipefail
  release_dir=/opt/sw-releases/0123456
  set -a
  source /opt/ecosense-portal/.env
  set +a
  SW_API_ROOT="$release_dir" \
    pm2 startOrRestart "$release_dir/deploy/ecosystem.config.cjs" \
      --env production --only sw-api --update-env
  curl --fail http://127.0.0.1:3000/health
  ECOSENSE_PORTAL_ROOT="$release_dir/apps/ecoaudit" \
    pm2 startOrRestart \
      "$release_dir/deploy/ecosense-portal.ecosystem.config.cjs" \
      --env production --only ecosense-portal --update-env
'
```

Verify the exact release paths and both loopback services:

```bash
sudo -u swapi -H pm2 describe sw-api
sudo -u swapi -H pm2 describe ecosense-portal
curl --fail http://127.0.0.1:3000/health
curl --fail --head http://127.0.0.1:3210/login
sudo -u swapi -H pm2 logs sw-api --lines 100 --nostream
sudo -u swapi -H pm2 logs ecosense-portal --lines 100 --nostream
```

Do not run `pm2 save` as part of a routine release.

## Rollback

Retain at least the previously running release. If verification fails, repeat
the process-switch commands with the recorded previous API and portal release
paths. Never repair a failed artifact in place.

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
curl --fail --head \
  'https://api.sustainabilitywise.com.au/installhub/login?next=%2Finstallhub%2Fdashboard'
curl --head https://api.sustainabilitywise.com.au/portal
```

The final command must return `308` with `Location: /`. API traffic remains on
port `3000`; all non-API routes are sent to port `3210`.
