#!/bin/bash
# Production smoke tests for a deployed Sustainability Wise API.
#
# Required:
#   BASE_URL=https://api.sustainabilitywise.com.au
#
# Optional login checks:
#   EA_ADMIN_EMAIL=...
#   EA_ADMIN_PASSWORD=...
#   SS_ADMIN_EMAIL=...
#   SS_ADMIN_PASSWORD=...

set -euo pipefail

if [[ -z "${BASE_URL:-}" ]]; then
  echo "BASE_URL is required, for example: BASE_URL=https://api.example.com" >&2
  exit 1
fi
if [[ "$BASE_URL" != https://* ]]; then
  echo "BASE_URL must use https:// for release smoke tests" >&2
  exit 1
fi
TMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

json_value() {
  local key="$1"
  node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(0, 'utf8')); if (!data['$key']) process.exit(1); process.stdout.write(String(data['$key']));"
}

login() {
  local app="$1"
  local email="$2"
  local password="$3"

  curl -fsS \
    -X POST "${BASE_URL}/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"app\":\"${app}\"}" \
    | json_value accessToken
}

echo "[smoke] BASE_URL=${BASE_URL}"

curl -fsS "${BASE_URL}/health" > "${TMP_DIR}/health.json"
echo "[smoke] /health ok"

if [[ -n "${EA_ADMIN_EMAIL:-}" && -n "${EA_ADMIN_PASSWORD:-}" ]]; then
  EA_TOKEN=$(login ecoaudit "$EA_ADMIN_EMAIL" "$EA_ADMIN_PASSWORD")
  curl -fsS "${BASE_URL}/v1/ecoaudit/audits" -H "Authorization: Bearer ${EA_TOKEN}" > "${TMP_DIR}/ea-audits.json"
  echo "[smoke] EcoAudit login and audits list ok"
else
  echo "[smoke] EcoAudit credential env vars not set; skipped authenticated EcoAudit checks"
fi

if [[ -n "${SS_ADMIN_EMAIL:-}" && -n "${SS_ADMIN_PASSWORD:-}" ]]; then
  SS_TOKEN=$(login solarsense "$SS_ADMIN_EMAIL" "$SS_ADMIN_PASSWORD")
  curl -fsS "${BASE_URL}/v1/solarsense/sites" -H "Authorization: Bearer ${SS_TOKEN}" > "${TMP_DIR}/ss-sites.json"
  echo "[smoke] SolarSense login and sites list ok"
else
  echo "[smoke] SolarSense credential env vars not set; skipped authenticated SolarSense checks"
fi

echo "[smoke] complete"
