#!/usr/bin/env bash
# One-command VPS redeploy for foundry-bridge.
#
# Pulls latest, rebuilds, verifies the module bundle is complete, copies ALL
# THREE module files (main.js, main.js.map, module.json) into the Foundry
# modules dir — copying module.json too fixes the "stale 0.x version" foot-gun
# where only main.js was copied — then restarts both services.
#
# Usage (on the VPS, from the repo root):
#   MODULE_DIR=/opt/foundry/data/Data/modules/foundry-bridge sudo -E ./scripts/redeploy.sh
#
# Env:
#   MODULE_DIR   Target Foundry module dir (required)
#   SERVICES     Space-separated systemd units to restart
#                (default: "foundry-bridge-gateway foundry-bridge-browser")
set -euo pipefail

MODULE_DIR="${MODULE_DIR:?set MODULE_DIR to the Foundry modules/foundry-bridge dir}"
SERVICES="${SERVICES:-foundry-bridge-gateway foundry-bridge-browser}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[redeploy] git pull"
git pull --ff-only

echo "[redeploy] install + build + bundle (+ check-dist)"
npm ci
npm run dist   # runs scripts/check-dist.mjs; aborts on an incomplete/stale bundle

dist="$repo_root/packages/foundry-module/dist"
echo "[redeploy] copying module → $MODULE_DIR"
install -d "$MODULE_DIR"
cp "$dist/main.js" "$dist/main.js.map" "$dist/module.json" "$MODULE_DIR/"

echo "[redeploy] restarting: $SERVICES"
systemctl restart $SERVICES

echo "[redeploy] done. Verify with: get_status (expect relayConnected:true) or"
echo "           journalctl -u foundry-bridge-browser -n 20 --no-pager"
