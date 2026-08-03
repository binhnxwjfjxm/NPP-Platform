#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${MCP_APP_NAME:?MCP_APP_NAME is required}"
: "${MCP_FRONTEND_URL:?MCP_FRONTEND_URL is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

HEROKU_ACCEPT="application/vnd.heroku+json; version=3"
APP_API_BASE_URL="https://api.heroku.com/apps/${MCP_APP_NAME}"
PERMISSIONS_MANIFEST="${PERMISSIONS_MANIFEST:-mcp/apps/backend/config/mcp-service-permissions.json}"
workdir="$(mktemp -d)"
chmod 700 "$workdir"
config_before_file="$workdir/config-before.json"
config_after_file="$workdir/config-after.json"
original_payload_file="$workdir/original-payload.json"
desired_payload_file="$workdir/desired-payload.json"
mutation_started="false"
rollback_attempted="false"
rollback_healthy="not_needed"

mask() {
  local value="${1:-}"
  if [ -n "$value" ]; then
    echo "::add-mask::$value"
  fi
}

mask "$HEROKU_API_KEY"

heroku_get() {
  local url="$1"
  curl --fail --silent --show-error \
    -H "Accept: $HEROKU_ACCEPT" \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "$url"
}

heroku_patch() {
  local payload_file="$1"
  curl --fail --silent --show-error \
    --request PATCH \
    -H "Accept: $HEROKU_ACCEPT" \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary "@$payload_file" \
    "$APP_API_BASE_URL/config-vars" >/dev/null
}

current_release() {
  heroku_get "$APP_API_BASE_URL/releases" | jq -r '.[0].version // empty'
}

smoke_health() {
  local base_url="$1"
  local path="$2"
  local deadline=$((SECONDS + 180))
  local status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(curl --silent --show-error \
      --connect-timeout 5 \
      --max-time 10 \
      --output /dev/null \
      --write-out '%{http_code}' \
      "${base_url%/}${path}" || true)"
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep 3
  done
  echo "MCP health check failed at ${path}; last_status=${status:-none}." >&2
  return 1
}

csv_union() {
  local left="${1:-}"
  local right="${2:-}"
  printf '%s\n%s\n' "$left" "$right" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | tr '[:upper:]' '[:lower:]' \
    | awk 'NF && !seen[$0]++' \
    | paste -sd, -
}

contains_permission() {
  local csv="$1"
  local expected="$2"
  printf '%s' "$csv" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | grep -Fqx "$expected"
}

safe_negative_post() {
  local path="$1"
  local status=""
  status="$(curl --silent --show-error \
    --connect-timeout 10 \
    --max-time 30 \
    --output /dev/null \
    --write-out '%{http_code}' \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/json' \
    --data '{}' \
    "${MCP_FRONTEND_URL%/}${path}" || true)"
  if [ "$status" != "400" ]; then
    echo "Expected safe validation status 400 from ${path}; received ${status:-none}." >&2
    return 1
  fi
}

restore_original_config() {
  rollback_attempted="true"
  heroku_patch "$original_payload_file" || true
  if smoke_health "$mcp_url" /health/live && smoke_health "$mcp_url" /health/ready; then
    rollback_healthy="true"
  else
    rollback_healthy="false"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] \
    && [ "$mutation_started" = "true" ] \
    && [ "$rollback_attempted" != "true" ]; then
    restore_original_config || true
  fi
  rm -rf "$workdir"
  exit "$status"
}
trap cleanup EXIT

jq -e '
  .version == 1
  and (.userFacingWritePermissions | type == "array" and length > 0)
  and (.integrationPermissions | type == "array" and length > 0)
  and ([.userFacingWritePermissions[], .integrationPermissions[]]
    | all(type == "string" and test("^mcp\\.[a-z0-9][a-z0-9._:-]{1,126}$")))
  and ([.userFacingWritePermissions[], .integrationPermissions[]]
    | all(. != "mcp.*" and endswith(".*") | not))
