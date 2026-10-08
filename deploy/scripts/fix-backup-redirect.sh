#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
APP_DIR=/opt/foxpoint_store
SOURCE_DIR="$(realpath "${1:?Incoming directory is required}")"
case "$SOURCE_DIR" in /var/tmp/foxpoint-redirect-fix.*) ;; *) echo "Invalid incoming directory." >&2; exit 1 ;; esac
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -d "$APP_DIR" ] && [ ! -L "$APP_DIR" ] || { echo "Expected /opt/foxpoint_store installation." >&2; exit 1; }
exec 9>/var/lock/foxpoint-local-fix.lock
flock -n 9 || { echo "A FoxPoint deployment or restore is running." >&2; exit 1; }
for file in scripts/configure-backup-nginx.mjs deploy/nginx/foxpoint.conf deploy/nginx/foxpoint-tls.conf; do
  [ -f "$APP_DIR/$file" ] && [ -f "$SOURCE_DIR/$(basename "$file")" ] || { echo "Missing $file" >&2; exit 1; }
done
BACKUP_DIR="/opt/foxpoint-backups/redirect-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP_DIR/scripts" "$BACKUP_DIR/deploy/nginx"
chmod 700 /opt/foxpoint-backups "$BACKUP_DIR"
for file in scripts/configure-backup-nginx.mjs deploy/nginx/foxpoint.conf deploy/nginx/foxpoint-tls.conf; do cp -a "$APP_DIR/$file" "$BACKUP_DIR/$file"; done
cp -a /etc/nginx/sites-available/foxpoint "$BACKUP_DIR/nginx-before.conf"
cat > "$BACKUP_DIR/rollback.sh" <<'FOXPOINT_ROLLBACK'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
BACKUP_DIR="$(dirname "$(realpath "$0")")"
case "$BACKUP_DIR" in /opt/foxpoint-backups/redirect-*) ;; *) exit 1 ;; esac
if [ "${1:-}" != --automatic ]; then exec 9>/var/lock/foxpoint-local-fix.lock; flock -n 9; fi
for file in scripts/configure-backup-nginx.mjs deploy/nginx/foxpoint.conf deploy/nginx/foxpoint-tls.conf; do cp -a "$BACKUP_DIR/$file" "/opt/foxpoint_store/$file"; done
cp -a "$BACKUP_DIR/nginx-before.conf" /etc/nginx/sites-available/foxpoint
nginx -t
systemctl reload nginx
echo "Previous configuration restored: $BACKUP_DIR"
FOXPOINT_ROLLBACK
chmod 700 "$BACKUP_DIR/rollback.sh"
on_failure() {
  local code="$1"
  trap - ERR
  bash "$BACKUP_DIR/rollback.sh" --automatic || true
  echo "Redirect fix failed. Backup: $BACKUP_DIR" >&2
  exit "$code"
}
trap 'on_failure $?' ERR
node "$SOURCE_DIR/configure-backup-nginx.mjs"
# Preserve the fix in future full backups and new-server restores too.
for file in scripts/configure-backup-nginx.mjs deploy/nginx/foxpoint.conf deploy/nginx/foxpoint-tls.conf; do cp "$SOURCE_DIR/$(basename "$file")" "$APP_DIR/$file"; done
trap - ERR
echo "Backup page redirect fixed. Application and database services were not restarted."
echo "Backup: $BACKUP_DIR"
echo "Rollback: sudo bash $BACKUP_DIR/rollback.sh"
