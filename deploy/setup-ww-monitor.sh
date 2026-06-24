#!/usr/bin/env bash
# Deploy the Wattwatchers Fleet Monitor to the droplet and register it with PM2.
# Run as root (or sudo) on the droplet: bash /tmp/setup-ww-monitor.sh
# Prerequisites: bootstrap-server.sh must have been run first (swapi user, PM2 installed).
set -euo pipefail

MONITOR_DIR="/opt/ww-monitor"
LOG_DIR="/var/log/ww-monitor"
RUN_USER="swapi"

echo "==> Installing Python 3 + venv..."
apt-get install -y python3 python3-pip python3-venv

echo "==> Creating directories..."
mkdir -p "$MONITOR_DIR" "$LOG_DIR"
chown -R "$RUN_USER":"$RUN_USER" "$MONITOR_DIR" "$LOG_DIR"

echo ""
echo "==> Copy fleet monitor files to the droplet before continuing:"
echo "    From your local machine run:"
echo "    scp -r sustainability-wise-api/wattwatchers-fleet-monitor/* root@170.64.154.143:$MONITOR_DIR/"
echo ""
read -rp "Press Enter once files are copied..."

echo "==> Setting up Python virtual environment..."
sudo -u "$RUN_USER" python3 -m venv "$MONITOR_DIR/.venv"
sudo -u "$RUN_USER" "$MONITOR_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$RUN_USER" "$MONITOR_DIR/.venv/bin/pip" install -r "$MONITOR_DIR/requirements.txt"

if [[ ! -f "$MONITOR_DIR/.env" ]]; then
  echo ""
  echo "==> No .env found. Copy your secrets now:"
  echo "    scp sustainability-wise-api/wattwatchers-fleet-monitor/.env root@170.64.154.143:$MONITOR_DIR/.env"
  echo ""
  read -rp "Press Enter once .env is in place..."
fi

chown "$RUN_USER":"$RUN_USER" "$MONITOR_DIR/.env"
chmod 0600 "$MONITOR_DIR/.env"

echo "==> Running a one-off sanity check..."
sudo -u "$RUN_USER" "$MONITOR_DIR/.venv/bin/python3" "$MONITOR_DIR/monitor.py"
echo "Check $MONITOR_DIR/monitor.log and confirm a report was generated and email sent."
echo ""
read -rp "Sanity check OK? Press Enter to register with PM2..."

echo "==> Registering ww-fleet-monitor with PM2..."
# Start using the shared ecosystem config in the API repo
sudo -u "$RUN_USER" pm2 start /opt/sw-api/deploy/ecosystem.config.cjs --only ww-fleet-monitor
sudo -u "$RUN_USER" pm2 save

echo ""
echo "Done. Useful commands:"
echo "  pm2 status                        – see all apps"
echo "  pm2 logs ww-fleet-monitor         – tail logs"
echo "  pm2 restart ww-fleet-monitor      – trigger a manual run now"
echo "  pm2 stop ww-fleet-monitor         – pause the schedule"
echo "  cat $MONITOR_DIR/monitor.log      – full run log"
