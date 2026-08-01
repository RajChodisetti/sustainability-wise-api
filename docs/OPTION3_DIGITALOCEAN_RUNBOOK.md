# Option 3 DigitalOcean Production Runbook

This runbook provisions and connects the Option 3 stack:

- Application server: DigitalOcean Basic Premium Intel Droplet, Sydney, 8 GB RAM, 4 vCPU, 160 GiB NVMe SSD, 5 TB transfer
- Database: DigitalOcean Managed PostgreSQL, Sydney, daily backups, 7-day point-in-time recovery
- Photo/PDF storage: DigitalOcean Spaces, Sydney, 250 GB plus 1 TB CDN
- Server backups: DigitalOcean weekly automated Droplet backup

## Current API Compatibility

The API can connect to DigitalOcean Managed PostgreSQL by setting `DATABASE_URL`.

The API can store uploaded photos and generated PDFs in DigitalOcean Spaces by setting `STORAGE_PROVIDER=spaces` and the `SPACES_*` environment variables. It still returns app-facing download URLs through the API, for example `/v1/files/...`, so the bucket can remain private.

Use `STORAGE_PROVIDER=local` only for temporary VM-local storage or emergency rollback.

## Resource Names

Use consistent names so support and billing are easy to read:

| Resource | Name |
|---|---|
| DigitalOcean project | `sustainability-wise-prod` |
| Droplet | `sw-api-prod-syd1` |
| Managed PostgreSQL | `sw-postgres-prod-syd1` |
| Database | `sustainability_wise` |
| Database user | `sw_api` |
| Spaces bucket | `sw-prod-files-syd1` or another globally unique name |
| API hostname | `api.sustainabilitywise.com.au` |
| App directory | `/opt/sw-api` |
| Upload directory | `/var/lib/sustainability-wise-api/uploads` |

## 1. Provision The Droplet

In DigitalOcean:

1. Create or select the project `sustainability-wise-prod`.
2. Create a Droplet.
3. Region: Sydney, `SYD1`.
4. Image: Ubuntu LTS, preferably Ubuntu 24.04.
5. Droplet type: Basic.
6. CPU option: Premium Intel.
7. Size: 8 GB RAM, 4 vCPU, 160 GiB NVMe SSD, 5 TB transfer.
8. Authentication: SSH key only.
9. Enable weekly automated backups during creation.
10. Name it `sw-api-prod-syd1`.

The Option 3 budget line of about `$74 AUD/month` maps to DigitalOcean's Basic Premium Intel 8 GB plan. In the current DigitalOcean plan table that plan is `8 GiB RAM`, `4 vCPU`, `160 GiB NVMe SSD`, and `5,000 GiB transfer`. If the control panel offers `8 GB RAM`, `2 vCPU`, and `160 GB SSD`, verify the price before selecting it; that is not the current published Basic Premium Intel shape.

Do not choose General Purpose Premium Intel for this budget unless you deliberately want dedicated CPU. The 8 GB General Purpose Premium Intel plan is more expensive and currently has a smaller included disk, so it does not match the `$74 AUD/month` server line.

For a resize of an existing Droplet:

1. Take a manual snapshot before resizing.
2. Choose **Disk, CPU, and RAM** if you need the disk increased to 160 GiB.
3. Choose **CPU and RAM only** only if the current disk is already at least 160 GiB and you want the option to downsize later.
4. Shut down from SSH before resizing:

   ```bash
   sudo shutdown -h now
   ```

5. In DigitalOcean, go to Droplet -> Settings -> Resize.
6. Select Basic -> Premium Intel -> 8 GB RAM / 4 vCPU / 160 GiB NVMe SSD / 5 TB transfer.
7. Resize, then power the Droplet back on.
8. Confirm the resize:

   ```bash
   free -h
   nproc
   df -h /
   ```

Recommended Droplet backup selection:

- Enable DigitalOcean Backups.
- Frequency: Weekly.
- Retention: 4 backups / 4 weeks.
- Cost: 20% of Droplet cost.
- For this server line, that is approximately `$15 AUD/month`.

Do not use Daily Droplet Backups for the Option 3 budget unless you intentionally want to pay more. The managed PostgreSQL database already has daily backups and point-in-time recovery; the weekly Droplet backup is for OS, Caddy, app files, `.env`, and the temporary local upload directory.

If backups were not enabled during creation, enable them later from Droplet -> Backups -> Setup Automated Backups. Use a low-traffic window, for example Sunday 04:00 Sydney time.

