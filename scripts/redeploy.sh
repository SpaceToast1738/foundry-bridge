#!/usr/bin/env bash
# One-command VPS redeploy for foundry-bridge.
#
# Pulls latest, rebuilds, verifies the module bundle is complete, copies ALL
# THREE module files (main.js, main.js.map, module.json) into the Foundry
# modules dir — copying module.json too fixes the "stale 0.x version" foot-gun
# where only main.js was copied — then restarts both services.
#
# Usage (on the VPS, from the repo root):
#   sudo ./scripts/redeploy.sh
# MODULE_DIR (and the others) are read from /etc/foundry-bridge/env if set there,
# so a plain `sudo ./scripts/redeploy.sh` works once the env file is populated.
#
# Env (from /etc/foundry-bridge/env or the shell):
#   MODULE_DIR    Target Foundry module dir (required)
#   SERVICE_USER  Owner of the repo + services (default: foundry-bridge). The
#                 build runs as root (sudo), so the repo is chowned back to this
#                 user afterwards to keep node_modules/build readable by the
#                 services. Set to "" to skip the chown.
#   SERVICES      Space-separated systemd units to restart
#                 (default: "foundry-bridge-gateway foundry-bridge-browser")
#   FOUNDRY_BRIDGE_GATEWAY_PORT  Gateway HTTP port for the post-deploy health
#                 gate (default 31415).
set -euo pipefail

# Pull deploy config (MODULE_DIR, gateway port, …) from the env file so callers
# don't have to pass MODULE_DIR by hand. Shell-supplied vars still win.
ENV_FILE="${FOUNDRY_BRIDGE_ENV_FILE:-/etc/foundry-bridge/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

MODULE_DIR="${MODULE_DIR:?set MODULE_DIR (in /etc/foundry-bridge/env or the shell) to the Foundry modules/foundry-bridge dir}"
SERVICE_USER="${SERVICE_USER-foundry-bridge}"
SERVICES="${SERVICES:-foundry-bridge-gateway foundry-bridge-browser}"
GATEWAY_PORT="${FOUNDRY_BRIDGE_GATEWAY_PORT:-31415}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[redeploy] git pull"
git pull --ff-only

echo "[redeploy] install + build + bundle (+ check-dist)"
npm ci
npm run dist   # runs scripts/check-dist.mjs; aborts on an incomplete/stale bundle

if [ -n "$SERVICE_USER" ]; then
  echo "[redeploy] restoring ownership → $SERVICE_USER"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$repo_root"
fi

dist="$repo_root/packages/foundry-module/dist"
echo "[redeploy] copying module → $MODULE_DIR"
install -d "$MODULE_DIR"
cp "$dist/main.js" "$dist/main.js.map" "$dist/module.json" "$MODULE_DIR/"

echo "[redeploy] restarting: $SERVICES"
systemctl restart $SERVICES

# --- Health gate -----------------------------------------------------------
# The gateway is unauthenticated on loopback (Caddy adds auth in front), so we
# can probe it directly. Hard-fail if /healthz never comes up; warn (don't fail)
# on module reconnect timing, since the headless browser rejoin is async.
echo "[redeploy] waiting for gateway /healthz on :$GATEWAY_PORT"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/healthz" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" != 1 ]; then
  echo "[redeploy] ERROR: gateway did not become healthy within 30s" >&2
  echo "           check: journalctl -u foundry-bridge-gateway -n 40 --no-pager" >&2
  exit 1
fi
echo "[redeploy] gateway healthy"

shipped="$(node -e "process.stdout.write(String(require('$repo_root/packages/foundry-module/dist/module.json').version))")"
echo "[redeploy] confirming module reconnect + code version $shipped (up to 90s)"
status_json=""
for _ in $(seq 1 18); do
  status_json="$(FOUNDRY_BRIDGE_GATEWAY_PORT="$GATEWAY_PORT" node "$repo_root/scripts/gateway-status.mjs" 2>/dev/null || true)"
  if printf '%s' "$status_json" | grep -q '"moduleConnected":true'; then
    break
  fi
  sleep 5
done
if printf '%s' "$status_json" | grep -q '"moduleConnected":true'; then
  running="$(printf '%s' "$status_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).moduleCodeVersion||'?'))}catch{process.stdout.write('?')}})")"
  if [ "$running" = "$shipped" ]; then
    echo "[redeploy] OK — module reconnected, running $running"
  else
    echo "[redeploy] WARNING: module reconnected but running '$running', shipped '$shipped'." >&2
    echo "           Foundry may be serving a cached bundle — restart the Foundry container to bust it." >&2
  fi
else
  echo "[redeploy] WARNING: module did not reconnect within 90s." >&2
  echo "           check: journalctl -u foundry-bridge-browser -n 20 --no-pager" >&2
fi
echo "[redeploy] done."
