#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${HEROKU_DB_OWNER_APP_NAME:?HEROKU_DB_OWNER_APP_NAME is required}"
: "${HEROKU_FORBIDDEN_APP_NAME:?HEROKU_FORBIDDEN_APP_NAME is required}"
: "${HEROKU_REQUIRED_STACK:?HEROKU_REQUIRED_STACK is required}"
: "${HEROKU_REQUIRED_CONFIG_NAMES:?HEROKU_REQUIRED_CONFIG_NAMES is required}"
: "${MCP_MIGRATION_CREDENTIAL_MODE:?MCP_MIGRATION_CREDENTIAL_MODE is required}"
: "${MCP_AUDIT_EVIDENCE_FILE:?MCP_AUDIT_EVIDENCE_FILE is required}"
: "${AUDITED_MAIN_SHA:?AUDITED_MAIN_SHA is required}"

HEROKU_ACCEPT='application/vnd.heroku+json; version=3'
workdir="$(mktemp -d)"
chmod 700 "$workdir"
app_file="$workdir/mcp-app.json"
owner_app_file="$workdir/core-app.json"
mcp_config_file="$workdir/mcp-config.json"
owner_config_file="$workdir/core-config.json"
owner_addons_file="$workdir/core-addons.json"
mcp_attachments_file="$workdir/mcp-attachments.json"
release_file="$workdir/releases.json"

cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "::add-mask::$HEROKU_API_KEY"

api_get() {
  local path="$1"
  curl --fail --silent --show-error \
    -H "Accept: $HEROKU_ACCEPT" \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "https://api.heroku.com${path}"
}

health_status() {
  local base_url="$1"
  local path="$2"
  curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 10 \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${base_url%/}${path}" || true
}

test "$HEROKU_APP_NAME" = "hung-phat-mcp"
test "$HEROKU_DB_OWNER_APP_NAME" = "hung-phat"
test "$HEROKU_APP_NAME" != "$HEROKU_DB_OWNER_APP_NAME"
test "$HEROKU_APP_NAME" != "$HEROKU_FORBIDDEN_APP_NAME"

api_get "/apps/$HEROKU_APP_NAME" > "$app_file"
api_get "/apps/$HEROKU_DB_OWNER_APP_NAME" > "$owner_app_file"
api_get "/apps/$HEROKU_APP_NAME/config-vars" > "$mcp_config_file"
api_get "/apps/$HEROKU_DB_OWNER_APP_NAME/config-vars" > "$owner_config_file"
api_get "/apps/$HEROKU_DB_OWNER_APP_NAME/addons" > "$owner_addons_file"
api_get "/apps/$HEROKU_APP_NAME/addon-attachments" > "$mcp_attachments_file"
api_get "/apps/$HEROKU_APP_NAME/releases" > "$release_file"
chmod 600 "$mcp_config_file" "$owner_config_file"

test "$(jq -r '.name // empty' "$app_file")" = "$HEROKU_APP_NAME"
test "$(jq -r '.name // empty' "$owner_app_file")" = "$HEROKU_DB_OWNER_APP_NAME"
stack="$(jq -r '.stack.name // empty' "$app_file")"
test "$stack" = "$HEROKU_REQUIRED_STACK"
app_url="$(jq -r '.web_url // empty' "$app_file" | sed 's:/*$::')"
test -n "$app_url"

