# EcoAudit Pro Web

Online-first web client for EcoAudit Pro energy audits.

## Setup

```bash
cp .env.example .env.local
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:3000

API requests proxy to `NEXT_PUBLIC_API_URL` in development.

## Features

- Auth (login/signup) with `app: ecoaudit`
- Audits, zones, 9 equipment types CRUD
- Photo upload via `/v1/ecoaudit/sync/*`
- PDF report generation
- Photo ZIP export
- Admin user management
- Settings, diagnostics, theme
