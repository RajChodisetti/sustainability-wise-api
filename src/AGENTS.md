# API Working Agreement

Applies to the Fastify API and shared backend code under `src/`. Read the root
contract and `docs/ai/CONTRACTS.md` first.

## Architecture

- `app.ts` constructs the server and is the only top-level route registration
  point. Product route indexes register their own route groups.
- `config.ts` validates runtime configuration at import time. Tests importing
  API modules need the placeholder environment provided by `npm run test:api`.
- Route handlers own HTTP concerns. Put reusable domain, storage, queue, or
  normalization behavior in an existing helper/service when more than one route
  consumes it.
- Drizzle schema properties are camelCase even when PostgreSQL columns are
  snake_case. Public JSON is camelCase unless a documented compatibility contract
  says otherwise.
- NodeNext imports between TypeScript modules use `.js` suffixes.

## Route Rules

- Protected routes include `authenticate`, the exact `requireApp(...)`, and the
  minimum role. Confirm ownership independently of role for inspector operations.
- Validate IDs and payloads with existing helpers and return `AppError` helpers so
  the global error shape stays `{ error, statusCode, detail? }`.
- Register a new route in its product `index.ts` and keep OpenAPI tags accurate.
- Preserve endpoint, field, status, pagination, and sync semantics for mobile
  consumers. Prefer additive response fields and boundary aliases.
- Never expose a local path, storage credential, raw database error, password
  hash, refresh token, or unrestricted object key.

## Data and Performance

- Use database transactions when several writes form one business operation.
- Bound database result sets and concurrency. Stream or page large binary/data
  workloads instead of buffering all records or opening many storage streams.
- Reuse photo reference, ownership, copy, thumbnail, and export services. Those
  services encode security and lifecycle rules that route-local shortcuts miss.
- Add focused `node:test` coverage beside the behavior as `*.test.ts`.

## Checks

Run `npm run api:typecheck` and `npm run test:api` for backend changes. Shared
contract changes also require the affected portal checks and the full
`npm run verify` gate before push.

