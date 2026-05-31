# Cost-Based Architecture Options

This document is for client discussion. It focuses only on architecture choices
that affect current or future infrastructure cost: hosting, database hosting,
image/file storage, backups, and upgrade points.

Prices are in USD per month, before tax/GST, exchange-rate changes, paid support,
and implementation labour. Pricing was checked against provider pages in May 2026.

## Executive Summary

| Question | Recommendation |
|---|---|
| What should we run now? | Keep the current single DigitalOcean VM approach for the first release. |
| Why? | It is the lowest-cost setup and is enough for a small field team. |
| What is the current minimum infrastructure cost? | About `$12/month` for the VM, if we do not count existing Microsoft 365/OneDrive. |
| What is the recommended MVP production cost? | About `$20.60/month`: VM + daily Droplet backup + object storage for files/backups. |
| Should OneDrive be primary image storage? | No. Use OneDrive only as an optional convenience copy/export location, not as primary application storage or formal backup. |
| When do we upgrade? | Move files to object storage before uploads reach about `25 GB`; move DB to managed PostgreSQL when restore/uptime becomes business-critical. |

The recommended path is:

1. **Now:** single VM, self-hosted PostgreSQL, VM-local files, but add proper file backup.
2. **Before production dependence:** daily server backup, daily DB backup, daily file backup, monthly restore test.
3. **Before files grow:** move uploaded images/PDFs from VM disk to object storage.
4. **When reliability matters more than lowest cost:** move PostgreSQL to managed PostgreSQL.
5. **Only at larger scale:** consider multiple servers or Kubernetes.

## What We Are Doing Now

| Area | Current setup | Monthly cost | Notes |
|---|---:|---:|---|
| Hosting | DigitalOcean 2 GB / 1 vCPU / 50 GB Droplet | `$12.00` | Runs API, database, uploads, and PDF generation. |
| Database | PostgreSQL on the same VM | `$0 extra` | Lowest cost, but the database depends on the same server. |
| Image/PDF storage | VM local disk under `LOCAL_FILE_STORAGE_ROOT` | `$0 extra` | Uses the included 50 GB disk. Practical safe budget is about 25-30 GB. |
| DB backup | Daily `pg_dump` to OneDrive via `rclone` | `$0 extra if Microsoft 365 already exists` | Good as a temporary copy, but not enough for full disaster recovery. |
| File backup | Not fully covered unless upload directory is backed up separately | `Gap` | Must be added before production use. |
| Full server backup | Recommended, not guaranteed by code | `$2.40-$3.60` if enabled | Weekly is 20% of VM cost; daily is 30% of VM cost. |

Current minimum cost: **about `$12/month`**.

Current production concern: **database backups alone do not protect uploaded
images/PDFs**. The upload directory must be backed up separately or moved to
object storage.

## Recommended MVP Production Setup

| Component | Recommendation | Monthly cost |
|---|---|---:|
| VM hosting | Keep current DigitalOcean 2 GB Droplet | `$12.00` |
| Database | Keep PostgreSQL on the VM for now | `$0 extra` |
| Server backup | Enable DigitalOcean daily Droplet backups | `$3.60` |
| File/object storage | Add DigitalOcean Spaces for uploads/backups | `$5.00` up to 250 GiB |
| DB backup | Daily `pg_dump` to object storage, keep 30 days | Included in Spaces in normal early usage |
| File backup | Daily sync of upload directory to object storage until uploads move there permanently | Included in Spaces up to 250 GiB |

Recommended MVP production cost: **about `$20.60/month`**.

This is the lowest-cost setup I would be comfortable presenting as production
ready, because it covers the main failure modes without moving to managed
database or Kubernetes too early.

## Hosting Options