Record:

```text
DROPLET_PUBLIC_IP=170.64.154.143
DROPLET_PRIVATE_IP=10.126.0.2
```

## 2. Provision Managed PostgreSQL

In DigitalOcean:

1. Create a Managed Database.
2. Engine: PostgreSQL.
3. Region: Sydney, `SYD1`.
4. CPU option: Basic Regular.
5. Size: 1 GiB RAM, 1 vCPU.
6. Storage: minimum storage offered for that plan, usually 10 GiB.
7. Additional nodes: 0.
8. Standby nodes: none.
9. Read-only nodes: none.
10. Name: `sw-postgres-prod-syd1`.
11. Add the Droplet `sw-api-prod-syd1` as a trusted source.
12. Create database `sustainability_wise`.
13. Create user `sw_api`, or use the generated `doadmin` user if you have not created `sw_api` yet.

The Option 3 budget line of about `$23 AUD/month` maps to DigitalOcean's managed PostgreSQL Basic Regular 1 GiB plan. Do not add standby nodes, read-only nodes, General Purpose, Storage Optimized, or a larger RAM plan unless you intentionally want to increase the monthly cost.

Recommended setup options:

- PostgreSQL version: latest DigitalOcean-supported stable version, unless migrating from an older production version.
- Trusted sources: enabled, restricted to `sw-api-prod-syd1`.
- Public access: avoid broad public access; use trusted sources only.
- Connection details: use the private host from the Droplet when available.
- SSL: required.
- Automatic updates: enabled.
- Maintenance window: low traffic, for example Sunday 03:00 Sydney time.
- Alerts: enable CPU, disk, memory, and connection alerts.

Managed PostgreSQL backups are automatic. DigitalOcean takes daily backups and maintains write-ahead logs for point-in-time recovery within the previous seven days. Restores create a new database cluster; they do not overwrite the existing cluster.

Use the private-network connection details when the database and Droplet are in the same VPC. Keep SSL enabled. The API `DATABASE_URL` should look like:

```bash
DATABASE_URL='postgresql://sw_api:<password>@<private-db-host>:25060/sustainability_wise?sslmode=require'
```

username = <db-user>
password = <db-password>
host = <private-db-host>
port = 25060
database = sustainability_wise
sslmode = require

Keep the actual password only in `/opt/sw-api/.env` on the server and in the password manager. Do not paste it into this runbook.

Test from the Droplet before starting the API:

```bash
psql "$DATABASE_URL" -c 'select now();'
```

If you use DigitalOcean's CA certificate with `verify-full`, store it on the server and update the URL:

```bash
sudo mkdir -p /etc/sw-api
sudo cp ca-certificate.crt /etc/sw-api/do-postgres-ca.crt
sudo chown root:root /etc/sw-api/do-postgres-ca.crt
sudo chmod 0644 /etc/sw-api/do-postgres-ca.crt
DATABASE_URL='postgresql://sw_api:<password>@<private-db-host>:25060/sustainability_wise?sslmode=require'
```

## 3. Provision DigitalOcean Spaces

In DigitalOcean:

1. Go to Spaces Object Storage.
2. Create a Standard Storage bucket.
3. Region: Sydney, `SYD1`.
4. Bucket name: `sw-prod-files-syd1` or another globally unique name.
5. Enable CDN.
6. Use Standard Storage, not Cold Storage.
7. Keep file listing disabled.
8. Keep the bucket private.
9. Create a Spaces access key and secret.

The Option 3 budget line of about `$33 AUD/month` maps to one DigitalOcean Spaces Standard Storage subscription. The subscription includes 250 GiB storage across buckets and 1,024 GiB outbound transfer shared across buckets. CDN is included at no additional cost, and CDN/origin transfer counts against the same transfer allowance.

For the current API code, select:

- Product: Spaces Object Storage.
- Storage class: Standard Storage.
- Region: Sydney, `SYD1`.
- CDN: enabled.
- File listing: disabled.
- Bucket access: private.
- Access keys: create one key for the API and store it in the password manager.

Do not use Spaces Cold Storage for app photos. It is for infrequently accessed archive data and has retrieval/minimum-retention tradeoffs.

Record:

```text
SPACES_REGION=syd1
SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com
SPACES_BUCKET=sw-prod-files-syd1
SPACES_CDN_URL=https://sw-prod-files-syd1.syd1.cdn.digitaloceanspaces.com
```

