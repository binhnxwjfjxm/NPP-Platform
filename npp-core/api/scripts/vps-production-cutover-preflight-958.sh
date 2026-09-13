#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${CUTOVER_SHA:?CUTOVER_SHA is required}"
: "${VPS_DB_HOST:?VPS_DB_HOST is required}"
: "${VPS_COMPANY_HOST:?VPS_COMPANY_HOST is required}"
: "${VPS_MCP_HOST:?VPS_MCP_HOST is required}"
: "${VPS_SSH_USER:?VPS_SSH_USER is required}"
: "${DB_KEY:?DB_KEY is required}"
: "${DB_KNOWN:?DB_KNOWN is required}"
: "${COMPANY_KEY:?COMPANY_KEY is required}"
: "${COMPANY_KNOWN:?COMPANY_KNOWN is required}"
: "${MCP_KEY:?MCP_KEY is required}"
: "${MCP_KNOWN:?MCP_KNOWN is required}"
: "${REPORT_FILE:?REPORT_FILE is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

HEROKU_COMPANY_APP="hung-phat"
HEROKU_MCP_APP="hung-phat-mcp"
PRODUCTION_DB="npp_production"
COMPANY_DB_ROLE="npp_company_runtime"
MCP_DB_ROLE="mcp_runtime"
VERCEL_TEAM="team_hBA8rX68UHC8ogvREkOyQlJ2"
PROJECT_COMPANY="prj_vFEAzoxesLqNJIfD8uF4q1kytpvk"
PROJECT_MCP="prj_854SWdJeDEOPezAvvTZzTaRvZUSq"
PROJECT_ADMIN="prj_0hp2A8WyUW4zgglShPTzL70hesVC"
PROJECT_DELIVERY="prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux"
PROJECT_RETAIL="prj_1O9Ob6ZptSqZOBpxKbpn3Ujfm811"
PROJECT_WEBSITE="prj_rXqH83GFDHuEGUcQrrv82JBPWnjU"
PROJECT_ORDERING="prj_btLk3p4FhmShgKFdRBMq6ZFOagKe"

umask 077
: > "$REPORT_FILE"
company_cfg="$RUNNER_TEMP/company-heroku.json"
mcp_cfg="$RUNNER_TEMP/mcp-heroku.json"
company_env="$RUNNER_TEMP/company-production.env"
mcp_env="$RUNNER_TEMP/mcp-production.env"
company_pw_file="$RUNNER_TEMP/company-db-password"
mcp_pw_file="$RUNNER_TEMP/mcp-db-password"
vercel_state="$RUNNER_TEMP/vercel-state.tsv"
: > "$vercel_state"

mask() { [ -n "${1:-}" ] && echo "::add-mask::$1"; }
heroku_api() {
  local path="$1" method="${2:-GET}" body="${3:-}"
  local args=(--fail --silent --show-error -H 'Accept: application/vnd.heroku+json; version=3' -H "Authorization: Bearer $HEROKU_API_KEY" -X "$method")
  [ -z "$body" ] || args+=(-H 'Content-Type: application/json' --data "$body")
  curl "${args[@]}" "https://api.heroku.com$path"
}
vercel_api() {
  local path="$1" method="${2:-GET}" body="${3:-}"
  local args=(--fail --silent --show-error -H "Authorization: Bearer $VERCEL_TOKEN" -X "$method")
  [ -z "$body" ] || args+=(-H 'Content-Type: application/json' --data "$body")
  curl "${args[@]}" "https://api.vercel.com$path"
}
ssh_run() {
  local key="$1" known="$2" host="$3"; shift 3
  ssh -i "$key" -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known" "$VPS_SSH_USER@$host" "$@"
}
scp_put() {
  local key="$1" known="$2" host="$3" local_file="$4" remote_file="$5"
  scp -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known" "$local_file" "$VPS_SSH_USER@$host:$remote_file"
}

assert_main_unchanged() {
  git fetch --prune --no-tags origin '+refs/heads/main:refs/remotes/origin/main' >/dev/null
  test "$(git rev-parse origin/main)" = "$CUTOVER_SHA"
  test "$(git rev-parse HEAD)" = "$CUTOVER_SHA"
}

formation_quantity() {
  local app="$1"
  heroku_api "/apps/$app/formation" | jq -r '[.[] | select(.type=="web")][0].quantity // 0'
}
set_web_quantity() {
  local app="$1" quantity="$2"
  heroku_api "/apps/$app/formation/web" PATCH "{\"quantity\":$quantity}" >/dev/null
}
wait_web_quantity() {
  local app="$1" expected="$2" deadline=$((SECONDS+180))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(formation_quantity "$app")" = "$expected" ] && return 0
    sleep 3
  done
  return 1
}


project_env_value() {
  local pid="$1" key="$2" dir file value
  dir="$RUNNER_TEMP/vercel-env-$pid"
  rm -rf "$dir"
  mkdir -p "$dir/.vercel"
  printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_TEAM" "$pid" > "$dir/.vercel/project.json"
  (cd "$dir" && npx --yes vercel@58.0.0 pull --yes --environment=production --token="$VERCEL_TOKEN" >/dev/null)
  file="$dir/.vercel/.env.production.local"
  test -s "$file"
  value="$(KEY="$key" FILE="$file" bash -c 'set -a; source "$FILE"; set +a; printf "%s" "${!KEY:-}"')"
  test -n "$value"
  mask "$value"
  printf '%s' "$value"
}

for app in "$HEROKU_COMPANY_APP" "$HEROKU_MCP_APP"; do
  other_active="$(heroku_api "/apps/$app/formation" | jq '[.[] | select(.type != "web" and (.quantity // 0) > 0)] | length')"
  test "$other_active" = 0