| Option | Approx monthly cost | Pros | Cons | Recommendation |
|---|---:|---|---|---|
| Single 2 GB DigitalOcean VM | `$12` | Cheapest, simple, enough for early usage | Single-server failure risk | Use now. |
| Single 4 GB DigitalOcean VM | `$24` | Easy upgrade, more RAM for PDF generation | Still one server | Upgrade first if memory/CPU is the bottleneck. |
| Single 8 GB DigitalOcean VM | `$48` | More room for concurrent jobs | Still one server | Use only if workload grows but HA is not required. |
| Two VMs + load balancer | `$36+` before DB/storage | Better availability for API | Requires shared file storage and external DB to be useful | Consider after object storage and managed DB. |
| DigitalOcean Kubernetes | `$56+` realistic minimum | Better scaling/rollouts | More complexity and higher baseline cost | Not recommended now. |

For Kubernetes, a realistic minimum is not just one node. A small production setup
would usually include at least two worker nodes, a load balancer, a database, and
object storage:

| Kubernetes component | Cost |
|---|---:|
| Two basic worker nodes | `$24` |
| Load balancer | `$12` |
| Managed PostgreSQL starter | `$15.15` |
| Object storage | `$5` |
| **Minimum realistic total** | **`$56.15/month`** |

This is almost 3x the recommended MVP VM setup before adding extra monitoring,
deployment work, or high-availability control plane cost. Kubernetes should wait
until we actually need multi-service scaling or a larger operations model.

Upgrade from current VM when:

- RAM regularly exceeds 70-80%.
- PDF generation slows down the API.
- CPU is consistently high during normal working hours.
- More than one API server is needed for uptime or scale.

## Database Options

| Option | Approx monthly cost | Pros | Cons | Recommendation |
|---|---:|---|---|---|
| PostgreSQL on current VM | `$0 extra` | Cheapest and fastest to start | DB is tied to the VM; restore is our responsibility | Use now, with daily backups and restore tests. |
| DigitalOcean Managed PostgreSQL 1 GB | `$15.15` | Managed backups, SSL, easier maintenance, better restore path | Adds monthly cost | Move here when data becomes business-critical. |
| Managed PostgreSQL 2 GB | `$30.45` | More capacity | Higher cost | Use when DB load/storage grows. |
| Managed PostgreSQL high availability | About `$60.90+` | Standby/failover option | Much higher cost | Use only when downtime cost justifies it. |

Recommended now: keep PostgreSQL on the VM, but treat backups seriously.

Move to managed PostgreSQL when:

- Client depends on the system for daily operations.
- Manual database recovery is no longer acceptable.
- We need point-in-time recovery or easier restore.
- DB size or query load starts competing with API/PDF work on the VM.
- We introduce multiple API servers.

Expected monthly cost after moving to managed PostgreSQL:

| Component | Cost |
|---|---:|
| Current VM | `$12.00` |
| Managed PostgreSQL starter | `$15.15` |
| DigitalOcean Spaces | `$5.00` |
| Daily VM backup | `$3.60` |
| **Total** | **`$35.75/month`** |

## Image and File Storage Options

Images and PDFs are the main future cost driver. The database is likely to stay
small for a long time; photos can grow quickly.

### Current Approach: VM-Local Storage

| Item | Value |
|---|---|
| Cost | `$0 extra` while within the VM disk |
| Current capacity | 50 GB total VM disk |
| Practical safe file budget | About 25-30 GB after OS, app, database, logs, and safety margin |
| Main risk | If the VM disk fails and files are not backed up, images/PDFs are lost |

VM-local storage is acceptable only for the first stage because it is simple and
free. It is not the long-term storage target.

### Recommended Storage Upgrade: Object Storage

Recommended object storage for this project: **DigitalOcean Spaces**.

| Storage amount | DigitalOcean Spaces monthly cost |
|---:|---:|
| Up to 250 GiB | `$5.00` |
| 500 GiB | About `$10.00` |
| 1,000 GiB | About `$20.00` |

Why this is the recommended next storage step:

- Designed for images, PDFs, and backups.
- S3-compatible, so it is easy to integrate and migrate later.
- Includes 250 GiB storage and 1,024 GiB outbound transfer in the base price.
- Can live in the same DigitalOcean region as the VM.
- Avoids filling the VM disk.
- Required before running multiple API servers.

Move from VM-local storage to object storage when:

- Upload directory reaches `25 GB`.
- More than one server is planned.
- Client expects production-grade file retention.
- Photo download/share usage increases.
- We want simpler backup and restore.

