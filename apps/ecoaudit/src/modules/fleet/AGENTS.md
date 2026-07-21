# Fleet Portal Rules

- Keep Fleet API, auth, domain, hooks, formatting, status, table, and report logic
  in this module. Route entries under `src/app/(portal)/fleet` stay thin.
- UI status labels and report cohorts must derive from backend-defined semantics;
  reuse `lib/reportCohorts.ts` and `lib/format.ts` rather than recalculating.
- Preserve exact archived report cohort order/counts in detail views and CSV
  exports. Missing IDs and an empty retained cohort are different states.
- Viewer workflows are read-only. Do not expose collector or admin actions based
  only on hidden UI; backend permissions remain required.
- Use Fleet's own authenticated API client and token keys.

Status, ingestion, or reporting changes require matching review and tests under
`src/routes/wattwatchers/`.

