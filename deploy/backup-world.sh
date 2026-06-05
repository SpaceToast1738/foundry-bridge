#!/usr/bin/env bash
# Sample backup script for the `backup_world` MCP tool.
#
# Point the gateway's FOUNDRY_BACKUP_SCRIPT env var at this file (or your own).
# It receives at most ONE argument — a sanitized label (alphanumerics/-/_) — and
# MUST print a single JSON object on stdout, e.g. {"path":…,"bytes":…}.
#
# This tars the LIVE Foundry data: a good-enough pre-op snapshot, NOT
# transactionally perfect (for a canonical backup, quiesce the stack first —
# e.g. `docker compose stop foundry`).
#
# Env (all optional):
#   FOUNDRY_DATA_DIR    What to archive. Default /opt/foundry/data (the WHOLE
#                       user-data tree: every world + modules + systems + config
#                       — a complete, self-sufficient restore, but large). For a
#                       lean, fast pre-edit snapshot point this at a single world
#                       dir instead, e.g. /opt/foundry/data/Data/worlds/<id>.
#   FOUNDRY_BACKUP_DIR  Where archives go. Default /opt/foundry/backups. Must be
#                       writable by the gateway service user (note: the gateway
#                       unit runs ProtectSystem=strict, so this should live under
#                       a ReadWritePaths entry, e.g. /var/lib/foundry-bridge/backups).
#   FOUNDRY_BACKUP_KEEP Retention: keep the newest N archives in BACKUP_DIR and
#                       delete older ones. Default 7. Set 0 to disable pruning.
set -euo pipefail

DATA_DIR="${FOUNDRY_DATA_DIR:-/opt/foundry/data}"
BACKUP_DIR="${FOUNDRY_BACKUP_DIR:-/opt/foundry/backups}"
KEEP="${FOUNDRY_BACKUP_KEEP:-7}"
LABEL="${1:-}"

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y-%m-%d-%H%M%S)"
name="foundry-backup-${ts}${LABEL:+-$LABEL}.tar.gz"
out="$BACKUP_DIR/$name"

tar czf "$out" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
bytes="$(stat -c%s "$out")"

# Retention: keep the newest $KEEP archives, prune the rest. 0 disables.
# Process substitution (not a pipe) so $pruned survives in this shell.
pruned=0
if [ "${KEEP:-0}" -gt 0 ]; then
  while IFS= read -r old; do
    [ -n "$old" ] && rm -f -- "$old" && pruned=$((pruned + 1))
  done < <(ls -1t "$BACKUP_DIR"/foundry-backup-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
fi

printf '{"path":"%s","bytes":%s,"kept":%s,"pruned":%s,"warning":"live snapshot; not transactionally guaranteed"}\n' \
  "$out" "$bytes" "$KEEP" "$pruned"