Store the access key and secret in the password manager. Do not commit them.
Keep the actual key values only in `/opt/sw-api/.env` on the server and in the password manager. Do not paste them into this runbook.

## 4. Point DNS At The Droplet

In the authoritative DNS provider for `sustainabilitywise.com.au`:

1. Add or update an `A` record.
2. Host/name: `api`.
3. Value: the Droplet public IPv4 address.
4. TTL: 600 seconds during setup.
5. Remove any conflicting `api` CNAME or old `api` A record.

Verify from your machine:

```bash
dig +short api.sustainabilitywise.com.au
```

It should return the new Droplet public IP.

If it returns more than one IP address, DNS has multiple `A` records for the API hostname. Remove the old record and keep only the Droplet IP. For example:

```text
35.213.173.54     remove
170.64.154.143    keep
```

Check where DNS is authoritative before editing. For this domain, the registrar may be GoDaddy, but the active nameservers can still be another provider:

```bash
dig +short NS sustainabilitywise.com.au
```

If this returns `ns1.siteground.net` and `ns2.siteground.net`, make the DNS change in SiteGround's DNS Zone Editor, not in GoDaddy DNS. In SiteGround, find the `api` `A` records and delete the old IP, leaving only the DigitalOcean Droplet IP.

Confirm against both authoritative nameservers:

```bash
dig +short @ns1.siteground.net api.sustainabilitywise.com.au A
dig +short @ns2.siteground.net api.sustainabilitywise.com.au A
```

Both should return only the Droplet IP. If the old record had a long TTL such as `86400`, public resolvers may still return it for up to 24 hours after the authoritative record is fixed.

## 5. Bootstrap The Server

SSH into the Droplet:

```bash
ssh root@<DROPLET_PUBLIC_IP>
```

Create the application user:

```bash
adduser --disabled-password --gecos "" swapi
usermod -aG sudo swapi
```

Install system dependencies:

```bash
apt update
apt install -y \
  ca-certificates curl git ufw caddy postgresql-client rclone \
  build-essential chromium-browser
```

Verify the Chromium path after install:

```bash
which chromium-browser || which chromium
```

Use the returned path for `PUPPETEER_EXECUTABLE_PATH`.

Install Node.js LTS and PM2:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
```

Create directories:

```bash
mkdir -p /opt/sw-api
mkdir -p /var/lib/sustainability-wise-api/uploads
chown -R swapi:swapi /opt/sw-api /var/lib/sustainability-wise-api
```

Configure the firewall:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from <YOUR_TRUSTED_IP> to any port 22 proto tcp
ufw enable
ufw status verbose
```

Do not expose `3000/tcp` or `5432/tcp`.

## 6. Deploy The API

Clone or update the repository:

```bash
sudo -iu swapi
cd /opt
git clone <REPO_URL> sw-api
cd /opt/sw-api
npm ci --omit=dev
```

Create `/opt/sw-api/.env`:

