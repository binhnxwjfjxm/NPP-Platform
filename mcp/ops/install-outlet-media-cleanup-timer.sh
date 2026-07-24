#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${MCP_RUNTIME_DIR:-/var/www/mcp-plan-backend}"
SERVICE_SOURCE="${RUNTIME_DIR}/ops/systemd/mcp-outlet-media-cleanup.service"
TIMER_SOURCE="${RUNTIME_DIR}/ops/systemd/mcp-outlet-media-cleanup.timer"
RUNNER="${RUNTIME_DIR}/ops/run-outlet-media-cleanup.sh"

if [[ "$RUNTIME_DIR" != /* ]]; then
  echo "runtime_dir_must_be_absolute:${RUNTIME_DIR}" >&2
  exit 1
fi

for path in "$SERVICE_SOURCE" "$TIMER_SOURCE" "$RUNNER" "${RUNTIME_DIR}/.env"; do
  if [[ ! -e "$path" ]]; then
    echo "missing_required_path:${path}" >&2
    exit 1
  fi
done

SERVICE_RENDERED="$(mktemp)"
trap 'rm -f "$SERVICE_RENDERED"' EXIT

service_template="$(cat "$SERVICE_SOURCE")"
if [[ "$service_template" != *'@MCP_RUNTIME_DIR@'* ]]; then
  echo "cleanup_service_runtime_placeholder_missing" >&2
  exit 1
fi
service_rendered="${service_template//@MCP_RUNTIME_DIR@/$RUNTIME_DIR}"
if [[ "$service_rendered" == *'@MCP_RUNTIME_DIR@'* ]]; then
  echo "cleanup_service_runtime_placeholder_unresolved" >&2
  exit 1
fi
printf '%s\n' "$service_rendered" > "$SERVICE_RENDERED"

chown root:root "$RUNNER"
chmod 0750 "$RUNNER"
install -o root -g root -m 0644 "$SERVICE_RENDERED" /etc/systemd/system/mcp-outlet-media-cleanup.service
install -o root -g root -m 0644 "$TIMER_SOURCE" /etc/systemd/system/mcp-outlet-media-cleanup.timer

systemctl daemon-reload
systemctl enable --now mcp-outlet-media-cleanup.timer
systemctl start mcp-outlet-media-cleanup.service
systemctl --no-pager --full status mcp-outlet-media-cleanup.timer
