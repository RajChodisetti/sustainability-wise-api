#!/usr/bin/env bash
# Run as root on the Droplet after bootstrap-server.sh.
# Sets up rclone Spaces backup for /var/lib/sustainability-wise-api/uploads.
set -euo pipefail

SPACES_KEY="${SPACES_KEY:-<spaces-access-key>}"
SPACES_SECRET="${SPACES_SECRET:-<spaces-secret-key>}"
SPACES_BUCKET="sw-prod-files-syd1"

# configure rclone as swapi user
sudo -u swapi rclone config create do-spaces s3 \
  provider DigitalOcean \
  access_key_id "$SPACES_KEY" \
  secret_access_key "$SPACES_SECRET" \
  endpoint syd1.digitaloceanspaces.com \
  acl private

# verify
sudo -u swapi rclone lsd do-spaces:
sudo -u swapi rclone mkdir "do-spaces:${SPACES_BUCKET}/vm-upload-backups"

# sync script
tee /usr/local/bin/sw-sync-uploads-to-spaces >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC="/var/lib/sustainability-wise-api/uploads"
DEST="do-spaces:sw-prod-files-syd1/vm-upload-backups/current"
sudo -u swapi rclone sync "$SRC" "$DEST" \
  --checksum \
  --create-empty-src-dirs \
  --log-file /var/log/sw-spaces-sync.log \
  --log-level INFO
EOF
chmod 0755 /usr/local/bin/sw-sync-uploads-to-spaces
touch /var/log/sw-spaces-sync.log
chown swapi:swapi /var/log/sw-spaces-sync.log

# cron (nightly 02:15)
(crontab -l 2>/dev/null | grep -v sw-sync-uploads; echo "15 2 * * * /usr/local/bin/sw-sync-uploads-to-spaces") | crontab -

echo "Spaces backup configured. Running first sync..."
/usr/local/bin/sw-sync-uploads-to-spaces
echo "Done."
