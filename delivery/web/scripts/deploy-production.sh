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
project_json="${RUNNER_TEMP}/delivery-project.json"
settings_json="${RUNNER_TEMP}/delivery-settings.json"

curl --fail --silent --show-error \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  "https://api.heroku.com/apps/$CORE_HEROKU_APP_NAME" > "$app_json"

core_url="$(jq -r '.web_url // empty' "$app_json")"
core_url="${core_url%/}"
test -n "$core_url"
CORE_URL="$core_url" node --input-type=module <<'NODE'
const url = new URL(process.env.CORE_URL);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_core_api_internal_url');
NODE
write_env CORE_API_INTERNAL_URL "$core_url"
write_env NEXT_PUBLIC_APP_LOGO_URL '/logo-transparent.png'

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
  NEXT_PUBLIC_APP_LOGO_URL: process.env.NEXT_PUBLIC_APP_LOGO_URL,
};
const missing = Object.entries(values).filter(([, value]) => !String(value || '').trim()).map(([key]) => key);
if (missing.length) throw new Error(`missing_delivery_environment_values:${missing.join(',')}`);
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

# The generated Vercel hostname may be protected by Vercel Authentication.
# It is still useful for proving that the exact deployment exists, but app
# behavior and static assets must be verified on the canonical production domain.
deployment_reachable=false
last_deployment_status=""
for attempt in $(seq 1 10); do
  last_deployment_status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out '%{http_code}' "$deployment_url/login" || true)"
  case "$last_deployment_status" in
    200|301|302|303|307|308|401|403)
      deployment_reachable=true
      break
      ;;
  esac
  echo "Delivery deployment hostname not reachable yet: attempt=$attempt status=${last_deployment_status:-none}"
  sleep 3
done
test "$deployment_reachable" = true

smoke_url="https://$DELIVERY_DOMAIN"
domain_ready=false
for attempt in $(seq 1 12); do
  login_file="${RUNNER_TEMP}/delivery-login.html"
  unauth="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out '%{http_code}' "$smoke_url/" || true)"
  login_code="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    -H 'Accept: text/html' --output "$login_file" --write-out '%{http_code}' \
    "$smoke_url/login" || true)"
  if [ "$unauth" = 401 ] && [ "$login_code" = 200 ] && \
     grep -Fq 'Welcome to Hung Phat Operations.' "$login_file"; then
    asset="$(grep -oE '/_next/static/[^" ]+\.(css|js)' "$login_file" | head -n 1)"
    if [ -n "$asset" ] && curl --fail --silent --show-error "$smoke_url$asset" >/dev/null; then
      domain_ready=true
      break
    fi
  fi
  echo "Delivery canonical domain not ready: attempt=$attempt root=$unauth login=$login_code"
  sleep 5
done
test "$domain_ready" = true

{
  echo "project_id=$project_id"
  echo "deployment_url=$deployment_url"
  echo "domain_ready=$domain_ready"
  echo "auth_source=core-workforce-session"
  echo "driver_ready=runtime-authorized"
  echo "setup_mode=false"
} >> "$GITHUB_OUTPUT"
