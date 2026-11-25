#!/usr/bin/env bash
# Runs ON the EC2 server, called by .github/workflows/deploy-ec2.yml after every push to main.
#
#   APP=novacrm DOMAIN=crm.askmeister.com APP_PORT=5010 RELEASE=<id> bash ec2-deploy.sh <bundle-dir>
#
# What it does (safe to run again and again):
#   1. puts the new build in /var/www/$APP/releases/<id>
#   2. installs API packages, generates the Prisma client
#   3. writes the nginx site for $DOMAIN, gets a free SSL certificate the first time (certbot)
#   4. switches /var/www/$APP/current to the new release and (re)starts the API with pm2
#   5. checks /health — if the new API does not come up, it switches back to the previous release
#
# Other sites on this server are never touched: nginx changes are tested with `nginx -t` first and
# rolled back if the test fails.
set -euo pipefail

: "${APP:?APP is required}"
: "${DOMAIN:?DOMAIN is required}"
: "${APP_PORT:?APP_PORT is required}"
: "${RELEASE:?RELEASE is required}"
INCOMING="${1:?bundle directory is required}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
HEALTH_PATH="${HEALTH_PATH:-/health}"
API_ENTRY="${API_ENTRY:-dist/server.js}"
# URL paths that go to the API instead of the web app (regex alternatives)
API_PATHS="${API_PATHS:-api|uploads|health}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

BASE="/var/www/$APP"
REL="$BASE/releases/$RELEASE"
SHARED="$BASE/shared"
PM2_NAME="$APP-api"
ME="$(id -un)"

# Non-interactive SSH does not read ~/.bashrc — load nvm if Node was installed with it
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
export PATH="$PATH:/usr/local/bin:/usr/sbin"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mDEPLOY FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || fail "node is not installed"
command -v npm >/dev/null || fail "npm is not installed"
command -v pm2 >/dev/null || fail "pm2 is not installed (npm i -g pm2)"
command -v nginx >/dev/null || command -v /usr/sbin/nginx >/dev/null || fail "nginx is not installed"
log "Node $(node -v), npm $(npm -v), pm2 $(pm2 -v | tail -1)"

# ---------------------------------------------------------------- 1. folders + new release
log "Preparing $REL"
sudo mkdir -p "$BASE/releases" "$SHARED/uploads"
sudo chown -R "$ME":"$ME" "$BASE"
rm -rf "$REL"
mkdir -p "$REL"
cp -a "$INCOMING/web" "$REL/web"
cp -a "$INCOMING/backend" "$REL/backend"

# Secrets: the backend .env comes from the BACKEND_ENV GitHub secret and is kept in shared/
if [ -f "$INCOMING/backend.env" ]; then
  install -m 600 "$INCOMING/backend.env" "$SHARED/backend.env"
fi
[ -f "$SHARED/backend.env" ] || fail "no backend env — add the BACKEND_ENV secret in GitHub"
ln -sfn "$SHARED/backend.env" "$REL/backend/.env"
rm -rf "$REL/backend/uploads"
ln -sfn "$SHARED/uploads" "$REL/backend/uploads"

# ---------------------------------------------------------------- 2. API packages
log "Installing API packages"
cd "$REL/backend"
npm ci --no-audit --no-fund --loglevel=error
if [ -d prisma ]; then
  npx --no-install prisma generate >/dev/null
fi
[ -f "$API_ENTRY" ] || fail "$API_ENTRY missing in the build"

# ---------------------------------------------------------------- port check
if ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$APP_PORT\s"; then
    fail "port $APP_PORT is already used by another program — pick a different APP_PORT in the workflow"
  fi
fi

# ---------------------------------------------------------------- 3. nginx + SSL
if [ -d /etc/nginx/sites-available ]; then
  CONF="/etc/nginx/sites-available/$DOMAIN.conf"
  LINK="/etc/nginx/sites-enabled/$DOMAIN.conf"
else
  CONF="/etc/nginx/conf.d/$DOMAIN.conf"
  LINK=""
fi
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
ACME_ROOT="/var/www/letsencrypt"
sudo mkdir -p "$ACME_ROOT"

proxy_block() {
  cat <<EOF
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
EOF
}

app_locations() {
  cat <<EOF
    root $BASE/current/web;
    index index.html;
    client_max_body_size 25m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;

    location ~ ^/($API_PATHS)(/|\$) {
$(proxy_block)
    }

    # live notifications (socket.io websockets)
    location /socket.io/ {
$(proxy_block)
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # built files have a hash in their name — cache for a year
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # the page shell and the service worker must always be fresh so updates show at once
    location ~ ^/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)\$ {
        add_header Cache-Control "no-cache";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
EOF
}

write_http_only() {
  cat <<EOF
# Managed by $APP deploy (deploy/ec2-deploy.sh) — edits here are overwritten on the next deploy
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root $ACME_ROOT;
    }

$(app_locations)
}
EOF
}

