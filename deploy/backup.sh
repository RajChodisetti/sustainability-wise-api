#!/bin/bash
# Daily database backup to OneDrive via rclone.
# Cron: 0 2 * * * /opt/sw-api/deploy/backup.sh >> /var/log/sw-backup.log 2>&1
#
# Prerequisites:
#   rclone configured with remote named 'onedrive' (run: rclone config)
#   PostgreSQL user swapi with access to sw_production

set -euo pipefail

STAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="/tmp/sw_backup_${STAMP}.sql.gz"
REMOTE_PATH="onedrive:SustainabilityWise/backups/db"

echo "[$(date)] Starting backup..."
pg_dump -U swapi sw_production | gzip > "$OUTFILE"

SIZE=$(du -sh "$OUTFILE" | cut -f1)
echo "[$(date)] Dump complete: ${OUTFILE} (${SIZE})"

rclone copy "$OUTFILE" "$REMOTE_PATH"
echo "[$(date)] Uploaded to ${REMOTE_PATH}/$(basename "$OUTFILE")"

rm "$OUTFILE"
echo "[$(date)] Backup done."
