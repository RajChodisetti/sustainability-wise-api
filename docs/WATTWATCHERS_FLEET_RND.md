# Wattwatchers Fleet monitoring: research and implementation decisions

## Outcome

The existing fleet monitor is a useful email report, but it is not a reliable
historical data source. It keeps only the previous run's offline device IDs,
silently drops failed device requests, and overwrites client attribution when a
device appears under more than one API key. The portal integration therefore
stores complete observations, the quality of every collection run, and
many-to-many fleet membership.

A read-only inventory experiment on 15 July 2026 found 1,887 account/device
memberships and 1,505 unique authorised devices. Of those, 361 appeared in more
than one account. The existing scheduled report counted only 1,255 devices,
leaving about 250 authorised devices (16.6%) outside both its online and offline
totals. The new model makes inactive, failed and otherwise unobservable devices
visible instead of silently removing them from the denominator.

EcoAudit Pro and SolarSense already share PostgreSQL's `public` schema and use
table prefixes. Wattwatchers follows the same convention with `ww_*` tables and
a separate TypeScript schema module.

## Connectivity semantics

The Mercury API's `comms.lastHeardAt` field is the source of truth for device
connectivity. `latestStatus` describes the age of the status payload and is
retained separately; it is not used as the heartbeat.

| Portal state | Derived rule |
| --- | --- |
| Communicating | Last heard at most 15 minutes ago |
| Delayed | Last heard more than 15 minutes, but no more than 60 minutes ago |
| Offline | Last heard more than 60 minutes ago |
| Inactive | Uninitialised or never heard from |
| Unknown | The device could not be observed because collection failed |

The existing emailed report's 24-hour threshold remains a separate
`reportOffline` cohort so the familiar report does not change meaning. A daily
snapshot can only show *availability at scan*, not continuous uptime. Exact
outage duration and flapping detection require more frequent observations.

Sources: [Mercury endpoints and device fields](https://docs.wattwatchers.com.au/api/v3/endpoints.html),
[Fleet condition definitions](https://service.wattwatchers.com.au/software/fleet-manager-user-guide),
and [device catch-up behaviour](https://docs.wattwatchers.com.au/api/tips/device-catch-up.html).

## Data retained

Each run retains:

- its reporting date and Melbourne timezone, collector version, thresholds,
  duration, trigger, completion state, request/retry/rate-limit/error counts,
  and per-client success or failure;
- all communicating, delayed, offline, inactive, and unknown device
  observations—not just the offline subset;
- every client/fleet membership for devices exposed by multiple API keys;
- label, model, firmware, device timezone, communications type/mode/transport,
  last-heard time, last-known signal, channels, phases, and a sanitized raw
  status payload;
- the latest Short Energy and Long Energy records where enabled, plus their
  telemetry timestamps, so connectivity and data freshness can be analysed
  independently;
- outage transitions only from complete published runs; partial runs never
  create false recoveries;
- the exact report counts and delivery outcome independently of collection.

Client and MaaS classifications are local enrichment because Mercury does not
provide a public client, site, or MaaS endpoint. API keys and tokens are never
stored in observations. IMSI, SIM ID, MAC address, SSID, IP, gateway, subnet,
APN, and similar identifiers are removed from browser-visible payloads.

Short Energy is best-effort and retained by Wattwatchers for up to 31 days.
Long Energy is the appropriate source for durable interval history and should
be resumed from the last received timestamp rather than repeatedly querying a
fixed window. This first release stores latest samples and daily fleet history;
bulk historical energy ingestion is deliberately left behind a feature flag
until its volume and business value are measured.

Sources: [polling guidance](https://docs.wattwatchers.com.au/api/tips/polling-data.html),
[rate limits](https://docs.wattwatchers.com.au/api/v3/rate-limits.html),
[energy concepts](https://docs.wattwatchers.com.au/api/tips/concepts.html), and
[timestamp/DST guidance](https://docs.wattwatchers.com.au/api/tips/working-with-timestamps.html).

## Collection reliability

The Python worker remains separate from the web API so Wattwatchers credentials
never enter the Next.js application. It creates or resumes an idempotent run,
uploads observations in bounded batches, records each client result, and asks
the API to finalise the run transactionally. HTTP 429 honours `Retry-After`;
transient network and 5xx failures use bounded exponential backoff with jitter.

A run is published only when all configured clients complete successfully.
Known-but-unobserved devices are `unknown`, never recovered. The last complete
published snapshot continues to power the operational dashboard while a
partial-run warning remains visible in collector health.

## Portal views

The first release provides:

1. Fleet overview: communicating, delayed, offline, inactive and unknown;
   availability at scan; new offline and recovered; MaaS comparison; 30-day
   trend; offline-age distribution; and last-good-run freshness.
2. Devices: searchable and filterable by date, client, MaaS, state, model,
   firmware and outage age, with last heard and last-known signal clearly
   labelled.
3. Clients: ranked device count, offline count/rate, MaaS classification, and
   scan quality.
4. Daily comparison/reports: newly offline, still offline, recovered, newly
   discovered and unknown, mirroring the emailed report with downloadable CSV.
5. Collection health: client failures, retries, throttling, request counts and
   partial-run diagnostics.

All visual summaries have a textual or tabular equivalent and never use colour
as the only status signal.

## Follow-up experiments

- Increase status polling from daily to five-minute intervals only after
  validating aggregate per-key rate-limit headroom and VM load. Daily data is
  retained regardless.
- Backfill legacy HTML reports as explicitly incomplete, offline-only snapshots;
  exclude them from availability and recovery calculations.
- Measure whether Long Energy completeness, voltage excursions, phase
  imbalance, low power factor, zero-output channels and transport failover
  cohorts lead to actionable work before retaining high-volume intervals.
- Confirm contractual retention, tenant access and privacy requirements before
  exposing sensitive communications identifiers or long-term raw telemetry.
