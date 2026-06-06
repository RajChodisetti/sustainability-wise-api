#!/usr/bin/env bash
# Run this as root on the Droplet (170.64.154.143) once SSH/console access is available.
# Usage: bash /tmp/bootstrap-server.sh
set -euo pipefail

REPO_URL="${REPO_URL:-}"   # set before running, e.g. REPO_URL=git@github.com:org/repo.git

# ---------- system packages ----------
apt-get update -q
apt-get install -y \
  ca-certificates curl git ufw caddy postgresql-client rclone \
  build-essential chromium-browser

# ---------- node 22 + pm2 ----------
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g pm2

# ---------- app user + directories ----------
id swapi &>/dev/null || adduser --disabled-password --gecos "" swapi
usermod -aG sudo swapi
mkdir -p /opt/sw-api /var/lib/sustainability-wise-api/uploads
chown -R swapi:swapi /opt/sw-api /var/lib/sustainability-wise-api

# ---------- firewall ----------
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
# Keep SSH open from anywhere during initial setup; restrict after confirmed working
ufw allow 22/tcp
ufw --force enable
ufw status verbose

# ---------- caddy ----------
cat > /etc/caddy/Caddyfile <<'EOF'
api.sustainabilitywise.com.au {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy
systemctl reload caddy || systemctl start caddy

# ---------- deploy api ----------
if [[ -n "$REPO_URL" ]]; then
  sudo -u swapi git clone "$REPO_URL" /opt/sw-api || (cd /opt/sw-api && sudo -u swapi git pull)
  cd /opt/sw-api
  sudo -u swapi npm ci --omit=dev
else
  echo "REPO_URL not set — skipping git clone. Copy .env.production manually then run npm ci."
fi

echo ""
echo "Bootstrap complete. Next steps:"
echo "  1. scp .env.production root@170.64.154.143:/opt/sw-api/.env"
echo "  2. chmod 0600 /opt/sw-api/.env && chown swapi:swapi /opt/sw-api/.env"
echo "  3. Test DB: PGPASSWORD=<db-password> psql 'host=<private-db-host> port=25060 user=doadmin dbname=defaultdb sslmode=require' -c 'select now();'"
echo "  4. cd /opt/sw-api && sudo -u swapi pm2 start deploy/ecosystem.config.cjs --env production"
echo "  5. sudo -u swapi pm2 save && pm2 startup"
echo "  6. curl -i http://127.0.0.1:3000/health"
