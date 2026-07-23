#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${MCP_RUNTIME_DIR:-/var/www/mcp-plan-backend}"
SERVICE_SOURCE="${RUNTIME_DIR}/ops/systemd/mcp-outlet-media-cleanup.service"
TIMER_SOURCE="${RUNTIME_DIR}/ops/systemd/mcp-outlet-media-cleanup.timer"
RUNNER="${RUNTIME_DIR}/ops/run-outlet-media-cleanup.sh"

for path in "$SERVICE_SOURCE" "$TIMER_SOURCE" "$RUNNER" "${RUNTIME_DIR}/.env"; do
  if [[ ! -e "$path" ]]; then
    echo "missing_required_path:${path}" >&2
    exit 1
  fi
done

chown root:root "$RUNNER"
chmod 0750 "$RUNNER"
install -o root -g root -m 0644 "$SERVICE_SOURCE" /etc/systemd/system/mcp-outlet-media-cleanup.service
install -o root -g root -m 0644 "$TIMER_SOURCE" /etc/systemd/system/mcp-outlet-media-cleanup.timer

systemctl daemon-reload
systemctl enable --now mcp-outlet-media-cleanup.timer
systemctl start mcp-outlet-media-cleanup.service
systemctl --no-pager --full status mcp-outlet-media-cleanup.timer
