# AI Change Playbook

Use this workflow for feature work, fixes, migrations, and production incidents.

## 1. Frame the Task

Record the requested behavior, affected product, explicit non-goals, and whether
mobile source changes are allowed. Translate the request into observable before
and after behavior. Do not begin with a filename assumption.

Run:

```bash
npm run ai:context -- <product> <feature>
```

## 2. Trace the Vertical Slice

Inspect each applicable layer before editing:

| Layer | Questions |
|---|---|
| UI | Which page owns the action and which shared component should it use? |
| Client | How are wire fields, auth refresh, errors, and binary data normalized? |
| API | Which route, guards, ownership checks, and response status are involved? |
| Domain | Where is the canonical business value represented? |
| Persistence | Which schema column, JSON key, registry row, or reference stores it? |
| Output | Does PDF, ZIP, CSV, sync, thumbnail, copy, or import consume it? |
| Compatibility | Which installed mobile or older portal version calls this contract? |
| Operations | Does it need a migration, queue behavior, environment, or deploy order? |

Search for both camelCase and snake_case names and for known legacy aliases.

## 3. Choose a Compatibility Strategy

For a new value, add one canonical representation. For duplicate or renamed
values:

1. Pick the canonical name used by the business/mobile domain.
2. Accept legacy input only at the boundary.
3. Return compatibility aliases only where an installed client requires them.
4. Persist and emit the canonical value internally.
5. Add an append-only migration for every persisted representation.
6. Preserve a non-empty canonical value when both old and new values exist.
7. Add tests for legacy-only, canonical-only, and conflicting inputs.

Do not solve a data mismatch with a one-off UI fallback alone. That hides the
problem from reports, exports, sync, and future clients.

## 4. Implement in Dependency Order

Use this order when several layers change:

1. Schema and migration.
2. Shared domain normalization or service.
3. API route and compatibility behavior.
4. Client type and API mapping.
5. UI or report consumer.
6. Regression and integration tests.
7. Current documentation and deployment notes.

Keep commits behavior-focused. Do not mix cleanup that is not needed for the
task.

## 5. Verify by Risk

`npm run ai:preflight` reads changed paths and runs the relevant quick checks.
Before push or deployment, always run `npm run verify`.

Also perform focused checks for the behavior itself:

- API changes: exercise success, auth failure, wrong app, ownership, and invalid
  input where relevant.
- Data migrations: test legacy-only, canonical-only, both populated, null, and
  rerun behavior.
- Exports: test job creation, progress, persistence, completion, failure,
  authenticated download, and large input behavior.
- Portal workflows: test loading, disabled, success, persistent-ready, error,
  refresh/navigation, and mobile viewport states.
- Cross-process changes: test an old client against the new API contract.

## 6. Integrate and Deploy

Review the combined diff after merging concurrent work. Re-run the full gate,
because isolated agents may pass tests while conflicting at integration points.
Deploy an immutable `main` commit, apply migrations before code that requires
them, restart only the intended process, and verify commit path, PM2 status,
health, logs, and one representative business workflow.

## Completion Evidence

A task is complete only when the final report states:

- behavior changed and behavior intentionally preserved;
- migration and compatibility handling, or why neither applies;
- exact checks run and their outcomes;
- deploy status and commit, when deployment was requested;
- any mobile source changes, explicitly including `none`.

