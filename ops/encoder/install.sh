#!/usr/bin/env bash
# sloptube encoder box installer.
#
# Run once, as root, on a fresh Ubuntu 24.04 server:
#   bash install.sh
#
# Before running it, create /opt/sloptube-encoder/.env (see ops/encoder/README.md)
# with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the four R2_ settings.
#
# What it does:
#   1. Installs Docker
#   2. Writes /opt/sloptube-encoder/docker-compose.yml and the work and state folders
#   3. Installs the sloptube-encoder systemd unit (starts the worker on boot)
#   4. Installs /usr/local/bin/sloptube-encoder-update and a systemd timer that
#      runs it every 5 minutes: pull ghcr.io/myfilehero/sloptube-encoder:latest
#      and restart the worker on a new image, but never in the middle of an encode
#   5. Sets up log rotation for the update log (the worker's own log is rotated
#      by Docker: 5 files of 10 MB)
#   6. Runs the first update right away
#
# Safe to run again: it just rewrites the same files.

set -euo pipefail

APP_DIR=/opt/sloptube-encoder
ENV_FILE=$APP_DIR/.env
IMAGE=ghcr.io/myfilehero/sloptube-encoder:latest

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (try: sudo bash install.sh)"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. Create it first, see ops/encoder/README.md"

for name in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  value=$(grep -E "^$name=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' \r')
  [ -n "$value" ] || die "$name= is not set in $ENV_FILE"
done
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already installed"
fi
systemctl enable --now docker

# ---------------------------------------------------------------- folders and compose file
say "Writing $APP_DIR/docker-compose.yml"
# The worker runs as the node user (uid 1000) inside the container.
mkdir -p "$APP_DIR/work" "$APP_DIR/state"
chown 1000:1000 "$APP_DIR/work" "$APP_DIR/state"
# The container's host name is the worker's name unless WORKER_NAME is set. It
# must stay the same across restarts (a restarted worker gives back the job it
# left running) and differ between boxes, so it is this server's name.
BOX_NAME=$(hostname -s | tr -cd 'A-Za-z0-9.-')
cat > "$APP_DIR/docker-compose.yml" <<YAML
# Written by install.sh. Same as ops/encoder/docker-compose.yml in the repo,
# with this server's name as the container's host name.
services:
  encoder:
    image: ghcr.io/myfilehero/sloptube-encoder:\${TAG:-latest}
    container_name: sloptube-encoder
    hostname: ${BOX_NAME:-encoder}
    restart: unless-stopped
    env_file: /opt/sloptube-encoder/.env
    volumes:
      - /opt/sloptube-encoder/work:/work
      - /opt/sloptube-encoder/state:/state
    stop_grace_period: 30s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
YAML

# ---------------------------------------------------------------- systemd unit
say "Installing the sloptube-encoder service"
cat > /etc/systemd/system/sloptube-encoder.service <<'UNIT'
[Unit]
Description=sloptube encoder worker (Docker compose)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/sloptube-encoder
ExecStart=/usr/bin/docker compose -p sloptube-encoder -f /opt/sloptube-encoder/docker-compose.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -p sloptube-encoder -f /opt/sloptube-encoder/docker-compose.yml down
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
UNIT

# ---------------------------------------------------------------- update script
say "Installing /usr/local/bin/sloptube-encoder-update"
cat > /usr/local/bin/sloptube-encoder-update <<'UPDATE'
#!/usr/bin/env bash
# Pulls the newest encoder image and restarts the worker on it.
# While an encode is running (the worker keeps a busy marker in the state
# folder) the restart waits for the next run, so no encode is cut off.
# Log: /var/log/sloptube-encoder-update.log
set -uo pipefail

APP_DIR=/opt/sloptube-encoder
IMAGE=ghcr.io/myfilehero/sloptube-encoder:latest
BUSY=$APP_DIR/state/busy
LOG=/var/log/sloptube-encoder-update.log
# A marker older than this belongs to a crashed worker: the job limit is 2 hours.
BUSY_MAX_MIN=140

exec >>"$LOG" 2>&1
exec 9>/run/sloptube-encoder-update.lock
flock -n 9 || { echo "$(date -Is) another update is running, skipping"; exit 0; }

log() { echo "$(date -Is) $*"; }
compose() { docker compose -p sloptube-encoder -f "$APP_DIR/docker-compose.yml" "$@"; }

running_image=$(docker inspect -f '{{.Image}}' sloptube-encoder 2>/dev/null || true)

if ! docker pull -q "$IMAGE" >/dev/null; then
  log "pull failed (is the package public, or did you run docker login ghcr.io?)"
  exit 1
fi
latest=$(docker image inspect -f '{{.Id}}' "$IMAGE")
is_running=$(docker inspect -f '{{.State.Running}}' sloptube-encoder 2>/dev/null || echo false)

if [ "$running_image" = "$latest" ] && [ "$is_running" = true ]; then
  exit 0  # nothing new, quiet exit
fi

if [ "$is_running" = true ] && [ -f "$BUSY" ] && [ -n "$(find "$BUSY" -mmin -"$BUSY_MAX_MIN" 2>/dev/null)" ]; then
  log "new image ${latest:7:12}, but job $(head -c 36 "$BUSY") is encoding. Trying again in 5 minutes."
  exit 0
fi

log "starting the worker on image ${latest:7:12} (was ${running_image:7:12})"
if ! compose up -d --remove-orphans; then
  log "docker compose up failed"
  exit 1
fi
sleep 5
log "worker: $(docker inspect -f '{{.State.Status}}' sloptube-encoder 2>/dev/null || echo missing). Last log lines:"
docker logs --tail 5 sloptube-encoder 2>&1 | sed 's/^/    /'

docker image prune -f >/dev/null
log "done"
UPDATE
chmod 755 /usr/local/bin/sloptube-encoder-update

# ---------------------------------------------------------------- systemd timer
say "Installing the sloptube-encoder-update timer (every 5 minutes)"
cat > /etc/systemd/system/sloptube-encoder-update.service <<'UNIT'
[Unit]
Description=Pull the newest sloptube encoder image and restart the worker on it
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/sloptube-encoder-update
UNIT

cat > /etc/systemd/system/sloptube-encoder-update.timer <<'UNIT'
[Unit]
Description=Run sloptube-encoder-update every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

# ---------------------------------------------------------------- log rotation
cat > /etc/logrotate.d/sloptube-encoder-update <<'ROTATE'
/var/log/sloptube-encoder-update.log {
	weekly
	rotate 8
	compress
	missingok
	notifempty
}
ROTATE

systemctl daemon-reload
systemctl enable sloptube-encoder.service
systemctl enable --now sloptube-encoder-update.timer

# ---------------------------------------------------------------- first run
say "Running the first update now"
touch /var/log/sloptube-encoder-update.log
if /usr/local/bin/sloptube-encoder-update && docker inspect sloptube-encoder >/dev/null 2>&1; then
  systemctl start sloptube-encoder.service
  say "The encoder is running. Watch it with: docker logs -f sloptube-encoder"
else
  say "No image could be started yet. That is normal before the first push to release."
  echo "    Check later with: tail -n 50 /var/log/sloptube-encoder-update.log"
fi
