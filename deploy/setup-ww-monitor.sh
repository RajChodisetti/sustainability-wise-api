#!/usr/bin/env bash
# Deploy the Wattwatchers Fleet Monitor and register its DST-safe systemd timer.
# Run as root (or sudo) on the droplet: bash /tmp/setup-ww-monitor.sh
# Prerequisite: bootstrap-server.sh must have created the swapi user.
set -euo pipefail

MONITOR_DIR="/opt/ww-monitor"
DATA_DIR="/var/lib/ww-monitor"
LOG_DIR="/var/log/ww-monitor"
RUN_USER="swapi"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Python 3 + venv..."
apt-get install -y python3 python3-pip python3-venv

echo "==> Creating application and private runtime directories..."
install -d -o "$RUN_USER" -g "$RUN_USER" -m 0750 \
  "$MONITOR_DIR" "$DATA_DIR" "$DATA_DIR/reports" "$LOG_DIR"
install -d -o "$RUN_USER" -g "$RUN_USER" -m 0700 "$DATA_DIR/spool"

echo ""
echo "==> Copy fleet monitor files to the droplet before continuing:"
echo "    From the wattwatchers-fleet-monitor checkout on your local machine run:"
echo "    scp monitor.py requirements.txt .env.example DEPLOYMENT.md root@170.64.154.143:$MONITOR_DIR/"
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

echo "==> Running a safe one-off validation (no email, state, spool, or ingest)..."
sudo -u "$RUN_USER" "$MONITOR_DIR/.venv/bin/python3" "$MONITOR_DIR/monitor.py" \
  --dry-run --report-output /tmp/wattwatchers-dry-run.html
echo "Check stdout and /tmp/wattwatchers-dry-run.html."
echo ""
read -rp "Sanity check OK? Press Enter to register the systemd timer..."

echo "==> Preserving any legacy runtime data outside the application checkout..."
if [[ -f "$MONITOR_DIR/state.json" && ! -e "$DATA_DIR/state.json" ]]; then
  install -o "$RUN_USER" -g "$RUN_USER" -m 0600 "$MONITOR_DIR/state.json" "$DATA_DIR/state.json"
fi
if [[ -d "$MONITOR_DIR/.spool" ]]; then
  cp -an "$MONITOR_DIR/.spool/." "$DATA_DIR/spool/"
fi
shopt -s nullglob
legacy_reports=("$MONITOR_DIR"/report_*.html)
if (( ${#legacy_reports[@]} )); then
  cp -an "${legacy_reports[@]}" "$DATA_DIR/reports/"
fi
shopt -u nullglob
chown -R "$RUN_USER":"$RUN_USER" "$DATA_DIR"
find "$DATA_DIR" -type d -exec chmod 0750 {} +
chmod 0700 "$DATA_DIR/spool"
find "$DATA_DIR" -type f -exec chmod 0600 {} +

echo "==> Installing the Wattwatchers systemd service and timer..."
systemd-analyze calendar '*-*-* 07:00:00 Australia/Melbourne'
install -m 0644 "$DEPLOY_DIR/ww-fleet-monitor.service" /etc/systemd/system/ww-fleet-monitor.service
install -m 0644 "$DEPLOY_DIR/ww-fleet-monitor.timer" /etc/systemd/system/ww-fleet-monitor.timer
systemctl daemon-reload

# Remove the legacy PM2 cron before the baseline so it cannot interrupt a long
# scan or send a second email while the systemd handoff is in progress. If the
# baseline fails, leave collection paused and investigate instead of restoring
# an email-capable scheduler automatically.
sudo -u "$RUN_USER" pm2 delete ww-fleet-monitor >/dev/null 2>&1 || true
sudo -u "$RUN_USER" pm2 save

echo "==> Collecting the first scheduled-labelled baseline without sending email..."
# This creates today's durable schedule checkpoint before enabling the
# Persistent timer, preventing a first-install catch-up from emailing twice.
sudo -u "$RUN_USER" "$MONITOR_DIR/.venv/bin/python3" "$MONITOR_DIR/monitor.py" \
  --scheduled --no-email

systemctl enable --now ww-fleet-monitor.timer
systemctl is-active --quiet ww-fleet-monitor.timer
systemctl list-timers ww-fleet-monitor.timer --no-pager

echo ""
echo "Done. Useful commands:"
echo "  systemctl list-timers ww-fleet-monitor.timer – see the next trigger"
echo "  systemctl start ww-fleet-monitor.service      – trigger a scheduled-labelled run"
echo "  systemctl disable --now ww-fleet-monitor.timer – pause the schedule"
echo "  journalctl -u ww-fleet-monitor.service         – service logs"
echo "  ls -la $DATA_DIR                               – private collector state"