```bash
cat > /opt/sw-api/.env <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://api.sustainabilitywise.com.au

DATABASE_URL=postgresql://sw_api:<password>@<private-db-host>:25060/sustainability_wise?sslmode=require
JWT_SECRET=<openssl-rand-hex-32>
JWT_REFRESH_SECRET=<openssl-rand-hex-32>
UPLOAD_CAPABILITY_SECRET=<openssl-rand-hex-32>
FILE_CAPABILITY_SECRET=<openssl-rand-hex-32>
ALLOW_LEGACY_UNSIGNED_UPLOADS=false
ALLOW_LEGACY_PUBLIC_FILES=false

# Legacy Spaces destination retained during the migration window.
STORAGE_PROVIDER=spaces
STORAGE_WRITE_MODE=legacy
SPACES_REGION=syd1
SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com
SPACES_BUCKET=sw-legacy-files-syd1
SPACES_ACCESS_KEY_ID=<legacy-spaces-access-key>
SPACES_SECRET_ACCESS_KEY=<legacy-spaces-secret-key>

# Configure distinct buckets and least-privilege credentials, then follow
# docs/SECURE_STORAGE_MIGRATION.md to move legacy -> dual -> isolated.
ECOAUDIT_STORAGE_PROVIDER=spaces
ECOAUDIT_SPACES_REGION=syd1
ECOAUDIT_SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com
ECOAUDIT_SPACES_BUCKET=sw-ecoaudit-files-syd1
ECOAUDIT_SPACES_ACCESS_KEY_ID=<ecoaudit-spaces-access-key>
ECOAUDIT_SPACES_SECRET_ACCESS_KEY=<ecoaudit-spaces-secret-key>
SOLARSENSE_STORAGE_PROVIDER=spaces
SOLARSENSE_SPACES_REGION=syd1
SOLARSENSE_SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com
SOLARSENSE_SPACES_BUCKET=sw-solarsense-files-syd1
SOLARSENSE_SPACES_ACCESS_KEY_ID=<solarsense-spaces-access-key>
SOLARSENSE_SPACES_SECRET_ACCESS_KEY=<solarsense-spaces-secret-key>
INSTALLHUB_STORAGE_PROVIDER=spaces
INSTALLHUB_SPACES_REGION=syd1
INSTALLHUB_SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com
INSTALLHUB_SPACES_BUCKET=sw-installhub-files-syd1
INSTALLHUB_SPACES_ACCESS_KEY_ID=<installhub-spaces-access-key>
INSTALLHUB_SPACES_SECRET_ACCESS_KEY=<installhub-spaces-secret-key>

# Kept for rollback/local emergency mode only when STORAGE_PROVIDER=local.
LOCAL_FILE_STORAGE_ROOT=/var/lib/sustainability-wise-api/uploads
MAX_UPLOAD_BYTES=52428800

ENABLE_API_DOCS=false
PROTECT_API_DOCS=true
CORS_ORIGINS=
ALLOW_LOCAL_BOOTSTRAP=false
ALLOW_LEGACY_BOOTSTRAP_UPSERT=false
ALLOW_LEGACY_SHARED_REGISTRATION_SECRET=false
RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW_MS=60000

ECOAUDIT_REGISTRATION_SECRET=
SOLARSENSE_REGISTRATION_SECRET=
INSTALLHUB_REGISTRATION_SECRET=
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
EOF

chmod 0600 /opt/sw-api/.env
```

Generate secrets on the server:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

If DigitalOcean only gave you the generated `doadmin` user and `defaultdb` database, connect with those once and create the app database/user before using the `sw_api` URL:

```bash
psql 'postgresql://doadmin:<db-password>@<private-db-host>:25060/defaultdb?sslmode=require'
```

Then run:

```sql
CREATE USER sw_api WITH PASSWORD '<new-sw-api-db-password>';
CREATE DATABASE sustainability_wise OWNER sw_api;
```

If this is a fresh deployment, start the API now. The API runs Drizzle migrations during startup:

```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
pm2 startup
pm2 logs sw-api --lines 80
```

If this is a migration from an existing VM, do the migration section before the first `pm2 start` against the managed database. Restoring into a database where the new API has already created tables can fail with duplicate object errors.

## 7. Configure Caddy

Update `/etc/caddy/Caddyfile`:

```caddy
api.sustainabilitywise.com.au {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Reload:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Verify HTTPS:

```bash
curl -i https://api.sustainabilitywise.com.au/health
```

## 8. If Migrating From The Current VM

Use this only if there is existing production data. Do this before first starting the new API against the managed database.

On the old VM:

```bash
pm2 stop sw-api
pg_dump "$OLD_DATABASE_URL" | gzip > /tmp/sw-db-before-option3.sql.gz
tar -C /var/lib/sustainability-wise-api -czf /tmp/sw-uploads-before-option3.tar.gz uploads
```

Copy to the new Droplet:

```bash
scp /tmp/sw-db-before-option3.sql.gz root@<NEW_DROPLET_IP>:/tmp/
scp /tmp/sw-uploads-before-option3.tar.gz root@<NEW_DROPLET_IP>:/tmp/
```

On the new Droplet:

```bash
gunzip -c /tmp/sw-db-before-option3.sql.gz | psql "$DATABASE_URL"
tar -C /var/lib/sustainability-wise-api -xzf /tmp/sw-uploads-before-option3.tar.gz
chown -R swapi:swapi /var/lib/sustainability-wise-api/uploads
sudo -iu swapi
cd /opt/sw-api
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

Run smoke tests before changing DNS. If DNS already points to the old server, temporarily test the new server by editing your local `/etc/hosts`:

```text
<NEW_DROPLET_IP> api.sustainabilitywise.com.au
```

After smoke tests pass, update GoDaddy DNS to the new Droplet IP.

## 9. Verify Spaces Primary Storage

