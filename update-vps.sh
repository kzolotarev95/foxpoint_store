#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/foxpoint_store}"
BRANCH="${BRANCH:-main}"

escape_sed() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

is_ip_address() {
  case "$1" in
    *:*)
      return 0
      ;;
    *.*)
      if printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        return 0
      fi
      ;;
  esac

  return 1
}

render_template() {
  local source="$1"
  local target="$2"
  local npm_bin="$3"
  local server_name="$4"

  sed \
    -e "s|__APP_DIR__|$(escape_sed "$APP_DIR")|g" \
    -e "s|__NPM_BIN__|$(escape_sed "$npm_bin")|g" \
    -e "s|__SERVER_NAME__|$(escape_sed "$server_name")|g" \
    "$source" > "$target"
}

sync_nginx_configs() {
  local app_url
  local cert_dir
  local app_host

  app_url="$(grep '^NEXT_PUBLIC_APP_URL=' "$APP_DIR/.env" | tail -n 1 | cut -d= -f2-)"
  app_host="$(printf '%s' "$app_url" | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##')"

  cert_dir="/etc/letsencrypt/live/$app_host"
  if [ -n "$app_host" ] && ! is_ip_address "$app_host" && [ -f "$cert_dir/fullchain.pem" ] && [ -f "$cert_dir/privkey.pem" ]; then
    render_template "$APP_DIR/deploy/nginx/foxpoint-tls.conf" "/etc/nginx/sites-available/foxpoint" "$(command -v npm)" "$app_host"
    ln -sf /etc/nginx/sites-available/foxpoint /etc/nginx/sites-enabled/foxpoint
    rm -f /etc/nginx/sites-enabled/foxpoint-8443 /etc/nginx/sites-available/foxpoint-8443
  else
    render_template "$APP_DIR/deploy/nginx/foxpoint.conf" "/etc/nginx/sites-available/foxpoint" "$(command -v npm)" "${app_host:-_}"
    ln -sf /etc/nginx/sites-available/foxpoint /etc/nginx/sites-enabled/foxpoint
    rm -f /etc/nginx/sites-enabled/foxpoint-8443 /etc/nginx/sites-available/foxpoint-8443
  fi

  nginx -t
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root or with sudo."
  exit 1
fi

cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

npm ci --include=optional
npm rebuild sharp >/dev/null 2>&1 || npm install --include=optional sharp
npm run db:generate
npm run build
bash "$APP_DIR/deploy/scripts/prisma-safe-db-push.sh" "$APP_DIR"

sync_nginx_configs
systemctl restart foxpoint-api foxpoint-web
systemctl reload nginx

echo "FoxPoint updated."