' "$PERMISSIONS_MANIFEST" >/dev/null

mapfile -t required_permissions < <(
  jq -r '[.userFacingWritePermissions[], .integrationPermissions[]] | unique[]' "$PERMISSIONS_MANIFEST"
)
if [ "${#required_permissions[@]}" -lt 1 ]; then
  echo "The MCP service permission manifest is empty." >&2
  exit 1
fi
required_csv="$(IFS=,; printf '%s' "${required_permissions[*]}")"

app_json="$(heroku_get "$APP_API_BASE_URL")"
test "$(jq -r '.name // empty' <<<"$app_json")" = "$MCP_APP_NAME"
mcp_url="$(jq -r '.web_url // empty' <<<"$app_json" | sed 's:/*$::')"
test -n "$mcp_url"

heroku_get "$APP_API_BASE_URL/config-vars" > "$config_before_file"
chmod 600 "$config_before_file"
original_present="$(jq 'has("MCP_SERVICE_PERMISSIONS")' "$config_before_file")"
original_permissions="$(jq -r '.MCP_SERVICE_PERMISSIONS // empty' "$config_before_file")"
desired_permissions="$(csv_union "$original_permissions" "$required_csv")"

if [ "$original_present" = "true" ]; then
  jq -n --arg value "$original_permissions" '{MCP_SERVICE_PERMISSIONS: $value}' > "$original_payload_file"
else
  jq -n '{MCP_SERVICE_PERMISSIONS: null}' > "$original_payload_file"
fi
jq -n --arg value "$desired_permissions" '{MCP_SERVICE_PERMISSIONS: $value}' > "$desired_payload_file"
chmod 600 "$original_payload_file" "$desired_payload_file"

release_before="$(current_release)"
test -n "$release_before"
config_changed="false"
mutation_started="true"
if [ "$desired_permissions" != "$original_permissions" ]; then
  heroku_patch "$desired_payload_file"
  config_changed="true"
fi

if ! smoke_health "$mcp_url" /health/live || ! smoke_health "$mcp_url" /health/ready; then
  restore_original_config
  {
    echo "MCP_WRITE_PERMISSION_REPAIR=failed"
    echo "ROLLBACK_ATTEMPTED=$rollback_attempted"
    echo "ROLLBACK_HEALTHY=$rollback_healthy"
  } >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi

heroku_get "$APP_API_BASE_URL/config-vars" > "$config_after_file"
chmod 600 "$config_after_file"
verified_permissions="$(jq -r '.MCP_SERVICE_PERMISSIONS // empty' "$config_after_file")"
for permission in "${required_permissions[@]}"; do
  if ! contains_permission "$verified_permissions" "$permission"; then
    echo "Required MCP permission is still missing after reconciliation: $permission" >&2
    exit 1
  fi
done

safe_negative_post /api/routes
safe_negative_post /api/mcp-report-settings

release_after="$(current_release)"
test -n "$release_after"
permission_count="$(printf '%s' "$verified_permissions" | tr ',' '\n' | awk 'NF' | wc -l | xargs)"

{
  echo "MCP_WRITE_PERMISSION_REPAIR=success"
  echo "MCP_APP_NAME=$MCP_APP_NAME"
  echo "CONFIG_CHANGED=$config_changed"
  echo "RELEASE_BEFORE=$release_before"
  echo "RELEASE_AFTER=$release_after"
  echo "REQUIRED_PERMISSION_COUNT=${#required_permissions[@]}"
  echo "SERVICE_PERMISSION_COUNT=$permission_count"
  echo "MCP_HEALTH=success"
  echo "SAFE_ROUTE_VALIDATION=400"
  echo "SAFE_REPORT_SETTING_VALIDATION=400"
  echo "ROLLBACK_ATTEMPTED=$rollback_attempted"
} >> "$GITHUB_STEP_SUMMARY"