Configure `rclone` as the `swapi` user:

```bash
sudo -iu swapi
rclone config create do-spaces s3 \
  provider DigitalOcean \
  access_key_id '<SPACES_ACCESS_KEY_ID>' \
  secret_access_key '<SPACES_SECRET_ACCESS_KEY>' \
  endpoint syd1.digitaloceanspaces.com \
  acl private
```

Test access:

```bash
rclone lsd do-spaces:
rclone mkdir do-spaces:sw-prod-files-syd1/_healthcheck
rclone rmdir do-spaces:sw-prod-files-syd1/_healthcheck
```

The API also verifies Spaces during normal upload flow. After `STORAGE_PROVIDER=spaces` is set and the API is restarted:

```bash
pm2 restart sw-api
pm2 logs sw-api --lines 80
```

Then upload one test photo from each app and confirm objects appear in the bucket under keys like:

```text
ecoaudit/<audit-id>/...
solarsense/<site-id>/...
```

The returned app download URL should still be an API URL:

```text
https://api.sustainabilitywise.com.au/v1/files/<storage-key>
```

The bucket remains private; the API streams the private object back to the app.

## 10. Migrate Existing Local Uploads To Spaces

Skip this section only if this is a fresh deployment with no existing uploads.

Stop the API before migration:

```bash
pm2 stop sw-api
```

Copy existing VM-local uploads into the Spaces bucket using the same storage keys:

```bash
sudo -iu swapi rclone sync \
  /var/lib/sustainability-wise-api/uploads \
  do-spaces:sw-prod-files-syd1 \
  --checksum \
  --create-empty-src-dirs \
  --log-file /var/log/sw-spaces-migration.log \
  --log-level INFO
```

Restart with `STORAGE_PROVIDER=spaces`:

```bash
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

Verify old files are readable through the API:

```bash
curl -I 'https://api.sustainabilitywise.com.au/v1/files/<known-storage-key>'
```

After verifying old files are readable through the API, either:

1. Keep `/var/lib/sustainability-wise-api/uploads` populated for 30 days as a simple local rollback path.
2. Archive it under `/root/sw-api-deploy-backups/` and empty the active upload directory so future runtime storage cannot accidentally fall back to stale VM-local files.

If you choose option 2:

```bash
TS=$(date +%Y%m%d-%H%M%S)
tar -C /var/lib/sustainability-wise-api/uploads \
  -czf "/root/sw-api-deploy-backups/uploads-before-spaces-cleanup-${TS}.tgz" .
