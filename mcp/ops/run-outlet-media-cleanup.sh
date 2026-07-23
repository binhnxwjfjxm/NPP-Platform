#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${MCP_BACKEND_ENV_FILE:-/var/www/mcp-plan-backend/.env}"
if [[ ! -r "$ENV_FILE" ]]; then
  echo "outlet_media_cleanup_env_missing" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${BACKEND_API_TOKEN:?missing BACKEND_API_TOKEN}"
PORT="${PORT:-3001}"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

status="$(curl --silent --show-error \
  --output "$response_file" \
  --write-out '%{http_code}' \
  --request POST \
  --header "X-Backend-Token: ${BACKEND_API_TOKEN}" \
  --header "X-Actor-Id: service:mcp-plan:outlet-media-cleanup" \
  --header "X-Actor-Type: service" \
  --header "X-Actor-Authentication: backend-token" \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --data '{"pendingAgeHours":24,"retryAgeMinutes":15,"limit":100}' \
  "http://127.0.0.1:${PORT}/api/internal/outlet-media/cleanup")"

if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
  echo "outlet_media_cleanup_failed status=${status}" >&2
  cat "$response_file" >&2
  exit 1
fi

node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const data = payload && payload.data ? payload.data : payload;
  console.log(JSON.stringify({
    claimedMediaCount: Number(data.claimedCount || 0),
    deletedMediaCount: Number(data.deletedCount || 0),
    failedMediaCount: Number(data.failedCount || 0),
    claimedDeleteJobCount: Number(data.claimedDeleteJobCount || 0),
    completedDeleteJobCount: Number(data.completedDeleteJobCount || 0),
    failedDeleteJobCount: Number(data.failedDeleteJobCount || 0)
  }));
' "$response_file"
