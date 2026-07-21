# Legacy Vite UI Rules

This is the legacy management UI bundled into `web/dist` and served by Fastify.
It is not the separately deployed EcoSense Next.js portal.

- Confirm the requested screen actually belongs here before editing. Current
  EcoAudit, SolarSense, and Fleet portal work normally belongs in
  `apps/ecoaudit/`.
- Keep its auth/session and navigation model self-contained. Do not import Next.js
  portal code into this Vite application.
- API contract changes must remain compatible with this client or update it in
  the same change.
- Run `npm run web:typecheck` and `npm run web:build` after changes.

