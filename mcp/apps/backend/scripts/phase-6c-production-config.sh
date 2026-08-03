#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${CORE_APP_NAME:?CORE_APP_NAME is required}"
: "${MCP_APP_NAME:?MCP_APP_NAME is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

CORE_API_BASE_URL="https://api.heroku.com/apps/${CORE_APP_NAME}"
MCP_API_BASE_URL="https://api.heroku.com/apps/${MCP_APP_NAME}"
HEROKU_ACCEPT="application/vnd.heroku+json; version=3"
workdir="$(mktemp -d)"
chmod 700 "$workdir"
core_config_file="$workdir/core-config.json"
mcp_config_file="$workdir/mcp-config.json"
core_original_payload="$workdir/core-original.json"
mcp_original_payload="$workdir/mcp-original.json"
core_desired_payload="$workdir/core-desired.json"
mcp_desired_payload="$workdir/mcp-desired.json"
core_subset_file="$workdir/core-subset.json"
mcp_subset_file="$workdir/mcp-subset.json"
core_changed="false"
mcp_changed="false"
mutation_started="false"
rollback_attempted="false"
rollback_healthy="not_needed"

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

mask() {
  local value="${1:-}"
  if [ -n "$value" ]; then
    echo "::add-mask::$value"
  fi
}

mask_database_parts() {
  local value="$1"
  local parts=""
  parts="$(DATABASE_URL="$value" node --input-type=module <<'NODE'
const parsed = new URL(process.env.DATABASE_URL);
const values = new Set([
  parsed.username,
  parsed.password,
  parsed.hostname,
  parsed.pathname.replace(/^\//, "")
]);
for (const raw of [...values]) {
  if (!raw) continue;
  console.log(raw);
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded && decoded !== raw) console.log(decoded);
  } catch {
    // Raw value is still masked.
  }
}
NODE
)"
  while IFS= read -r part; do
    mask "$part"
  done <<< "$parts"
}

mask "$HEROKU_API_KEY"

heroku_get() {
  local url="$1"
  curl --fail --silent --show-error \
    -H "Accept: $HEROKU_ACCEPT" \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "$url"
}

heroku_patch_file() {
  local url="$1"
  local payload_file="$2"
  curl --fail --silent --show-error \
    --request PATCH \
    -H "Accept: $HEROKU_ACCEPT" \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary "@$payload_file" \
    "$url/config-vars" >/dev/null
}

current_release() {
  local app="$1"
  heroku releases --json -a "$app" | jq -r '.[0].version // empty'
}

