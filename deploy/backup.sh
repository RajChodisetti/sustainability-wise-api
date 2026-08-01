#!/bin/bash
# Daily database and local upload backup to OneDrive via rclone.
# Cron: 0 2 * * * /opt/sw-api/deploy/backup.sh >> /var/log/sw-backup.log 2>&1
#
# Prerequisites:
#   rclone configured with remote named 'onedrive' (run: rclone config)
#   /opt/sw-api/.env contains DATABASE_URL and LOCAL_FILE_STORAGE_ROOT

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sw-api}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

REMOTE_PATH="${BACKUP_REMOTE_PATH:-onedrive:SustainabilityWise/backups}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required via ${ENV_FILE} or environment" >&2
  exit 1
fi

STAMP=$(date +%Y%m%d_%H%M%S)
DB_OUTFILE="/tmp/sw_db_backup_${STAMP}.sql.gz"
FILES_OUTFILE="/tmp/sw_uploads_backup_${STAMP}.tar.gz"

echo "[$(date)] Starting backup..."
pg_dump "$DATABASE_URL" | gzip > "$DB_OUTFILE"

DB_SIZE=$(du -sh "$DB_OUTFILE" | cut -f1)
echo "[$(date)] Database dump complete: ${DB_OUTFILE} (${DB_SIZE})"

rclone copy "$DB_OUTFILE" "${REMOTE_PATH}/db"
echo "[$(date)] Uploaded database backup to ${REMOTE_PATH}/db/$(basename "$DB_OUTFILE")"

if [[ -n "${LOCAL_FILE_STORAGE_ROOT:-}" && -d "$LOCAL_FILE_STORAGE_ROOT" ]]; then
  tar -C "$LOCAL_FILE_STORAGE_ROOT" -czf "$FILES_OUTFILE" .
  FILES_SIZE=$(du -sh "$FILES_OUTFILE" | cut -f1)
  echo "[$(date)] Upload files archive complete: ${FILES_OUTFILE} (${FILES_SIZE})"
  rclone copy "$FILES_OUTFILE" "${REMOTE_PATH}/uploads"
  echo "[$(date)] Uploaded files backup to ${REMOTE_PATH}/uploads/$(basename "$FILES_OUTFILE")"
  rm "$FILES_OUTFILE"
else
  echo "[$(date)] LOCAL_FILE_STORAGE_ROOT missing or not a directory; skipped upload files backup"
fi

rm "$DB_OUTFILE"
echo "[$(date)] Backup done."
