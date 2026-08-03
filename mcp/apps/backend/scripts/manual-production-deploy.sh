#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${HEROKU_DB_OWNER_APP_NAME:?HEROKU_DB_OWNER_APP_NAME is required}"
: "${HEROKU_FORBIDDEN_APP_NAME:?HEROKU_FORBIDDEN_APP_NAME is required}"
: "${HEROKU_REQUIRED_STACK:?HEROKU_REQUIRED_STACK is required}"
: "${HEROKU_REQUIRED_CONFIG_NAMES:?HEROKU_REQUIRED_CONFIG_NAMES is required}"
: "${MCP_RUNTIME_DATABASE_URL_FILE:?MCP_RUNTIME_DATABASE_URL_FILE is required}"
: "${MCP_MIGRATION_DATABASE_URL_FILE:?MCP_MIGRATION_DATABASE_URL_FILE is required}"
: "${MCP_DB_ROLE_FILE:?MCP_DB_ROLE_FILE is required}"
: "${POSTGRES_SERVICE_CONTAINER:?POSTGRES_SERVICE_CONTAINER is required}"
: "${DEPLOYED_SHA:?DEPLOYED_SHA is required}"

requested_action="${REQUESTED_ACTION:-deploy}"
requested_release_version="${REQUESTED_RELEASE_VERSION:-}"
maintenance_enabled="false"
app_url=""
production_backup_id=""
previous_active_release_version=""
previous_release_healthy="false"
active_release_version=""
credential_mode=""
least_privilege=""

for sensitive in "$HEROKU_API_KEY"; do
  echo "::add-mask::$sensitive"
done

cleanup() {
  if [ "$maintenance_enabled" = "true" ]; then
    heroku maintenance:off -a "$HEROKU_APP_NAME" >/dev/null 2>&1 || true
    maintenance_enabled="false"
  fi
  rm -f "$MCP_RUNTIME_DATABASE_URL_FILE" "$MCP_MIGRATION_DATABASE_URL_FILE" "$MCP_DB_ROLE_FILE"
}
trap cleanup EXIT

smoke_health() {
  local path="$1"
  local deadline=$((SECONDS + 180))
  local last_status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    last_status="$(
      curl --silent --show-error \
        --connect-timeout 5 \
        --max-time 10 \
        --output /dev/null \
        --write-out '%{http_code}' \
        "${app_url%/}$path" || true
    )"
    if [ "$last_status" = "200" ]; then
      return 0
    fi
    sleep 3
  done
  echo "health smoke failed for $path (last_status=${last_status:-none})" >&2
  return 1
}

refresh_release_version() {
  heroku releases --json -a "$HEROKU_APP_NAME" | jq -r '.[0].version // empty'
}

refresh_app_url() {
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.heroku+json; version=3' \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "https://api.heroku.com/apps/$HEROKU_APP_NAME" \
    | jq -r '.web_url // empty' \
    | sed 's:/*$::'
}

extract_completed_backup_id() {
  sed -nE 's/.*Backing up .* to (b[0-9]+)\.\.\. done.*/\1/p' | tail -n 1
}

write_summary() {
  {
    echo "HEROKU_APP_NAME=$HEROKU_APP_NAME"
    echo "HEROKU_APP_URL=$app_url"
    echo "HEROKU_RELEASE_VERSION=$active_release_version"
    echo "PRODUCTION_BACKUP_ID=$production_backup_id"
    echo "PREVIOUS_ACTIVE_RELEASE_VERSION=$previous_active_release_version"
    echo "PREVIOUS_RELEASE_HEALTHY=$previous_release_healthy"
    echo "DEPLOYED_SHA=$DEPLOYED_SHA"
    echo "MCP_OPERATION=$requested_action"
    echo "MCP_MIGRATION_CREDENTIAL_MODE=$credential_mode"
    echo "MCP_MIGRATION_LEAST_PRIVILEGE=$least_privilege"
  } >> "$GITHUB_STEP_SUMMARY"
}

run_production_migration_gate() {
  local capture_output=""
  capture_output="$(heroku pg:backups:capture DATABASE_URL -a "$HEROKU_DB_OWNER_APP_NAME" 2>&1)"
  printf '%s\n' "$capture_output"
  production_backup_id="$(printf '%s\n' "$capture_output" | tr -d '\r' | extract_completed_backup_id)"
  if [ -z "$production_backup_id" ]; then
    echo "Could not extract the completed Heroku backup ID from capture output." >&2
    exit 1
  fi
  heroku pg:backups:info "$production_backup_id" -a "$HEROKU_DB_OWNER_APP_NAME" >/dev/null

  heroku maintenance:on -a "$HEROKU_APP_NAME" >/dev/null
  maintenance_enabled="true"
  bash mcp/apps/backend/scripts/production-rollout-gate.sh
  heroku maintenance:off -a "$HEROKU_APP_NAME" >/dev/null
  maintenance_enabled="false"
}

test "$HEROKU_APP_NAME" = "hung-phat-mcp"
test "$HEROKU_DB_OWNER_APP_NAME" = "hung-phat"
test "$HEROKU_APP_NAME" != "$HEROKU_DB_OWNER_APP_NAME"
test "$HEROKU_APP_NAME" != "$HEROKU_FORBIDDEN_APP_NAME"

app_json="$(
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.heroku+json; version=3' \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "https://api.heroku.com/apps/$HEROKU_APP_NAME"
)"
test "$(jq -r '.name // empty' <<<"$app_json")" = "$HEROKU_APP_NAME"
app_url="$(jq -r '.web_url // empty' <<<"$app_json")"
app_url="${app_url%/}"
test -n "$app_url"