### OneDrive Analysis

OneDrive looks attractive because the business may already pay for Microsoft 365.
Microsoft 365 Business Basic is listed at `$6/user/month` on annual billing and
includes 1 TB of cloud storage per user.

However, OneDrive is **not the recommended primary application image store**.

Why not:

- It is intended for a licensed user's work files, not application-owned storage.
- Microsoft's service description says system backups and organization-level data
  are not supported use cases for OneDrive.
- Assigning a per-user license to a bot/service account is not supported.
- Uploading through Microsoft Graph adds more complexity than S3-compatible object
  storage.
- It is harder to reason about application-level access, lifecycle rules, and
  disaster recovery than with object storage.

Correct use of OneDrive here:

- Optional human-friendly export location.
- Optional second copy for low-risk documents.
- Temporary convenience while the system is small.

Incorrect use of OneDrive here:

- Primary image storage for the app.
- Only backup location for database dumps.
- Formal disaster recovery target for production data.
- Storage assigned to a non-human "app user" license.

If the client specifically wants Microsoft storage, SharePoint document libraries
are a better fit for team/organization documents than OneDrive, but for application
uploads and backups, object storage is still the cleaner technical fit.

### Other Storage Options

| Option | Approx cost | Pros | Cons | Recommendation |
|---|---:|---|---|---|
| DigitalOcean Spaces | `$5` up to 250 GiB, then `$0.02/GiB` | Simple, same provider, S3-compatible | Fixed `$5` minimum | Recommended next step. |
| Cloudflare R2 | `$0.015/GB-month` plus request charges, no egress charge | Very cheap for storage/egress-heavy workloads | Separate vendor, request billing to monitor | Consider later if download bandwidth becomes high. |
| DigitalOcean Volume attached to VM | `$0.10/GiB` | Quick way to add disk | Still tied to one server; not object storage | Short-term expansion only. |
| OneDrive | `$0 extra` if already licensed, or `$6/user/month` annual | Familiar to business users | Not correct as primary app storage/backup | Use only as optional export/copy location. |

## Backup Frequency and Cost

Backups need to cover three things:

1. PostgreSQL database.
2. Uploaded images and generated PDFs.
3. Server configuration/application state.

### Recommended Backup Plan Now

| Backup | Frequency | Retention | Monthly cost | Purpose |
|---|---|---|---:|---|
| PostgreSQL logical dump | Daily | 30 days | Included in object storage for normal early usage | Recover records/users/sync metadata. |
| Upload directory/file sync | Daily | 30 days or versioned object storage | Included up to 250 GiB in Spaces | Recover images and PDFs. |
| DigitalOcean Droplet backup | Daily | Provider-managed | `$3.60` on current `$12` VM | Fast full-server rollback. |
| Restore test | Monthly | N/A | Labour only | Proves backups are usable. |

This gives a normal recovery point of about 24 hours. If losing one day of data is
not acceptable, increase DB/file backup frequency.

### Backup Cost Options

| Option | Frequency | Cost on current `$12` VM | Notes |
|---|---|---:|---|
| DigitalOcean Droplet backup | Weekly | `$2.40/month` | Cheapest full-server backup option. |
| DigitalOcean Droplet backup | Daily | `$3.60/month` | Recommended for production MVP. |
| Manual Droplet snapshot | Ad hoc/monthly | About `$3.00/month` for a 50 GB snapshot | Useful before risky releases; not a backup schedule by itself. |
| DB dump to object storage | Daily | Usually included in `$5` Spaces plan | DB dumps are expected to be small early. |
| DB dump every 6 hours | 4x daily | Usually still included early | Use if the client needs lower data-loss window. |
| File backup to object storage | Daily | `$5` up to 250 GiB total stored | Required while files remain on VM disk. |

### File Storage Backup Cost Examples

If using DigitalOcean Spaces for uploaded files and backup copies:

| Total stored files/backups | Estimated Spaces cost |
|---:|---:|
| 50 GiB | `$5/month` |
| 250 GiB | `$5/month` |
| 500 GiB | About `$10/month` |
| 1,000 GiB | About `$20/month` |

