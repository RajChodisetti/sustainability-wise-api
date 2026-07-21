# Shared Service Rules

This directory currently owns durable export behavior shared by EcoAudit and
SolarSense.

- `pdfJobService.ts` is the persistence boundary for both `pdf` and `photos-zip`
  artifacts. Keep compatibility names only at route boundaries.
- `exportJobQueue.ts` serializes expensive work in this process. Do not bypass it
  from a PDF or ZIP route or add unbounded parallel generation.
- `photoZipExport.ts` must consume one object stream fully before opening the next
  and must remain suitable for archives larger than available heap memory.
- Job transitions are monotonic: queued -> running -> complete or failed. Persist
  progress and error state, dedupe active equivalent jobs, and recover stale
  in-memory jobs after restart.
- Store finished artifacts before marking jobs complete. Downloads require auth,
  app namespace, and ownership/elevated access checks.

Service changes require focused queue/stream tests plus both product route and
portal export impact review. Exercise a production-scale fixture before deploying
changes that affect concurrency, storage streams, Chromium, or artifact upload.

