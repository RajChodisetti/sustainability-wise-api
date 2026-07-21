# Deployment Change Rules

- API and portal are separate PM2 processes, ports, environment files, Caddy
  routes, and release paths. Change only the intended process configuration.
- Never commit real credentials or copy production environment values into
  examples, scripts, logs, or documentation.
- Deploy immutable commits from `main`. Do not deploy an uncommitted working tree
  or mutable local-only source.
- Apply migrations in a compatibility-safe order, build before switching the
  running release, and retain a rollback target.
- After deployment verify the exact commit/path, PM2 status, `/health`, portal
  login page, recent error logs, and one representative changed workflow.
- Scripts must be non-interactive, fail on errors, quote paths/variables, and be
  safe to rerun where practical.

Follow `docs/INFRASTRUCTURE.md` and `docs/ECOSENSE_PORTAL_DEPLOYMENT.md`. If the
runbook and live PM2 configuration differ, stop and reconcile the difference
before changing production.