done
company_old_qty="$(formation_quantity "$HEROKU_COMPANY_APP")"
mcp_old_qty="$(formation_quantity "$HEROKU_MCP_APP")"
[[ "$company_old_qty" =~ ^[0-9]+$ && "$mcp_old_qty" =~ ^[0-9]+$ ]]
[ "$company_old_qty" -gt 0 ]
[ "$mcp_old_qty" -gt 0 ]
opened_writes=false
vercel_mutated=false
rollback_before_open() {
  local status=$?
  if [ "$status" -eq 0 ]; then return 0; fi
  if [ "$opened_writes" = true ]; then
    echo 'Failure occurred after production write-open; re-freezing VPS ingress and leaving Heroku stopped.' >&2
    set_ingress_mode freeze || true
  else
    if [ "$vercel_mutated" = true ]; then restore_vercel_bindings || true; fi
    set_web_quantity "$HEROKU_COMPANY_APP" "$company_old_qty" || true
    set_web_quantity "$HEROKU_MCP_APP" "$mcp_old_qty" || true
  fi
  exit "$status"
}
trap rollback_before_open EXIT

assert_main_unchanged

# Gate B: exact source/provider/VPS preflight.
for spec in \
  "$PROJECT_COMPANY:npp-platform" \
  "$PROJECT_MCP:mcp-field" \
  "$PROJECT_ADMIN:admin-mcp-npp" \
  "$PROJECT_DELIVERY:npp-delivery" \
  "$PROJECT_RETAIL:npp-retail" \
  "$PROJECT_WEBSITE:nguyenlieuhungphat" \
  "$PROJECT_ORDERING:customer-ordering"
do
  pid="${spec%%:*}"; pname="${spec#*:}"
  project="$(vercel_api "/v9/projects/$pid?teamId=$VERCEL_TEAM")"
  test "$(jq -r '.id' <<<"$project")" = "$pid"
  test "$(jq -r '.name' <<<"$project")" = "$pname"
done

for tuple in "$DB_KEY|$DB_KNOWN|$VPS_DB_HOST" "$COMPANY_KEY|$COMPANY_KNOWN|$VPS_COMPANY_HOST" "$MCP_KEY|$MCP_KNOWN|$VPS_MCP_HOST"; do
  IFS='|' read -r key known host <<< "$tuple"
  ssh_run "$key" "$known" "$host" 'sudo -n true; test "$(systemctl --failed --no-legend --plain 2>/dev/null | awk "NF{c++} END{print c+0}")" = 0'
done
ssh_run "$DB_KEY" "$DB_KNOWN" "$VPS_DB_HOST" 'test "$(systemctl is-active postgresql)" = active; sudo -n -u postgres psql -XAtqc "show server_version" | grep -Eq "^17\."'
ssh_run "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" 'test "$(systemctl is-active nginx)" = active; sudo -n nginx -t >/dev/null 2>&1; node --version | grep -Eq "^v20\."'
ssh_run "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" 'node --version | grep -Eq "^v20\."; for s in ipv4-proxy ipv6-proxy oci-ipv6-pool; do test "$(systemctl is-active "$s")" = active; done; test "$(ss -lntH | awk '\''{n=split($4,a,":");p=a[n]+0;if(p>=3128&&p<=3427)c++}END{print c+0}'\'')" = 300'

# Capture source runtime config privately before freeze.
heroku_api "/apps/$HEROKU_COMPANY_APP/config-vars" > "$company_cfg"
heroku_api "/apps/$HEROKU_MCP_APP/config-vars" > "$mcp_cfg"
for key in DATABASE_URL INSTALLATION_ID BACKEND_API_TOKEN CORE_BOOTSTRAP_ACTOR_ID CORS_ORIGINS; do jq -e --arg k "$key" 'has($k) and (.[$k] | tostring | length > 0)' "$company_cfg" >/dev/null; done
for key in DATABASE_URL INSTALLATION_ID BACKEND_API_TOKEN CORS_ORIGINS CORE_SALES_API_TOKEN CORE_ONBOARDING_API_TOKEN; do jq -e --arg k "$key" 'has($k) and (.[$k] | tostring | length > 0)' "$mcp_cfg" >/dev/null; done

company_old_url="$(heroku_api "/apps/$HEROKU_COMPANY_APP" | jq -r '.web_url' | sed 's:/*$::')"
mcp_old_url="$(heroku_api "/apps/$HEROKU_MCP_APP" | jq -r '.web_url' | sed 's:/*$::')"
test -n "$company_old_url"; test -n "$mcp_old_url"
mask "$company_old_url"; mask "$mcp_old_url"

# Capture exact current Vercel production bindings so rollback restores the real pre-cutover state.
old_company_internal="$(project_env_value "$PROJECT_COMPANY" CORE_API_INTERNAL_URL)"
old_company_public="$(project_env_value "$PROJECT_COMPANY" NEXT_PUBLIC_CORE_API_URL)"
old_admin_core="$(project_env_value "$PROJECT_ADMIN" CORE_API_INTERNAL_URL)"
old_delivery_core="$(project_env_value "$PROJECT_DELIVERY" CORE_API_INTERNAL_URL)"
old_retail_core="$(project_env_value "$PROJECT_RETAIL" CORE_API_INTERNAL_URL)"
old_ordering_core="$(project_env_value "$PROJECT_ORDERING" CORE_API_BASE_URL)"
old_mcp_backend="$(project_env_value "$PROJECT_MCP" BACKEND_API_BASE_URL)"

echo 'GATE_B_PREFLIGHT=PASS' >> "$REPORT_FILE"