required_vars=(${HEROKU_REQUIRED_CONFIG_NAMES//,/ })
for name in "${required_vars[@]}"; do
  if ! jq -e --arg name "$name" 'has($name) and (.[$name] | type == "string" and length > 0)' "$mcp_config_file" >/dev/null; then
    echo "Required MCP backend config is absent or empty: $name" >&2
    exit 1
  fi
done
jq -e 'has("DATABASE_URL") and (.DATABASE_URL | type == "string" and length > 0)' "$owner_config_file" >/dev/null

if jq -e 'has("MCP_MIGRATION_DATABASE_URL") and (.MCP_MIGRATION_DATABASE_URL | type == "string" and length > 0)' "$mcp_config_file" >/dev/null; then
  echo "Production runtime must not store MCP_MIGRATION_DATABASE_URL." >&2
  exit 1
fi

persistence_provider="$(jq -r '.PERSISTENCE_PROVIDER // empty' "$mcp_config_file")"
test "$persistence_provider" = "postgresql"
legacy_runtime_enabled="$(jq -r '.MCP_LEGACY_RUNTIME_ENABLED // empty' "$mcp_config_file" | tr '[:upper:]' '[:lower:]')"
case "$legacy_runtime_enabled" in
  false|0|no|off) ;;
  *)
    echo "MCP_LEGACY_RUNTIME_ENABLED must be false for production." >&2
    exit 1
    ;;
esac

runtime_database_url="$(jq -r '.DATABASE_URL' "$mcp_config_file")"
owner_database_url="$(jq -r '.DATABASE_URL' "$owner_config_file")"
expected_role="$(jq -r '.MCP_DB_ROLE' "$mcp_config_file")"
for sensitive in "$runtime_database_url" "$owner_database_url" "$expected_role"; do
  test -n "$sensitive"
  echo "::add-mask::$sensitive"
done

topology_json="$(
  RUNTIME_DATABASE_URL="$runtime_database_url" \
  OWNER_DATABASE_URL="$owner_database_url" \
  node --input-type=module <<'NODE'
function parsed(value) {
  const result = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(result.protocol)) throw new Error("invalid_database_url");
  return result;
}
function targetIdentity(value) {
  const result = parsed(value);
  return `${result.hostname.toLowerCase()}:${result.port || "5432"}/${decodeURIComponent(result.pathname.replace(/^\//, ""))}`;
}
function credentialIdentity(value) {
  const result = parsed(value);
  return `${decodeURIComponent(result.username || "").toLowerCase()}@${targetIdentity(value)}`;
}
const runtime = process.env.RUNTIME_DATABASE_URL;
const owner = process.env.OWNER_DATABASE_URL;
process.stdout.write(JSON.stringify({
  sharedTarget: targetIdentity(runtime) === targetIdentity(owner),
  sameCredentialIdentity: credentialIdentity(runtime) === credentialIdentity(owner)
}));
NODE
)"
shared_database_target="$(jq -r '.sharedTarget | tostring' <<<"$topology_json")"
same_credential_identity="$(jq -r '.sameCredentialIdentity | tostring' <<<"$topology_json")"
test "$shared_database_target" = "true"

mapfile -t database_addon_ids < <(
  jq -r '.[] | select((.config_vars // []) | index("DATABASE_URL")) | .id' "$owner_addons_file"
)
if [ "${#database_addon_ids[@]}" -ne 1 ]; then
  echo "Expected exactly one Core Heroku Postgres add-on providing DATABASE_URL." >&2
  exit 1
fi
database_addon_id="${database_addon_ids[0]}"
postgres_plan="$(jq -r --arg id "$database_addon_id" '.[] | select(.id == $id) | .plan.name // empty' "$owner_addons_file")"
test -n "$postgres_plan"

formal_attachment_count="$(jq -r --arg id "$database_addon_id" '[.[] | select(.addon.id == $id)] | length' "$mcp_attachments_file")"
if [ "$formal_attachment_count" -gt 0 ]; then
  database_attachment_mode="shared_addon_attachment"
else
  database_attachment_mode="shared_target_config"
fi

case "$postgres_plan" in
  heroku-postgresql:essential-*)
    provider_additional_credentials="false"
    expected_credential_mode="essential_owner"
    expected_least_privilege="false"
    ;;
  heroku-postgresql:advanced-*|heroku-postgresql:standard-*|heroku-postgresql:premium-*|heroku-postgresql:private-*|heroku-postgresql:shield-*)
    provider_additional_credentials="true"
    expected_credential_mode="separated"
    expected_least_privilege="true"
    ;;
  *)
    echo "Unclassified Heroku Postgres plan for Phase 9.3 credential policy." >&2
    exit 1
    ;;
