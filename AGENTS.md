# Sustainability Wise Repository Contract

This file is the root instruction set for every AI or human change in this
repository. More specific `AGENTS.md` files add rules for their directory. Read
all instruction files from this root down to every file you plan to edit.

## Start Every Task

1. Run `git status --short --branch` and preserve changes you did not create.
2. Run `npm run ai:context -- <feature-or-path>` before proposing or editing.
3. Read `docs/ai/SYSTEM_CONTEXT.md`, `docs/ai/CHANGE_PLAYBOOK.md`, and every
   contract printed by the context command.
4. Trace the complete vertical path before changing code: screen, client API,
   backend route, service/storage, schema/migration, report/export, and external
   consumers.
5. Define the intended file scope and the behavior that must remain unchanged.

## Tooling Roles

- Hierarchical `AGENTS.md` files carry repository and business context.
- `npm run ai:context` resolves task-specific dependencies from the tracked map.
- Context7 or current primary documentation answers external framework/API
  questions; it does not replace tracing this repository's business behavior.
- RTK may reduce shell-output volume for an agent, but it is not a source of
  business knowledge or a substitute for tests.
- CI and `npm run verify` enforce executable contracts.

## Repository Boundaries

| Area | Location | Runtime |
|---|---|---|
| Unified API | `src/` | Fastify on `sw-api` |
| Main portal | `apps/ecoaudit/` | Next.js on `ecosense-portal` |
| Legacy admin UI | `web/` | Vite bundle served by the API |
| Database | `src/db/schema/`, `src/db/migrations/` | PostgreSQL via Drizzle |
| Operations | `deploy/`, `docs/` | PM2, Caddy, DigitalOcean |
| Mobile clients | sibling repositories, not this repository | Expo applications |

The folder name `apps/ecoaudit` is historical. It contains the shared EcoSense
portal for EcoAudit, SolarSense, InstallHub, and Wattwatchers Fleet. The
InstallHub field client remains `../installhub-mobile/`; its catalog, validation,
evidence captions, scanners, and report behavior are compatibility sources for
the portal surface.

## Non-Negotiable Contracts

- Keep `ecoaudit`, `solarsense`, `installhub`, and `wattwatchers`
  authentication, storage, and data namespaces isolated. Every protected route
  needs `authenticate`, the
  correct `requireApp(...)`, and the minimum appropriate role.
- Treat API routes consumed by installed mobile apps as public compatibility
  contracts. Do not remove or silently rename request fields, response fields,
  URLs, or status semantics. Add a compatibility read/alias when migration is
  required. Mobile source is changed only when the task explicitly requests it.
- One business value has one canonical field. Normalize legacy aliases at API
  boundaries, persist only the canonical field, migrate every stored copy, and
  test both legacy reads and canonical writes. Never create a second UI-only
  field for the same value.
- Database migrations are append-only. Never edit a migration that may have run
  in production. Data migrations must be idempotent or safely one-time, preserve
  non-empty canonical values, and cover related registry/reference tables.
- PDF and ZIP work is asynchronous and durable. Use the shared export queue and
  job APIs. Keep legacy direct endpoints compatible where mobile clients use
  them, consume storage streams sequentially, and avoid fixed browser timeouts.
- Do not duplicate API normalization, auth refresh, download, photo metadata, or
  export polling logic in pages. Use the existing clients, hooks, and helpers.
- Changes to shared schema, auth, storage, photos, exports, or portal components
  require impact review across all four products.

## Change Discipline

- Follow existing naming, route, component, and error-handling patterns in the
  nearest module. Prefer a focused change over a cross-repository refactor.
- Add or update tests at the lowest stable layer that expresses the contract.
  A bug fix needs a regression test that fails for the previous behavior.
- Update machine-readable types and both sides of an API contract together.
- Keep secrets out of source, logs, screenshots, fixtures, and documentation.
- Do not deploy a dirty tree or an unverified commit. Production deploys only an
  immutable commit from `main`; verify both PM2 processes and public health after
  deployment.

## Verification

- While working: `npm run ai:preflight` selects checks from changed paths.
- Before push or deployment: `npm run verify` runs the complete local gate.
- When a command cannot run, report exactly which check and why. Do not describe
  an unrun check as passing.

## Concurrent Agents

- Give each agent an explicit product, behavior, and file ownership set.
- Use separate worktrees or short-lived branches for concurrent implementation;
  production still receives one integrated `main` commit history.
- Before editing or integrating, recheck `git status` and recent diffs. Never
  overwrite another agent's uncommitted work.
- Integrate dependency changes before their consumers, then run the full gate on
  the combined tree. Passing isolated task checks is not sufficient after merge.