write_https() {
  cat <<EOF
# Managed by $APP deploy (deploy/ec2-deploy.sh) — edits here are overwritten on the next deploy
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root $ACME_ROOT;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL_$APP:10m;
    ssl_session_timeout 1d;

$(app_locations)
}
EOF
}

apply_conf() {
  local new="$1"
  if sudo test -f "$CONF" && sudo cmp -s "$new" "$CONF"; then
    echo "nginx config for $DOMAIN unchanged"
    return 0
  fi
  local backup=""
  if sudo test -f "$CONF"; then
    backup="$(mktemp)"
    sudo cp "$CONF" "$backup"
  fi
  sudo cp "$new" "$CONF"
  if [ -n "$LINK" ]; then sudo ln -sfn "$CONF" "$LINK"; fi
  if sudo nginx -t; then
    sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload
    echo "nginx config for $DOMAIN applied"
  else
    if [ -n "$backup" ]; then
      sudo cp "$backup" "$CONF"
    else
      sudo rm -f "$CONF"
      if [ -n "$LINK" ]; then sudo rm -f "$LINK"; fi
    fi
    fail "nginx config test failed — your other sites were left untouched"
  fi
}

TMP_CONF="$(mktemp)"
if ! sudo test -f "$CERT_DIR/fullchain.pem"; then
  log "No SSL certificate for $DOMAIN yet — requesting one from Let's Encrypt"
  write_http_only >"$TMP_CONF"
  apply_conf "$TMP_CONF"
  command -v certbot >/dev/null || fail "certbot is not installed"
  if [ -n "$CERTBOT_EMAIL" ]; then EMAIL_ARG=(-m "$CERTBOT_EMAIL"); else EMAIL_ARG=(--register-unsafely-without-email); fi
  sudo certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos "${EMAIL_ARG[@]}" \
    --deploy-hook "systemctl reload nginx" \
    || fail "certbot could not get a certificate — check that $DOMAIN points to this server's IP"
fi
log "Writing nginx site for https://$DOMAIN"
write_https >"$TMP_CONF"
apply_conf "$TMP_CONF"
rm -f "$TMP_CONF"

# ---------------------------------------------------------------- 4. switch + start
PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"
switch_to() {
  ln -sfn "$1" "$BASE/current.tmp"
  mv -Tf "$BASE/current.tmp" "$BASE/current"
}

ECO="$SHARED/ecosystem.config.cjs"
cat >"$ECO" <<EOF
module.exports = {
  apps: [
    {
      name: "$PM2_NAME",
      cwd: "$BASE/current/backend",
      script: "$API_ENTRY",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "700M",
      kill_timeout: 8000,
      time: true,
      env: { NODE_ENV: "production", PORT: "$APP_PORT" },
    },
  ],
};
EOF

# Touches ONLY this app's pm2 process — the other projects running in pm2 are never restarted.
start_api() {
  pm2 startOrReload "$ECO" --only "$PM2_NAME" --update-env >/dev/null
}

log "Switching to release $RELEASE"
switch_to "$REL"
start_api

# ---------------------------------------------------------------- 5. health check
log "Checking http://127.0.0.1:$APP_PORT$HEALTH_PATH"
healthy=0
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT$HEALTH_PATH" || true)"
  if [ "$code" = "200" ]; then healthy=1; break; fi
  sleep 3
done

if [ "$healthy" != "1" ]; then
  echo "---- last API logs ----"
  pm2 logs "$PM2_NAME" --nostream --lines 60 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$REL" ]; then
    log "Rolling back to $(basename "$PREV")"
    switch_to "$PREV"
    start_api
  fi
  fail "the new API did not answer $HEALTH_PATH (last status: ${code:-none})"
fi
pm2 save >/dev/null

public="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN$HEALTH_PATH" || true)"
echo "API healthy. Public check https://$DOMAIN$HEALTH_PATH -> $public"

# ---------------------------------------------------------------- cleanup
cd "$BASE/releases"
ls -1t | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "$BASE/releases/$old" = "$REL" ] && continue
  rm -rf "${BASE:?}/releases/$old"
done
rm -rf "$INCOMING"

log "Deployed $APP release $RELEASE to https://$DOMAIN"
