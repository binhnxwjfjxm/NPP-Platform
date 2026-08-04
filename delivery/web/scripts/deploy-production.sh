#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

DELIVERY_PROJECT_NAME="${DELIVERY_PROJECT_NAME:-npp-delivery}"
DELIVERY_ROOT_DIRECTORY="${DELIVERY_ROOT_DIRECTORY:-delivery/web}"
DELIVERY_DOMAIN="${DELIVERY_DOMAIN:-log.nguyenlieuhungphat.com}"
CORE_HEROKU_APP_NAME="${CORE_HEROKU_APP_NAME:-hung-phat}"
CORE_PROJECT_ID="${CORE_PROJECT_ID:-prj_vFEAzoxesLqNJIfD8uF4q1kytpvk}"
MCP_PROJECT_ID="${MCP_PROJECT_ID:-prj_854SWdJeDEOPezAvvTZzTaRvZUSq}"
ADMIN_PROJECT_ID="${ADMIN_PROJECT_ID:-prj_0hp2A8WyUW4zgglShPTzL70hesVC}"
WEBSITE_PROJECT_ID="${WEBSITE_PROJECT_ID:-prj_rXqH83GFDHuEGUcQrrv82JBPWnjU}"

for secret in "$VERCEL_TOKEN" "$HEROKU_API_KEY"; do echo "::add-mask::$secret"; done

write_env() {
  local name="$1" value="$2" marker
  marker="DELIVERY_${name}_${RANDOM}_${RANDOM}"
  {
    echo "$name<<$marker"
    echo "$value"
    echo "$marker"
  } >> "$GITHUB_ENV"
  export "$name=$value"
}

smoke_core() {
  local path="$1" deadline=$((SECONDS + 180)) status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(curl --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}' "$CORE_API_INTERNAL_URL$path" || true)"
    [ "$status" = 200 ] && return 0
    sleep 3
  done
  echo "Core health smoke failed for $path; last status=${status:-none}." >&2
  return 1
}

app_json="${RUNNER_TEMP}/core-app.json"
config_json="${RUNNER_TEMP}/core-config.json"
bootstrap_json="${RUNNER_TEMP}/delivery-bootstrap.json"
project_json="${RUNNER_TEMP}/delivery-project.json"
settings_json="${RUNNER_TEMP}/delivery-settings.json"

curl --fail --silent --show-error \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  "https://api.heroku.com/apps/$CORE_HEROKU_APP_NAME" > "$app_json"
curl --fail --silent --show-error \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  "https://api.heroku.com/apps/$CORE_HEROKU_APP_NAME/config-vars" > "$config_json"

core_url="$(jq -r '.web_url // empty' "$app_json")"
core_url="${core_url%/}"
database_url="$(jq -r '.DATABASE_URL // empty' "$config_json")"
ssl_mode="$(jq -r '.DATABASE_SSL_MODE // "require"' "$config_json")"
delivery_token="$(jq -r '.DELIVERY_FRONTEND_API_TOKEN // empty' "$config_json")"
test -n "$core_url"
test -n "$database_url"
case "$ssl_mode" in require|verify-full) ;; *) echo "Core database TLS is not enforced." >&2; exit 1 ;; esac
if [ -z "$delivery_token" ]; then delivery_token="$(openssl rand -hex 32)"; fi
for secret in "$database_url" "$delivery_token"; do echo "::add-mask::$secret"; done

DATABASE_URL="$database_url" DATABASE_SSL_MODE="$ssl_mode" node --input-type=module <<'NODE' > "$bootstrap_json"
import pg from 'pg';
import { buildSslConfig } from './npp-core/api/src/db/pool.js';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(process.env.DATABASE_SSL_MODE),
  application_name: 'delivery-production-bootstrap-audit',
});
try {
  const warehouseResult = await pool.query(`
    SELECT id::text
      FROM shared.warehouses
     WHERE is_active = true
     ORDER BY id
  `);
  if (!warehouseResult.rows.length) throw new Error('no_active_delivery_warehouses');

  const userResult = await pool.query(`
    SELECT e.id::text AS employee_id,
           COALESCE(NULLIF(to_jsonb(e)->>'full_name', ''), NULLIF(to_jsonb(e)->>'name', ''), dp.name, 'Tài xế') AS display_name,
           true AS driver_ready
      FROM logistics.driver_profiles dp
      JOIN shared.employees e
        ON e.installation_id = dp.installation_id
       AND e.id = dp.employee_id
     WHERE dp.is_active = true
       AND dp.employee_id IS NOT NULL
       AND COALESCE((to_jsonb(e)->>'is_active')::boolean, true) = true
     ORDER BY e.id
     LIMIT 1
  `);
  if (!userResult.rows.length) throw new Error('no_active_driver_profile_for_delivery_bootstrap');

  process.stdout.write(JSON.stringify({
    warehouseIds: warehouseResult.rows.map((row) => row.id),
    employeeId: userResult.rows[0].employee_id,
    displayName: userResult.rows[0].display_name,
    driverReady: Boolean(userResult.rows[0].driver_ready),
  }));
} finally {
  await pool.end();
}
NODE

