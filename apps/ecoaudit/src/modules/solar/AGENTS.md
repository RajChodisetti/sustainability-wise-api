# SolarSense Portal Rules

- Keep Solar pages, API clients, auth/token storage, contexts, domain types,
  normalization, photo handling, and report configuration inside this module.
- Route entry files under `src/app/(portal)/solar` should remain thin wrappers or
  composition points around module pages.
- Trace site/assessment changes through `types/domain.ts`, `api/`, normalization,
  hooks, forms, detail pages, photos, and `SitePackReportModal`.
- Nested switchboards, appendix items, and photo arrays need stable IDs and order.
- Use the shared export job UI but Solar's own authenticated client adapters.
- Do not import EcoAudit `@/api/client`, token storage, or domain types.

API field changes require matching review under `src/routes/solarsense/` and
`src/db/schema/solarsense.ts`.

