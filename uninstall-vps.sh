#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/foxpoint_store}"
PURGE_APP="${PURGE_APP:-0}"
PURGE_DB="${PURGE_DB:-0}"
DB_NAME="${DB_NAME:-foxpoint}"
DB_USER="${DB_USER:-foxpoint}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root or with sudo."
  exit 1
fi

systemctl stop foxpoint-api foxpoint-web nginx >/dev/null 2>&1 || true
systemctl disable foxpoint-api foxpoint-web >/dev/null 2>&1 || true

rm -f /etc/systemd/system/foxpoint-api.service
rm -f /etc/systemd/system/foxpoint-web.service
rm -f /etc/nginx/sites-enabled/foxpoint
rm -f /etc/nginx/sites-available/foxpoint

systemctl daemon-reload
systemctl start nginx >/dev/null 2>&1 || true

if [ "$PURGE_APP" = "1" ]; then
  rm -rf "$APP_DIR"
fi

if [ "$PURGE_DB" = "1" ]; then
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" >/dev/null 2>&1 || true
  sudo -u postgres psql -c "DROP ROLE IF EXISTS \"$DB_USER\";" >/dev/null 2>&1 || true
fi

echo "FoxPoint services removed."