If using Cloudflare R2:

| Stored files | Estimated R2 storage cost before request charges |
|---:|---:|
| 50 GB | About `$0.75/month` |
| 250 GB | About `$3.75/month` |
| 500 GB | About `$7.50/month` |
| 1,000 GB | About `$15/month` |

R2 can be cheaper, especially where egress matters, but DigitalOcean Spaces is
the simpler first upgrade because the rest of the infrastructure is already on
DigitalOcean.

## Cost Scenarios

| Scenario | What it includes | Approx monthly cost | Recommendation |
|---|---|---:|---|
| Current lowest-cost setup | VM only; DB/files local; OneDrive DB dump if existing | `$12` | OK for development/testing only. |
| Current plus weekly server backup | VM + weekly Droplet backup | `$14.40` | Better, but still missing proper file backup unless added separately. |
| Recommended MVP production | VM + daily Droplet backup + Spaces for DB/file backups | `$20.60` | Recommended now. |
| Larger single-server setup | 4 GB VM + daily backup + Spaces | `$36.20` | First upgrade if RAM/CPU is the bottleneck. |
| Managed DB setup | VM + managed PostgreSQL + Spaces + daily VM backup | `$35.75` | Recommended when production data is business-critical. |
| Managed DB high availability | VM + HA managed PostgreSQL + Spaces + daily VM backup | `$81.50+` | Use when downtime cost justifies it. |
| Kubernetes minimum | 2 nodes + load balancer + managed DB + Spaces | `$56.15+` | Not recommended until scale/ops justify it. |

## Must-Dos Before Production Use

1. Add daily backup/sync for `LOCAL_FILE_STORAGE_ROOT`.
2. Enable DigitalOcean daily Droplet backups or equivalent full-server backup.
3. Keep daily PostgreSQL dumps for at least 30 days.
4. Run and document a restore test monthly.
5. Add disk usage alerts before uploads reach 20-25 GB.
6. Move primary images/PDFs to object storage before the VM disk becomes a risk.
7. Do not rely on OneDrive as the only production backup.

## Upgrade Triggers

| Trigger | Upgrade |
|---|---|
| Upload files reach 20-25 GB | Move images/PDFs to object storage. |
| Upload files reach 250 GiB | Recheck object storage cost and retention policy. |
| Daily usage depends on the app | Move database to managed PostgreSQL or formally prove restore process. |
| Need less than 24-hour data-loss window | Increase DB/file backup frequency to every 6 hours or better. |
| PDF generation causes slow API responses | Upgrade VM to 4 GB or split PDF generation into a worker. |
| Need multiple API servers | Object storage and managed DB must come first. |
| Need high availability | Add managed DB HA, multiple app servers, load balancer, or Kubernetes. |

## Client-Friendly Recommendation

For the first production release, the best cost/value choice is:

- **DigitalOcean VM:** `$12/month`
- **Daily VM backup:** `$3.60/month`
- **DigitalOcean Spaces for file backups and future image storage:** `$5/month`
- **Total:** about **`$20.60/month`**

This keeps the monthly cost low while covering the biggest risk: losing database
records or uploaded images. OneDrive can remain a convenience/export copy if the
business already uses Microsoft 365, but it should not be sold as the core storage
or backup architecture.

## Pricing Sources

- DigitalOcean Droplet pricing: https://www.digitalocean.com/pricing/droplets
- DigitalOcean Backups pricing: https://docs.digitalocean.com/products/backups/details/pricing/
- DigitalOcean Spaces pricing: https://docs.digitalocean.com/products/spaces/details/pricing/
- DigitalOcean Managed PostgreSQL pricing: https://www.digitalocean.com/pricing/managed-databases
- DigitalOcean Kubernetes pricing: https://www.digitalocean.com/pricing/kubernetes
- DigitalOcean Volumes pricing: https://docs.digitalocean.com/products/volumes/details/pricing/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Microsoft 365 Business pricing: https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-plans-and-pricing
- OneDrive service description: https://learn.microsoft.com/en-us/office365/servicedescriptions/onedrive-for-business-service-description