warehouse_ids="$(jq -r '.warehouseIds | join(",")' "$bootstrap_json")"
employee_id="$(jq -r '.employeeId' "$bootstrap_json")"
display_name="$(jq -r '.displayName' "$bootstrap_json")"
driver_ready="$(jq -r '.driverReady' "$bootstrap_json")"
test -n "$warehouse_ids"
test -n "$employee_id"

users_json="${SECRET_DELIVERY_WEB_USERS_JSON:-}"
auth_source="delivery-secret"
if [ -z "$users_json" ]; then
  test -n "${CORE_WEB_ADMIN_USERNAME:-}"
  test -n "${CORE_WEB_ADMIN_PASSWORD:-}"
  users_json="$(
    USERNAME="$CORE_WEB_ADMIN_USERNAME" PASSWORD="$CORE_WEB_ADMIN_PASSWORD" \
    EMPLOYEE_ID="$employee_id" DISPLAY_NAME="$display_name" \
    node --input-type=module <<'NODE'
const value = [{
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  employeeId: process.env.EMPLOYEE_ID,
  displayName: process.env.DISPLAY_NAME,
}];
process.stdout.write(JSON.stringify(value));
NODE
  )"
  auth_source="core-web-bootstrap"
fi

DELIVERY_USERS_JSON="$users_json" node --input-type=module <<'NODE'
const users = JSON.parse(process.env.DELIVERY_USERS_JSON || 'null');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!Array.isArray(users) || users.length < 1 || users.length > 500) throw new Error('invalid_delivery_users');
const usernames = new Set();
const employeeIds = new Set();
for (const user of users) {
  const username = String(user?.username || '');
  const employeeId = String(user?.employeeId || '');
  if (!/^[A-Za-z0-9._-]{2,80}$/.test(username)) throw new Error('invalid_delivery_username');
  if (String(user?.password || '').length < 12) throw new Error('invalid_delivery_password');
  if (!uuid.test(employeeId)) throw new Error('invalid_delivery_employee');
  if (!String(user?.displayName || '').trim()) throw new Error('invalid_delivery_display_name');
  if (usernames.has(username) || employeeIds.has(employeeId)) throw new Error('duplicate_delivery_user');
  usernames.add(username);
  employeeIds.add(employeeId);
}
NODE

echo "::add-mask::$users_json"
write_env CORE_API_INTERNAL_URL "$core_url"
write_env DELIVERY_CORE_API_TOKEN "$delivery_token"
write_env DELIVERY_WEB_USERS_JSON "$users_json"
write_env DELIVERY_FRONTEND_WAREHOUSE_IDS "$warehouse_ids"

core_payload="$(jq -n \
  --arg token "$delivery_token" \
  --arg actor 'service:delivery-frontend' \
  --arg warehouses "$warehouse_ids" \
  '{DELIVERY_FRONTEND_API_TOKEN:$token,DELIVERY_FRONTEND_ACTOR_ID:$actor,DELIVERY_FRONTEND_WAREHOUSE_IDS:$warehouses}')"
curl --fail --silent --show-error \
  -X PATCH \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  -H 'Content-Type: application/json' \
  "https://api.heroku.com/apps/$CORE_HEROKU_APP_NAME/config-vars" \
  --data "$core_payload" >/dev/null
smoke_core /health/live
smoke_core /health/ready

status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$DELIVERY_PROJECT_NAME?teamId=$VERCEL_ORG_ID")"
if [ "$status" = 404 ]; then
  payload="$(jq -n --arg name "$DELIVERY_PROJECT_NAME" --arg root "$DELIVERY_ROOT_DIRECTORY" '{name:$name,framework:"nextjs",rootDirectory:$root}')"
  status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.vercel.com/v11/projects?teamId=$VERCEL_ORG_ID" \
    --data "$payload")"
fi
case "$status" in 200|201) ;; *) cat "$project_json" >&2; exit 1 ;; esac
project_id="$(jq -r '.id // empty' "$project_json")"
test -n "$project_id"
for forbidden in "$CORE_PROJECT_ID" "$MCP_PROJECT_ID" "$ADMIN_PROJECT_ID" "$WEBSITE_PROJECT_ID"; do
  test "$project_id" != "$forbidden"
done

settings_payload="$(jq -n --arg root "$DELIVERY_ROOT_DIRECTORY" '{framework:"nextjs",rootDirectory:$root,nodeVersion:"20.x"}')"
status="$(curl --silent --show-error --output "$settings_json" --write-out '%{http_code}' \
  -X PATCH \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://api.vercel.com/v9/projects/$project_id?teamId=$VERCEL_ORG_ID" \
  --data "$settings_payload")"