esac

test "$MCP_MIGRATION_CREDENTIAL_MODE" = "$expected_credential_mode"
if [ "$expected_credential_mode" = "essential_owner" ]; then
  test "$same_credential_identity" = "true"
else
  test "$same_credential_identity" = "false"
fi

runtime_readiness="$(
  RUNTIME_CONFIG_FILE="$mcp_config_file" \
  node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
import { createPostgresqlPersistence } from "./mcp/apps/backend/foundation/postgresql-adapter.js";
const env = JSON.parse(await readFile(process.env.RUNTIME_CONFIG_FILE, "utf8"));
const persistence = createPostgresqlPersistence({
  nodeEnv: "production",
  persistence: {
    databaseUrl: env.DATABASE_URL,
    schema: env.MCP_DB_SCHEMA || "mcp",
    expectedRole: env.MCP_DB_ROLE || null,
    poolMax: 1,
    connectionTimeoutMs: 10000,
    idleTimeoutMs: 10000,
    statementTimeoutMs: 10000
  }
});
try {
  const status = await persistence.readiness();
  if (!status.ready) {
    console.error(`runtime_database_readiness_failed:${status.code || "unknown"}`);
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({ ready: true, provider: status.provider, configured: status.configured }));
  }
} finally {
  await persistence.close();
}
NODE
)"
test "$(jq -r '.ready | tostring' <<<"$runtime_readiness")" = "true"
test "$(jq -r '.provider // empty' <<<"$runtime_readiness")" = "postgresql"

live_status="$(health_status "$app_url" /health/live)"
ready_status="$(health_status "$app_url" /health/ready)"
test "$live_status" = "200"
test "$ready_status" = "200"

release_version="$(jq -r '[.[] | select(.current == true)][0].version // .[0].version // empty' "$release_file")"
release_created_at="$(jq -r '[.[] | select(.current == true)][0].created_at // .[0].created_at // empty' "$release_file")"
test -n "$release_version"
test -n "$release_created_at"

umask 077
{
  echo "AUDITED_MAIN_SHA=$AUDITED_MAIN_SHA"
  echo "HEROKU_APP_NAME=$HEROKU_APP_NAME"
  echo "HEROKU_STACK=$stack"
  echo "HEROKU_RELEASE_VERSION=$release_version"
  echo "HEROKU_RELEASE_CREATED_AT=$release_created_at"
  echo "HEROKU_POSTGRES_PLAN=$postgres_plan"
  echo "HEROKU_POSTGRES_ADDITIONAL_CREDENTIALS=$provider_additional_credentials"
  echo "MCP_SHARED_DATABASE_TARGET=true"
  echo "MCP_DATABASE_ATTACHMENT_MODE=$database_attachment_mode"
  echo "MCP_RUNTIME_DATABASE_READY=true"
  echo "MCP_PERSISTENCE_PROVIDER=postgresql"
  echo "MCP_LEGACY_RUNTIME_ENABLED=false"
  echo "MCP_RUNTIME_MIGRATION_CREDENTIAL_SAME_IDENTITY=$same_credential_identity"
  echo "MCP_MIGRATION_CREDENTIAL_MODE=$MCP_MIGRATION_CREDENTIAL_MODE"
  echo "MCP_MIGRATION_LEAST_PRIVILEGE=$expected_least_privilege"
  echo "MCP_RUNTIME_MIGRATION_CREDENTIAL_STORED=false"
  echo "MCP_HEALTH_LIVE=$live_status"
  echo "MCP_HEALTH_READY=$ready_status"
  echo "MCP_SOURCE_CORRELATION=container_release_does_not_expose_git_sha"
} > "$MCP_AUDIT_EVIDENCE_FILE"
cat "$MCP_AUDIT_EVIDENCE_FILE" >> "$GITHUB_STEP_SUMMARY"
