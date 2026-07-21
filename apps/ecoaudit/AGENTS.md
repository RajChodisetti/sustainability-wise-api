# EcoSense Portal Working Agreement

This folder is the separately deployed Next.js portal for EcoAudit, SolarSense,
and Wattwatchers Fleet. Its historical directory name does not limit its scope.

<!-- BEGIN:nextjs-agent-rules -->
## Next.js Version Rule

This Next.js version may differ from remembered APIs and conventions. Read the
relevant local guide in `node_modules/next/dist/docs/` before changing framework
behavior, and heed its deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product Boundaries

- EcoAudit: route tree `src/app/(portal)/ecoaudit`, API clients `src/api`, domain
  types `src/types/domain.ts`.
- SolarSense: route tree `src/app/(portal)/solar`, implementation
  `src/modules/solar`.
- Fleet: route tree `src/app/(portal)/fleet`, implementation `src/modules/fleet`.
- Shared portal shell, providers, components, hooks, contexts, and utilities are
  under their top-level `src/` folders.

Each product has separate token keys, API clients, auth behavior, and domain
types. Cross-product sharing belongs only in a deliberately shared component or
utility with tests; never import another product's client to save a few lines.

## Data and API Rules

- Pages call typed API modules; they do not build endpoint strings, refresh JWTs,
  parse API errors, or normalize wire fields themselves.
- Normalize snake_case/legacy aliases once in the API or domain boundary, then
  use canonical camelCase values throughout components.
- Use `src/lib/photoMetadata.ts` for all EcoAudit caption/PDF-size keys and
  mapping. PDF and photo screens must edit the same `photoDescs` data saved by
  record forms.
- Use `useExportJob` and `ExportJobStatus` for durable PDF/ZIP flows. Do not add
  fixed polling timeouts or page-local binary download implementations.
- Use React Query patterns already present in each module and invalidate the
  narrowest affected keys after mutation.

## UI Rules

- Reuse existing buttons, form fields, cards, badges, toasts, shell, and icon
  components. Preserve keyboard access, labels, focus, loading, disabled, empty,
  success, and error states.
- Keep operational screens compact and consistent with the surrounding module.
  Do not introduce a new visual system in a feature fix.
- Verify responsive layout and ensure dynamic text cannot overlap controls.

## Checks

Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` in this
folder for portal-wide or shared changes. Root `npm run ai:preflight` selects the
minimum checks while working.