owner_app_json="$(
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.heroku+json; version=3' \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "https://api.heroku.com/apps/$HEROKU_DB_OWNER_APP_NAME"
)"
test "$(jq -r '.name // empty' <<<"$owner_app_json")" = "$HEROKU_DB_OWNER_APP_NAME"

test "$(heroku stack -a "$HEROKU_APP_NAME" | awk '/^\*/ {print $2; exit}')" = "$HEROKU_REQUIRED_STACK"

config_json="$(heroku config -a "$HEROKU_APP_NAME" --json)"
owner_config_json="$(heroku config -a "$HEROKU_DB_OWNER_APP_NAME" --json)"
required_vars=(${HEROKU_REQUIRED_CONFIG_NAMES//,/ })
for name in "${required_vars[@]}"; do
  if ! jq -e --arg name "$name" 'has($name) and (.[$name] | type == "string" and length > 0)' <<<"$config_json" >/dev/null; then
    echo "Required MCP backend config is absent or empty: $name" >&2
    exit 1
  fi
done
jq -e 'has("DATABASE_URL") and (.DATABASE_URL | type == "string" and length > 0)' <<<"$owner_config_json" >/dev/null

test "$(jq -r '.PERSISTENCE_PROVIDER // empty' <<<"$config_json")" = "postgresql"
legacy_runtime_enabled="$(jq -r '.MCP_LEGACY_RUNTIME_ENABLED // empty' <<<"$config_json" | tr '[:upper:]' '[:lower:]')"
case "$legacy_runtime_enabled" in
  false|0|no|off) ;;
  *)
    echo "MCP_LEGACY_RUNTIME_ENABLED must be false for production." >&2
    exit 1
    ;;
esac

runtime_database_url="$(jq -r '.DATABASE_URL' <<<"$config_json")"
migration_database_url="$(jq -r '.DATABASE_URL' <<<"$owner_config_json")"
mcp_db_role="$(jq -r '.MCP_DB_ROLE' <<<"$config_json")"
for sensitive in "$runtime_database_url" "$migration_database_url" "$mcp_db_role"; do
  test -n "$sensitive"
  echo "::add-mask::$sensitive"
done
umask 077
printf '%s' "$runtime_database_url" > "$MCP_RUNTIME_DATABASE_URL_FILE"
printf '%s' "$migration_database_url" > "$MCP_MIGRATION_DATABASE_URL_FILE"
printf '%s' "$mcp_db_role" > "$MCP_DB_ROLE_FILE"
chmod 600 "$MCP_RUNTIME_DATABASE_URL_FILE" "$MCP_MIGRATION_DATABASE_URL_FILE" "$MCP_DB_ROLE_FILE"

credential_context_json="$(
  DATABASE_URL="$runtime_database_url" \
  MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
  node --input-type=module <<'NODE'
import { resolveMigrationCredentialContext } from "./mcp/apps/backend/foundation/migrations/credential-safety.js";
const context = resolveMigrationCredentialContext({ ...process.env, NODE_ENV: "production" });
process.stdout.write(JSON.stringify({
  credentialMode: context.credentialMode,
  leastPrivilege: context.leastPrivilege
}));
NODE
)"
credential_mode="$(jq -r '.credentialMode' <<<"$credential_context_json")"
least_privilege="$(jq -r '.leastPrivilege | tostring' <<<"$credential_context_json")"
test -n "$credential_mode"
test "$least_privilege" = "true" -o "$least_privilege" = "false"

previous_active_release_version="$(refresh_release_version)"
test -n "$previous_active_release_version"
previous_release_healthy="true"
for path in /health/live /health/ready; do
  status="$(
    curl --silent --show-error \
      --connect-timeout 5 \
      --max-time 10 \
      --output /dev/null \
      --write-out '%{http_code}' \
      "${app_url%/}$path" || true
  )"
  if [ "$status" != "200" ]; then
    previous_release_healthy="false"
  fi
done

case "$requested_action" in
  rollback)
    test -n "$requested_release_version"
    heroku releases:rollback "$requested_release_version" -a "$HEROKU_APP_NAME"
    active_release_version="$(refresh_release_version)"
    app_url="$(refresh_app_url)"
    smoke_health /health/live
    smoke_health /health/ready
    write_summary
    ;;
  migrate)
    run_production_migration_gate
    active_release_version="$(refresh_release_version)"
    app_url="$(refresh_app_url)"
    smoke_health /health/live
    smoke_health /health/ready
    write_summary
    ;;
  deploy)
    run_production_migration_gate

    heroku container:login
    (
      cd mcp/apps/backend
      heroku container:push web -a "$HEROKU_APP_NAME"
    )
    heroku container:release web -a "$HEROKU_APP_NAME"
    active_release_version="$(refresh_release_version)"
    app_url="$(refresh_app_url)"

    if ! smoke_health /health/live || ! smoke_health /health/ready; then
      failed_release_version="$active_release_version"
      if [ "$previous_release_healthy" = "true" ]; then
        heroku releases:rollback "$previous_active_release_version" -a "$HEROKU_APP_NAME"
        active_release_version="$(refresh_release_version)"
        app_url="$(refresh_app_url)"
        smoke_health /health/live || true
        smoke_health /health/ready || true
        echo "Deployment $failed_release_version failed health checks and was rolled back to $previous_active_release_version." >&2
      else
        echo "Previous release was already unhealthy; automatic rollback is intentionally skipped." >&2
      fi
      write_summary
      exit 1
    fi
    write_summary
    ;;
  *)
    echo "Unknown action: $requested_action" >&2
    exit 1
    ;;
esac
