#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR=/opt/foxpoint_store
BACKUP_DIR="$(dirname "$(realpath "$0")")"
case "$BACKUP_DIR" in /opt/foxpoint-backups/fix-*) ;; *) echo "Invalid backup directory." >&2; exit 1 ;; esac
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
if [ -e "$BACKUP_DIR/rollback-complete" ]; then echo "This backup was already restored."; exit 0; fi
if [ ! -s "$BACKUP_DIR/database-before.dump" ] || [ ! -f "$BACKUP_DIR/database.env" ]; then
  echo "Backup is incomplete; automatic restoration is unavailable." >&2
  exit 1
fi

# Manual rollback takes the same lock as deployment. Automatic rollback runs under its parent's lock.
if [ "${1:-}" != "--automatic" ]; then
  exec 9>/var/lock/foxpoint-local-fix.lock
  flock -n 9 || { echo "Another FoxPoint deployment is running." >&2; exit 1; }
fi
PG_URL="$(node "$BACKUP_DIR/env-runner.mjs" "$BACKUP_DIR/database.env" --postgres-url)"
systemctl stop foxpoint-web foxpoint-api
if [ -e "$BACKUP_DIR/schema-started" ]; then
  # Preserve any payments/requests received after the preview before restoring the old DB.
  pg_dump "$PG_URL" --format=custom --no-owner --file="$BACKUP_DIR/database-before-rollback-$(date +%Y%m%d-%H%M%S).dump"
  pg_restore --dbname="$PG_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$BACKUP_DIR/database-before.dump"
fi
if [ -d "$BACKUP_DIR/app-before" ]; then
  if [ -e "$APP_DIR" ]; then mv "$APP_DIR" "$BACKUP_DIR/app-rejected-$(date +%Y%m%d-%H%M%S)"; fi
  mv "$BACKUP_DIR/app-before" "$APP_DIR"
fi
systemctl start foxpoint-api foxpoint-web
touch "$BACKUP_DIR/rollback-complete"
echo "Previous code and database restored. Backup: $BACKUP_DIR"