test "$status" = 200
test "$(jq -r '.rootDirectory' "$settings_json")" = "$DELIVERY_ROOT_DIRECTORY"
test "$(jq -r '.framework' "$settings_json")" = nextjs
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('delivery/web/vercel.json', 'utf8'));
if (config.git?.deploymentEnabled !== false) throw new Error('delivery_auto_deploy_not_locked');
NODE

DELIVERY_PROJECT_ID="$project_id" node --input-type=module <<'NODE'
const values = {
  CORE_API_INTERNAL_URL: process.env.CORE_API_INTERNAL_URL,
  DELIVERY_CORE_API_TOKEN: process.env.DELIVERY_CORE_API_TOKEN,
  DELIVERY_WEB_USERS_JSON: process.env.DELIVERY_WEB_USERS_JSON,
  NEXT_PUBLIC_APP_LOGO_URL: '/logo-transparent.png',
};
const response = await fetch(`https://api.vercel.com/v10/projects/${process.env.DELIVERY_PROJECT_ID}/env?teamId=${process.env.VERCEL_ORG_ID}&upsert=true`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.entries(values).map(([key, value]) => ({
    key,
    value,
    type: 'sensitive',
    target: ['production'],
  }))),
});
const payload = await response.json().catch(() => null);
if (!response.ok) throw new Error(`delivery_env_upsert_failed:${response.status}:${payload?.error?.code || 'unknown'}`);
NODE

lookup="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$project_id/domains/$DELIVERY_DOMAIN?teamId=$VERCEL_ORG_ID")"
if [ "$lookup" != 200 ]; then
  domain_body="${RUNNER_TEMP}/delivery-domain.json"
  status="$(curl --silent --show-error --output "$domain_body" --write-out '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.vercel.com/v10/projects/$project_id/domains?teamId=$VERCEL_ORG_ID" \
    --data "{\"name\":\"$DELIVERY_DOMAIN\"}")"
  case "$status" in 200|201) ;; *) cat "$domain_body" >&2; exit 1 ;; esac
fi

mkdir -p .vercel
printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$project_id" > .vercel/project.json
npx --yes vercel@58.0.0 pull --yes --environment=production --token="$VERCEL_TOKEN" >/dev/null
test "$(jq -r '.projectId' .vercel/project.json)" = "$project_id"

npm ci --ignore-scripts
(
  cd delivery/web
  npm run verify
)
npx --yes vercel@58.0.0 build --prod --token="$VERCEL_TOKEN"
deployment_url="$(npx --yes vercel@58.0.0 deploy --prebuilt --prod --token="$VERCEL_TOKEN")"
test -n "$deployment_url"

unauth="$(curl --silent --show-error --retry 5 --retry-delay 4 --output /dev/null --write-out '%{http_code}' "$deployment_url/")"
test "$unauth" = 401
auth="$(DELIVERY_USERS_JSON="$users_json" node --input-type=module <<'NODE'
const [user] = JSON.parse(process.env.DELIVERY_USERS_JSON);
process.stdout.write(`${user.username}:${user.password}`);
NODE
)"
echo "::add-mask::$auth"
selected_employee_id="$(DELIVERY_USERS_JSON="$users_json" node --input-type=module <<'NODE'
const [user] = JSON.parse(process.env.DELIVERY_USERS_JSON);
process.stdout.write(user.employeeId);
NODE
)"
api_body="${RUNNER_TEMP}/delivery-driver-api.json"
curl --fail --silent --show-error --retry 5 --retry-delay 4 \
  -H "Authorization: Bearer $delivery_token" \
  -H "x-npp-delivery-employee-id: $selected_employee_id" \
  -H "x-request-id: delivery-production-smoke-${GITHUB_RUN_ID:-local}" \
  "$core_url/api/logistics/driver/trips?limit=1&offset=0" > "$api_body"
jq -e '.data.items | type == "array"' "$api_body" >/dev/null
html="$(curl --fail --silent --show-error --retry 5 --retry-delay 4 -u "$auth" "$deployment_url/")"
grep -q 'Chuyến của tôi' <<<"$html"
grep -qv 'Không tải được chuyến' <<<"$html"
css_asset="$(printf '%s' "$html" | grep -oE '/_next/static/[^" ]+\.css' | head -n 1)"
js_asset="$(printf '%s' "$html" | grep -oE '/_next/static/[^" ]+\.js' | head -n 1)"
test -n "$css_asset"
test -n "$js_asset"
curl --fail --silent --show-error "$deployment_url$css_asset" >/dev/null
curl --fail --silent --show-error "$deployment_url$js_asset" >/dev/null

domain_status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output /dev/null --write-out '%{http_code}' "https://$DELIVERY_DOMAIN/" || true)"
domain_ready=false
case "$domain_status" in 200|401) domain_ready=true ;; esac

{
  echo "project_id=$project_id"
  echo "deployment_url=$deployment_url"
  echo "domain_ready=$domain_ready"
  echo "auth_source=$auth_source"
  echo "driver_ready=$driver_ready"
} >> "$GITHUB_OUTPUT"