smoke_health() {
  local base_url="$1"
  local path="$2"
  local deadline=$((SECONDS + 180))
  local status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(
      curl --silent --show-error \
        --connect-timeout 5 \
        --max-time 10 \
        --output /dev/null \
        --write-out '%{http_code}' \
        "${base_url%/}$path" || true
    )"
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep 3
  done
  echo "Health smoke failed for ${path}; last_status=${status:-none}." >&2
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

generate_distinct_token() {
  local forbidden_one="${1:-}"
  local forbidden_two="${2:-}"
  local forbidden_three="${3:-}"
  local candidate=""
  while :; do
    candidate="$(openssl rand -hex 32)"
    if [ "$candidate" != "$forbidden_one" ] \
      && [ "$candidate" != "$forbidden_two" ] \
      && [ "$candidate" != "$forbidden_three" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
}

choose_shared_token() {
  local core_value="$1"
  local mcp_value="$2"
  local backend_one="$3"
  local backend_two="$4"
  local other_token="${5:-}"
  if [ -n "$core_value" ] \
    && [ "$core_value" = "$mcp_value" ] \
    && [ "$core_value" != "$backend_one" ] \
    && [ "$core_value" != "$backend_two" ] \
    && [ "$core_value" != "$other_token" ]; then
    printf '%s' "$core_value"
    return 0
  fi
  generate_distinct_token "$backend_one" "$backend_two" "$other_token"
}

restore_original_config() {
  rollback_attempted="true"
  heroku_patch_file "$CORE_API_BASE_URL" "$core_original_payload" || true
  heroku_patch_file "$MCP_API_BASE_URL" "$mcp_original_payload" || true
  if smoke_health "$core_url" /health/live \
    && smoke_health "$core_url" /health/ready \
    && smoke_health "$mcp_url" /health/live \
    && smoke_health "$mcp_url" /health/ready; then
    rollback_healthy="true"
  else
    rollback_healthy="false"
  fi
}

core_app_json="$(heroku_get "$CORE_API_BASE_URL")"
mcp_app_json="$(heroku_get "$MCP_API_BASE_URL")"
test "$(jq -r '.name // empty' <<<"$core_app_json")" = "$CORE_APP_NAME"
test "$(jq -r '.name // empty' <<<"$mcp_app_json")" = "$MCP_APP_NAME"
test "$CORE_APP_NAME" != "$MCP_APP_NAME"
core_url="$(jq -r '.web_url // empty' <<<"$core_app_json" | sed 's:/*$::')"
mcp_url="$(jq -r '.web_url // empty' <<<"$mcp_app_json" | sed 's:/*$::')"
test -n "$core_url"
test -n "$mcp_url"

heroku config -a "$CORE_APP_NAME" --json > "$core_config_file"
heroku config -a "$MCP_APP_NAME" --json > "$mcp_config_file"
chmod 600 "$core_config_file" "$mcp_config_file"

for name in DATABASE_URL BACKEND_API_TOKEN INSTALLATION_ID; do
  jq -e --arg name "$name" 'has($name) and (.[$name] | type == "string" and length > 0)' "$core_config_file" >/dev/null
  jq -e --arg name "$name" 'has($name) and (.[$name] | type == "string" and length > 0)' "$mcp_config_file" >/dev/null
done

core_database_url="$(jq -r '.DATABASE_URL' "$core_config_file")"
mcp_database_url="$(jq -r '.DATABASE_URL' "$mcp_config_file")"
core_backend_token="$(jq -r '.BACKEND_API_TOKEN' "$core_config_file")"
mcp_backend_token="$(jq -r '.BACKEND_API_TOKEN' "$mcp_config_file")"
installation_id="$(jq -r '.INSTALLATION_ID' "$core_config_file")"
mcp_installation_id="$(jq -r '.INSTALLATION_ID' "$mcp_config_file")"
for sensitive in "$core_database_url" "$mcp_database_url" "$core_backend_token" "$mcp_backend_token" "$installation_id"; do
  mask "$sensitive"
done
mask_database_parts "$core_database_url"
mask_database_parts "$mcp_database_url"
test "$installation_id" = "$mcp_installation_id"

DATABASE_URL="$core_database_url" MCP_DATABASE_URL="$mcp_database_url" node --input-type=module <<'NODE'
function target(value) {
  const parsed = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) throw new Error("invalid_database_url");
  return `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}/${decodeURIComponent(parsed.pathname.replace(/^\//, ""))}`;
}
if (target(process.env.DATABASE_URL) !== target(process.env.MCP_DATABASE_URL)) {
  throw new Error("core_and_mcp_database_targets_differ");
}
NODE

mapfile -t active_warehouses < <(
  PGCONNECT_TIMEOUT=10 psql "$core_database_url" -XAt -v ON_ERROR_STOP=1 \
    --set=installation_id="$installation_id" <<'SQL'
SELECT id::text
FROM shared.warehouses
WHERE installation_id = :'installation_id'
  AND is_active = true
ORDER BY code, id;
SQL
)
active_warehouse_count="${#active_warehouses[@]}"
if [ "$active_warehouse_count" -lt 1 ]; then
  echo "No active warehouse exists for the production installation." >&2
  exit 1
fi

configured_warehouse="$(jq -r '.CORE_SALES_DEFAULT_WAREHOUSE_ID // empty' "$mcp_config_file")"
warehouse_source="single_active"
if [ -n "$configured_warehouse" ]; then
  warehouse_source="existing_config"
  if ! printf '%s\n' "${active_warehouses[@]}" | grep -Fqx "$configured_warehouse"; then
    echo "Configured default warehouse is not active in the production installation." >&2
    exit 1
  fi
  warehouse_id="$configured_warehouse"
elif [ "$active_warehouse_count" -eq 1 ]; then
  warehouse_id="${active_warehouses[0]}"
else
  echo "Multiple active warehouses exist and no reviewed default is configured." >&2
  echo "ACTIVE_WAREHOUSE_COUNT=$active_warehouse_count" >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi
mask "$warehouse_id"

existing_core_sales_scope="$(jq -r '.MCP_SALES_WAREHOUSE_IDS // empty' "$core_config_file")"
if [ -n "$existing_core_sales_scope" ]; then
  IFS=',' read -r -a configured_core_warehouses <<< "$existing_core_sales_scope"
  for item in "${configured_core_warehouses[@]}"; do
    normalized="$(printf '%s' "$item" | xargs)"
    if [ -n "$normalized" ] && ! printf '%s\n' "${active_warehouses[@]}" | grep -Fqx "$normalized"; then
      echo "Core warehouse scope contains an inactive or unknown warehouse." >&2
      exit 1
    fi
  done
fi
core_sales_warehouse_ids="$(csv_union "$existing_core_sales_scope" "$warehouse_id")"

existing_core_onboarding="$(jq -r '.MCP_ONBOARDING_API_TOKEN // empty' "$core_config_file")"
existing_mcp_onboarding="$(jq -r '.CORE_ONBOARDING_API_TOKEN // empty' "$mcp_config_file")"
onboarding_token="$(choose_shared_token "$existing_core_onboarding" "$existing_mcp_onboarding" "$core_backend_token" "$mcp_backend_token")"
mask "$onboarding_token"
existing_core_sales="$(jq -r '.MCP_SALES_API_TOKEN // empty' "$core_config_file")"
existing_mcp_sales="$(jq -r '.CORE_SALES_API_TOKEN // empty' "$mcp_config_file")"
sales_token="$(choose_shared_token "$existing_core_sales" "$existing_mcp_sales" "$core_backend_token" "$mcp_backend_token" "$onboarding_token")"
mask "$sales_token"
test "$onboarding_token" != "$sales_token"

existing_permissions="$(jq -r '.MCP_SERVICE_PERMISSIONS // empty' "$mcp_config_file")"
existing_scopes="$(jq -r '.MCP_SERVICE_SCOPES // empty' "$mcp_config_file")"
service_permissions="$(csv_union "$existing_permissions" "mcp.sales-order.read,mcp.sales-order.create")"
service_scopes="$(csv_union "$existing_scopes" "mcp:warehouse:$warehouse_id")"

jq -n \
  --slurpfile current "$core_config_file" \
  '{
    MCP_ONBOARDING_API_TOKEN: ($current[0].MCP_ONBOARDING_API_TOKEN // null),
    MCP_ONBOARDING_ACTOR_ID: ($current[0].MCP_ONBOARDING_ACTOR_ID // null),
    MCP_SALES_API_TOKEN: ($current[0].MCP_SALES_API_TOKEN // null),
    MCP_SALES_ACTOR_ID: ($current[0].MCP_SALES_ACTOR_ID // null),
    MCP_SALES_WAREHOUSE_IDS: ($current[0].MCP_SALES_WAREHOUSE_IDS // null)
  }' > "$core_original_payload"

jq -n \
  --slurpfile current "$mcp_config_file" \
  '{
    CORE_ONBOARDING_API_BASE_URL: ($current[0].CORE_ONBOARDING_API_BASE_URL // null),
    CORE_ONBOARDING_API_TOKEN: ($current[0].CORE_ONBOARDING_API_TOKEN // null),
    CORE_ONBOARDING_TIMEOUT_MS: ($current[0].CORE_ONBOARDING_TIMEOUT_MS // null),
    CORE_SALES_API_BASE_URL: ($current[0].CORE_SALES_API_BASE_URL // null),
    CORE_SALES_API_TOKEN: ($current[0].CORE_SALES_API_TOKEN // null),
    CORE_SALES_DEFAULT_WAREHOUSE_ID: ($current[0].CORE_SALES_DEFAULT_WAREHOUSE_ID // null),
    CORE_SALES_TIMEOUT_MS: ($current[0].CORE_SALES_TIMEOUT_MS // null),
    MCP_SERVICE_PERMISSIONS: ($current[0].MCP_SERVICE_PERMISSIONS // null),
    MCP_SERVICE_SCOPES: ($current[0].MCP_SERVICE_SCOPES // null)
  }' > "$mcp_original_payload"

jq -n \
  --arg onboardingToken "$onboarding_token" \
  --arg salesToken "$sales_token" \
  --arg warehouseIds "$core_sales_warehouse_ids" \
  '{
    MCP_ONBOARDING_API_TOKEN: $onboardingToken,
    MCP_ONBOARDING_ACTOR_ID: "service:mcp-customer-onboarding",
    MCP_SALES_API_TOKEN: $salesToken,
    MCP_SALES_ACTOR_ID: "service:mcp-sales-order",
    MCP_SALES_WAREHOUSE_IDS: $warehouseIds
  }' > "$core_desired_payload"

jq -n \
  --arg coreUrl "$core_url" \
  --arg onboardingToken "$onboarding_token" \
  --arg salesToken "$sales_token" \
  --arg warehouseId "$warehouse_id" \
  --arg permissions "$service_permissions" \
  --arg scopes "$service_scopes" \
  '{
    CORE_ONBOARDING_API_BASE_URL: $coreUrl,
    CORE_ONBOARDING_API_TOKEN: $onboardingToken,
    CORE_ONBOARDING_TIMEOUT_MS: "15000",
    CORE_SALES_API_BASE_URL: $coreUrl,
    CORE_SALES_API_TOKEN: $salesToken,
    CORE_SALES_DEFAULT_WAREHOUSE_ID: $warehouseId,
    CORE_SALES_TIMEOUT_MS: "15000",
    MCP_SERVICE_PERMISSIONS: $permissions,
    MCP_SERVICE_SCOPES: $scopes
  }' > "$mcp_desired_payload"
chmod 600 "$core_original_payload" "$mcp_original_payload" "$core_desired_payload" "$mcp_desired_payload"

jq '{
  MCP_ONBOARDING_API_TOKEN,
  MCP_ONBOARDING_ACTOR_ID,
  MCP_SALES_API_TOKEN,
  MCP_SALES_ACTOR_ID,
  MCP_SALES_WAREHOUSE_IDS
}' "$core_config_file" > "$core_subset_file"
jq '{
  CORE_ONBOARDING_API_BASE_URL,
  CORE_ONBOARDING_API_TOKEN,
  CORE_ONBOARDING_TIMEOUT_MS,
  CORE_SALES_API_BASE_URL,
  CORE_SALES_API_TOKEN,
  CORE_SALES_DEFAULT_WAREHOUSE_ID,
  CORE_SALES_TIMEOUT_MS,
  MCP_SERVICE_PERMISSIONS,
  MCP_SERVICE_SCOPES
}' "$mcp_config_file" > "$mcp_subset_file"

core_release_before="$(current_release "$CORE_APP_NAME")"
mcp_release_before="$(current_release "$MCP_APP_NAME")"
test -n "$core_release_before"
test -n "$mcp_release_before"

mutation_started="true"
if ! diff -q <(jq -S . "$core_subset_file") <(jq -S . "$core_desired_payload") >/dev/null; then
  heroku_patch_file "$CORE_API_BASE_URL" "$core_desired_payload"
  core_changed="true"
fi
if ! diff -q <(jq -S . "$mcp_subset_file") <(jq -S . "$mcp_desired_payload") >/dev/null; then
  heroku_patch_file "$MCP_API_BASE_URL" "$mcp_desired_payload"
  mcp_changed="true"
fi

core_release_after="$(current_release "$CORE_APP_NAME")"
mcp_release_after="$(current_release "$MCP_APP_NAME")"

if ! smoke_health "$core_url" /health/live \
  || ! smoke_health "$core_url" /health/ready \
  || ! smoke_health "$mcp_url" /health/live \
  || ! smoke_health "$mcp_url" /health/ready; then
  restore_original_config
  {
    echo "PHASE_6C_CONFIG=failed"
    echo "ROLLBACK_ATTEMPTED=$rollback_attempted"
    echo "ROLLBACK_HEALTHY=$rollback_healthy"
  } >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi

core_verify_file="$workdir/core-verify.json"
mcp_verify_file="$workdir/mcp-verify.json"
heroku config -a "$CORE_APP_NAME" --json > "$core_verify_file"
heroku config -a "$MCP_APP_NAME" --json > "$mcp_verify_file"
chmod 600 "$core_verify_file" "$mcp_verify_file"

jq -e --arg token "$onboarding_token" '.MCP_ONBOARDING_API_TOKEN == $token' "$core_verify_file" >/dev/null
jq -e --arg token "$onboarding_token" '.CORE_ONBOARDING_API_TOKEN == $token' "$mcp_verify_file" >/dev/null
jq -e --arg token "$sales_token" '.MCP_SALES_API_TOKEN == $token' "$core_verify_file" >/dev/null
jq -e --arg token "$sales_token" '.CORE_SALES_API_TOKEN == $token' "$mcp_verify_file" >/dev/null
jq -e --arg warehouse "$warehouse_id" '.CORE_SALES_DEFAULT_WAREHOUSE_ID == $warehouse' "$mcp_verify_file" >/dev/null
jq -e --arg warehouse "$warehouse_id" '(.MCP_SALES_WAREHOUSE_IDS | split(",") | index($warehouse)) != null' "$core_verify_file" >/dev/null

{
  echo "PHASE_6C_CONFIG=success"
  echo "CORE_APP_NAME=$CORE_APP_NAME"
  echo "MCP_APP_NAME=$MCP_APP_NAME"
  echo "CORE_RELEASE_BEFORE=$core_release_before"
  echo "CORE_RELEASE_AFTER=$core_release_after"
  echo "MCP_RELEASE_BEFORE=$mcp_release_before"
  echo "MCP_RELEASE_AFTER=$mcp_release_after"
  echo "CORE_CONFIG_CHANGED=$core_changed"
  echo "MCP_CONFIG_CHANGED=$mcp_changed"
  echo "ACTIVE_WAREHOUSE_COUNT=$active_warehouse_count"
  echo "WAREHOUSE_SELECTION=$warehouse_source"
  echo "SERVICE_PERMISSION_COUNT=$(printf '%s' "$service_permissions" | tr ',' '\n' | awk 'NF' | wc -l | xargs)"
  echo "SERVICE_SCOPE_COUNT=$(printf '%s' "$service_scopes" | tr ',' '\n' | awk 'NF' | wc -l | xargs)"
  echo "CORE_HEALTH=success"
  echo "MCP_HEALTH=success"
  echo "ROLLBACK_ATTEMPTED=$rollback_attempted"
} >> "$GITHUB_STEP_SUMMARY"
