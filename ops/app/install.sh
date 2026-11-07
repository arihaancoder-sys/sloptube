#!/usr/bin/env bash
# sloptube server installer.
#
# Run once, as root, on a fresh Ubuntu 24.04 server:
#   bash install.sh
#
# Before running it, create /opt/sloptube/.env (see ops/app/README.md).
# It must contain at least DOMAIN=your.domain.
#
# What it does:
#   1. Installs Docker and Caddy
#   2. Writes /opt/sloptube/docker-compose.yml
#   3. Writes a Caddyfile that sends your domain to the app
#   4. Installs /usr/local/bin/sloptube-update and a systemd timer that runs it
#      every 5 minutes (pull :latest, start it next to the old one, check
#      /api/health, switch Caddy over, stop the old one)
#   5. Runs the first update right away
#
# Safe to run again: it just rewrites the same files.

set -euo pipefail

APP_DIR=/opt/sloptube
ENV_FILE=$APP_DIR/.env
IMAGE=ghcr.io/myfilehero/sloptube:latest

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (try: sudo bash install.sh)"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. Create it first, see ops/app/README.md"

DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$DOMAIN" ] || die "DOMAIN= is not set in $ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already installed"
fi
systemctl enable --now docker

# ---------------------------------------------------------------- Caddy
if ! command -v caddy >/dev/null 2>&1; then
  say "Installing Caddy"
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  say "Caddy already installed"
fi

# ---------------------------------------------------------------- compose file
say "Writing $APP_DIR/docker-compose.yml"
mkdir -p "$APP_DIR"
cat > "$APP_DIR/docker-compose.yml" <<'YAML'
# Written by install.sh. Same as ops/app/docker-compose.yml in the repo.
services:
  app:
    image: ghcr.io/myfilehero/sloptube:${TAG:-latest}
    restart: unless-stopped
    env_file: /opt/sloptube/.env
    ports:
      - "127.0.0.1:${PORT:-3000}:3000"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
YAML

# ---------------------------------------------------------------- Caddy config
say "Writing Caddy config for $DOMAIN"
# The upstream lives in its own small file so the update script can flip
# between port 3000 (blue) and 3001 (green) without touching the rest.
if [ ! -f /etc/caddy/sloptube-upstream.caddy ]; then
  echo "reverse_proxy 127.0.0.1:3000" > /etc/caddy/sloptube-upstream.caddy
fi
cat > /etc/caddy/Caddyfile <<CADDY
# Written by sloptube install.sh
# Cloudflare sits in front (proxied, SSL mode "Full"), so Caddy uses its own
# internal certificate for the Cloudflare to server hop.
$DOMAIN {
	tls internal
	encode zstd gzip
	import /etc/caddy/sloptube-upstream.caddy
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload-or-restart caddy

# ---------------------------------------------------------------- update script
say "Installing /usr/local/bin/sloptube-update"
cat > /usr/local/bin/sloptube-update <<'UPDATE'
#!/usr/bin/env bash
# Pulls the newest sloptube image and swaps to it with no downtime.
# Blue runs on 127.0.0.1:3000, green on 127.0.0.1:3001.
# Log: /var/log/sloptube-update.log
set -uo pipefail

APP_DIR=/opt/sloptube
IMAGE=ghcr.io/myfilehero/sloptube:latest
STATE=$APP_DIR/active
UPSTREAM=/etc/caddy/sloptube-upstream.caddy
LOG=/var/log/sloptube-update.log

exec >>"$LOG" 2>&1
exec 9>/run/sloptube-update.lock
flock -n 9 || { echo "$(date -Is) another update is running, skipping"; exit 0; }

log() { echo "$(date -Is) $*"; }
port_of() { [ "$1" = green ] && echo 3001 || echo 3000; }
compose() { local color=$1; shift; PORT=$(port_of "$color") docker compose -p "sloptube-$color" -f "$APP_DIR/docker-compose.yml" "$@"; }
is_running() { [ -n "$(compose "$1" ps -q --status running 2>/dev/null)" ]; }

active=$(cat "$STATE" 2>/dev/null || echo none)
before=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)

if ! docker pull -q "$IMAGE" >/dev/null; then
  log "pull failed (is the package public, or did you run docker login ghcr.io?)"
  exit 1
fi
after=$(docker image inspect -f '{{.Id}}' "$IMAGE")

if [ "$before" = "$after" ] && [ "$active" != none ] && is_running "$active"; then
  exit 0  # nothing new, quiet exit
fi

if [ "$active" = blue ]; then next=green; else next=blue; fi
port=$(port_of "$next")
log "new image ${after:7:12}, starting $next on port $port (active: $active)"

compose "$next" up -d --force-recreate --remove-orphans

healthy=no
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    healthy=yes
    break
  fi
  sleep 2
done

if [ "$healthy" != yes ]; then
  log "$next failed /api/health, keeping $active. Last container logs:"
  compose "$next" logs --tail 40
  compose "$next" down
  exit 1
fi

echo "reverse_proxy 127.0.0.1:$port" > "$UPSTREAM"
if ! systemctl reload caddy; then
  log "caddy reload failed, keeping $active"
  [ "$active" != none ] && echo "reverse_proxy 127.0.0.1:$(port_of "$active")" > "$UPSTREAM"
  compose "$next" down
  exit 1
fi
echo "$next" > "$STATE"
log "caddy now points at $next ($port), version: $(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/version" || echo unknown)"

if [ "$active" != none ] && [ "$active" != "$next" ]; then
  compose "$active" down
  log "stopped $active"
fi

docker image prune -f >/dev/null
log "done"
UPDATE
chmod 755 /usr/local/bin/sloptube-update

# ---------------------------------------------------------------- systemd timer
say "Installing the sloptube-update timer (every 5 minutes)"
cat > /etc/systemd/system/sloptube-update.service <<'UNIT'
[Unit]
Description=Pull and deploy the newest sloptube image
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/sloptube-update
UNIT

cat > /etc/systemd/system/sloptube-update.timer <<'UNIT'
[Unit]
Description=Run sloptube-update every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > /etc/logrotate.d/sloptube-update <<'ROTATE'
/var/log/sloptube-update.log {
	weekly
	rotate 8
	compress
	missingok
	notifempty
}
ROTATE

systemctl daemon-reload
systemctl enable --now sloptube-update.timer

# ---------------------------------------------------------------- first run
say "Running the first update now"
touch /var/log/sloptube-update.log
if /usr/local/bin/sloptube-update; then
  if [ -f "$APP_DIR/active" ]; then
    say "sloptube is running ($(cat "$APP_DIR/active")). Open https://$DOMAIN"
  else
    say "No image yet. It will start within 5 minutes of the first push to release."
  fi
else
  say "No image could be started yet. That is normal before the first push to release."
  echo "    Check later with: tail -n 50 /var/log/sloptube-update.log"
fi
