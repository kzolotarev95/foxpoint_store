#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR=/opt/foxpoint_store
SOURCE_DIR="$(realpath "${1:?Source directory is required}")"
case "$SOURCE_DIR" in /var/tmp/foxpoint-local-fix.*/source) ;; *) echo "Invalid incoming directory." >&2; exit 1 ;; esac
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
if [ ! -d "$APP_DIR/.git" ] || [ ! -f "$APP_DIR/.env" ] || [ -L "$APP_DIR" ]; then
  echo "Expected an existing installation at $APP_DIR." >&2; exit 1
fi
for command in node npm pg_dump pg_restore curl systemctl flock; do
  command -v "$command" >/dev/null || { echo "Required command is missing: $command" >&2; exit 1; }
done
exec 9>/var/lock/foxpoint-local-fix.lock
flock -n 9 || { echo "Another FoxPoint deployment is running." >&2; exit 1; }
for service in foxpoint-api foxpoint-web; do
  [ "$(systemctl show "$service" --property=WorkingDirectory --value)" = "$APP_DIR" ] || {
    echo "$service uses a different working directory. Deployment cancelled." >&2; exit 1;
  }
  systemctl is-active --quiet "$service" || { echo "$service is not active. Deployment cancelled." >&2; exit 1; }
done

TAG="fix-$(date +%Y%m%d-%H%M%S)-$$"
BACKUP_DIR="/opt/foxpoint-backups/$TAG"
CANDIDATE_DIR="/opt/foxpoint-releases/$TAG"
mkdir -p "$BACKUP_DIR" "$CANDIDATE_DIR"
chmod 700 /opt/foxpoint-backups "$BACKUP_DIR" "$CANDIDATE_DIR"
cp -a "$SOURCE_DIR/." "$CANDIDATE_DIR/"
cp "$APP_DIR/.env" "$CANDIDATE_DIR/.env"
cp "$APP_DIR/.env" "$BACKUP_DIR/database.env"
cp "$CANDIDATE_DIR/scripts/run-with-env.mjs" "$BACKUP_DIR/env-runner.mjs"
cp "$CANDIDATE_DIR/deploy/scripts/rollback-local-fix.sh" "$BACKUP_DIR/rollback.sh"
chmod 600 "$CANDIDATE_DIR/.env" "$BACKUP_DIR/database.env"
chmod 700 "$BACKUP_DIR/rollback.sh"
PG_URL="$(node "$BACKUP_DIR/env-runner.mjs" "$BACKUP_DIR/database.env" --postgres-url)"
SERVICES_STOPPED=0
BACKUP_READY=0

on_failure() {
  local code="$1"
  trap - ERR INT TERM
  echo "Deployment failed. Backup and logs: $BACKUP_DIR" >&2
  if [ "$SERVICES_STOPPED" = 1 ]; then
    if [ "$BACKUP_READY" = 1 ]; then
      if ! bash "$BACKUP_DIR/rollback.sh" --automatic; then
        echo "Automatic restoration failed. Services remain stopped; use $BACKUP_DIR/rollback.sh." >&2
      fi
    else
      systemctl start foxpoint-api foxpoint-web || true
    fi
  fi
  exit "$code"
}
trap 'on_failure $?' ERR
trap 'on_failure 130' INT TERM
exec > >(tee -a "$BACKUP_DIR/deploy.log") 2>&1

echo "Building local fix; the current site remains online."
cd "$CANDIDATE_DIR"
node scripts/run-with-env.mjs .env npm ci --include=dev --include=optional --no-audit
node scripts/run-with-env.mjs .env npm run db:generate
node scripts/run-with-env.mjs .env npm run build
node scripts/run-with-env.mjs .env node scripts/test-subscription-period.mjs
node scripts/run-with-env.mjs .env node scripts/import-client-database.mjs --dry-run
cp -a "$APP_DIR/.git" "$CANDIDATE_DIR/.git"

echo "Saving the server database and switching to the tested fix."
SERVICES_STOPPED=1
systemctl stop foxpoint-web foxpoint-api
pg_dump "$PG_URL" --format=custom --no-owner --file="$BACKUP_DIR/database-before.dump"
pg_restore --list "$BACKUP_DIR/database-before.dump" > "$BACKUP_DIR/database-before.contents"
BACKUP_READY=1
touch "$BACKUP_DIR/schema-started"
# Refuse schema changes that Prisma considers destructive.
node scripts/run-with-env.mjs .env npm run db:push
node scripts/run-with-env.mjs .env node scripts/import-client-database.mjs
mv "$APP_DIR" "$BACKUP_DIR/app-before"
mv "$CANDIDATE_DIR" "$APP_DIR"
systemctl start foxpoint-api foxpoint-web

ready=0
for attempt in $(seq 1 30); do
  if systemctl is-active --quiet foxpoint-api foxpoint-web &&
    curl --fail --silent --max-time 3 http://127.0.0.1:4000/health >/dev/null &&
    curl --fail --silent --max-time 3 http://127.0.0.1:3000/login >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "The new services did not pass their health checks." >&2; false; }
touch "$BACKUP_DIR/deploy-complete"
trap - ERR INT TERM
echo "Local fix installed. GitHub was not changed."
echo "Backup: $BACKUP_DIR"
echo "Rollback: sudo bash $BACKUP_DIR/rollback.sh"
echo "Open the admin panel at your current site address."
