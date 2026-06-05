#!/usr/bin/env bash
# Sample backup script for the `backup_world` MCP tool.
#
# Point the gateway's FOUNDRY_BACKUP_SCRIPT env var at this file (or your own).
# It receives at most ONE argument — a sanitized label (alphanumerics/-/_) — and
# MUST print a single JSON object on stdout, e.g. {"path":…,"bytes":…}.
#
# Adjust DATA_DIR / BACKUP_DIR to your install. This tars the LIVE world data:
# a good-enough pre-op snapshot, NOT transactionally perfect (for a canonical
# backup, quiesce the stack — e.g. `docker compose stop foundry` — first).
set -euo pipefail

DATA_DIR="${FOUNDRY_DATA_DIR:-/opt/foundry/data}"
BACKUP_DIR="${FOUNDRY_BACKUP_DIR:-/opt/foundry/backups}"
LABEL="${1:-}"

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y-%m-%d-%H%M%S)"
name="foundry-backup-${ts}${LABEL:+-$LABEL}.tar.gz"
out="$BACKUP_DIR/$name"

tar czf "$out" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
bytes="$(stat -c%s "$out")"

printf '{"path":"%s","bytes":%s,"warning":"live snapshot; not transactionally guaranteed"}\n' "$out" "$bytes"