find /var/lib/sustainability-wise-api/uploads -mindepth 1 -delete
```

Rollback to local storage:

1. Set `STORAGE_PROVIDER=local`.
2. If the active upload directory was emptied, restore the upload archive into `/var/lib/sustainability-wise-api/uploads`.
3. Confirm `/var/lib/sustainability-wise-api/uploads` contains the files.
4. Restart the API.

## 11. Create Admin Users

From `/opt/sw-api` on the Droplet:

```bash
APP=ecoaudit EMAIL=admin@sustainabilitywise.com.au PASSWORD='<strong-password>' FULL_NAME='Admin' npm run admin:create
APP=solarsense EMAIL=admin@sustainabilitywise.com.au PASSWORD='<strong-password>' FULL_NAME='Admin' npm run admin:create
```

## 12. Run Smoke Tests

First run the Option 3 infrastructure smoke test on the Droplet. This uses `/opt/sw-api/.env`, checks the managed PostgreSQL connection, writes/reads/deletes a temporary object in the configured storage backend, and does not print secret values:

```bash
cd /opt/sw-api
npm run smoke:option3
```

Expected output:

```text
[option3-smoke] database ok
[option3-smoke] storage ok
[option3-smoke] ok
```

Then run the public API smoke tests from the Droplet or your local machine:

```bash
cd /opt/sw-api
BASE_URL=https://api.sustainabilitywise.com.au \
EA_ADMIN_EMAIL=admin@sustainabilitywise.com.au \
EA_ADMIN_PASSWORD='<strong-password>' \
SS_ADMIN_EMAIL=admin@sustainabilitywise.com.au \
SS_ADMIN_PASSWORD='<strong-password>' \
./deploy/smoke-test.sh
```

Manual checks:

```bash
curl -i https://api.sustainabilitywise.com.au/health
pm2 logs sw-api --lines 80
journalctl -u caddy --no-pager -n 80
```

## 13. Backup And Restore Validation

Managed PostgreSQL:

1. Confirm automated backups are active in the database Overview page.
2. Confirm restore options are available under Actions -> Restore from backup.
3. Perform a restore test to a new temporary database cluster.
4. Connect to the restored cluster and verify row counts.
5. Destroy the temporary restored cluster after verification.

Droplet:

1. Confirm weekly backups are enabled under Droplet -> Backups.
2. Confirm the latest backup appears after the first backup window.
3. For a restore test, create a temporary Droplet from the backup and verify `/opt/sw-api`, `.env`, Caddy, PM2, and upload files exist.
4. Destroy the temporary test Droplet after verification.

Spaces:

1. Confirm the bucket exists in Sydney.
2. Confirm CDN is enabled.
3. Confirm `rclone` can list the bucket.
4. Confirm nightly VM upload backup files appear under `vm-upload-backups/current`.

## 14. Mobile App Connection

Build mobile releases with the production API URL:

```bash
export EXPO_PUBLIC_SYNC_API_URL=https://api.sustainabilitywise.com.au
```

Then rebuild both APKs using the release runbook. After installing the APKs:

1. Log in as EcoAudit admin.
2. Log in as SolarSense admin.
3. Create a test user in each app.
4. Create a small audit/site with one photo.
5. Confirm cloud backup completes.
6. Confirm admin can import the report.
7. Confirm a regular user sees only their own reports.

## 15. Rollback

This section covers an Option 3 infrastructure cutover. For a routine
QA-to-production application release, follow the immutable-path rollback in the
[QA to Production Release Runbook](PRODUCTION_RELEASE_RUNBOOK.md#11-roll-back)
and record it in the
[Production Release Checklist](PRODUCTION_RELEASE_CHECKLIST.md). Never check
out another commit or reinstall dependencies inside a running release.

If the new Droplet or managed DB fails during cutover:

1. Point GoDaddy `api` DNS back to the old Droplet IP.
2. Restart the old API server.
3. Keep the new managed DB and Droplet intact for investigation.
4. Do not destroy the old VM until at least one full backup and one restore test have succeeded on Option 3.

If only the API release fails:

1. Use the previously recorded immutable API release path.
2. Switch only `sw-api` back with the process-switch command in
   `docs/ECOSENSE_PORTAL_DEPLOYMENT.md`.
3. Verify database identity, migration compatibility, loopback/public health,
   authenticated reads, files, thumbnails, and a small export.
4. Preserve the failed release and logs for investigation.

## Acceptance Checklist

- [ ] Droplet is Basic Premium Intel, 8 GB RAM, 4 vCPU, 160 GiB NVMe SSD, 5 TB transfer, Sydney.
- [ ] Droplet weekly backups are enabled.
- [ ] Managed PostgreSQL is in Sydney.
- [ ] Database trusted sources allow the API Droplet.
- [ ] API connects to managed PostgreSQL via `DATABASE_URL`.
- [ ] Managed DB backup/restore option is visible.
- [ ] Spaces bucket exists in Sydney with CDN enabled.
- [ ] API uses `STORAGE_PROVIDER=spaces`.
- [ ] Test uploads and generated PDFs are stored in Spaces and download through `/v1/files/...`.
- [ ] Existing VM-local uploads were copied to Spaces, verified through `/v1/files/...`, then either retained intentionally or archived and removed from the active upload directory.
- [ ] VM-local PostgreSQL is stopped/disabled after managed PostgreSQL cutover, unless it is intentionally being kept online for rollback.
- [ ] Caddy serves HTTPS for `api.sustainabilitywise.com.au`.
- [ ] API binds only to `127.0.0.1:3000`.
- [ ] Firewall exposes only 80, 443, and restricted SSH.
- [ ] Smoke tests pass for both apps.
- [ ] Both mobile apps are rebuilt with the production API URL.
- [ ] One test audit/site syncs, imports, and generates a PDF successfully.

## References

- DigitalOcean Managed PostgreSQL connection details: https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/
- DigitalOcean Managed PostgreSQL backup restore and PITR: https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/
- DigitalOcean Managed PostgreSQL features: https://docs.digitalocean.com/products/databases/postgresql/details/features/
- DigitalOcean Spaces bucket creation: https://docs.digitalocean.com/products/spaces/how-to/create/
- DigitalOcean Droplet backups: https://docs.digitalocean.com/products/backups/how-to/enable/
