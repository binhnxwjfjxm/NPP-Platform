#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${VPS_COMPANY_HOST:?VPS_COMPANY_HOST is required}"

DELIVERY_PROJECT_NAME="${DELIVERY_PROJECT_NAME:-npp-delivery}"
DELIVERY_ROOT_DIRECTORY="${DELIVERY_ROOT_DIRECTORY:-delivery/web}"
DELIVERY_DOMAIN="${DELIVERY_DOMAIN:-log.nguyenlieuhungphat.com}"
CORE_PROJECT_ID="${CORE_PROJECT_ID:-prj_vFEAzoxesLqNJIfD8uF4q1kytpvk}"
MCP_PROJECT_ID="${MCP_PROJECT_ID:-prj_854SWdJeDEOPezAvvTZzTaRvZUSq}"
ADMIN_PROJECT_ID="${ADMIN_PROJECT_ID:-prj_0hp2A8WyUW4zgglShPTzL70hesVC}"
WEBSITE_PROJECT_ID="${WEBSITE_PROJECT_ID:-prj_rXqH83GFDHuEGUcQrrv82JBPWnjU}"
CORE_API_INTERNAL_URL="https://${VPS_COMPANY_HOST}"
export CORE_API_INTERNAL_URL

echo "::add-mask::$VERCEL_TOKEN"
echo "::add-mask::$CORE_API_INTERNAL_URL"

CORE_URL="$CORE_API_INTERNAL_URL" node --input-type=module <<'NODE'
const url = new URL(process.env.CORE_URL);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('invalid_company_api_url');
}
if (url.hostname.endsWith('.herokuapp.com')) throw new Error('delivery_company_api_must_not_point_to_heroku');
NODE

smoke_company() {
  local path="$1" deadline=$((SECONDS + 180)) status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(curl --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}' "$CORE_API_INTERNAL_URL$path" || true)"
    [ "$status" = 200 ] && return 0
    sleep 3
  done
  echo "Công Ty health smoke failed for $path; last status=${status:-none}." >&2
  return 1
}

smoke_company /health/live
smoke_company /health/ready
auth_status="$(curl --silent --show-error --connect-timeout 5 --max-time 20 --output /dev/null --write-out '%{http_code}' "$CORE_API_INTERNAL_URL/api/internal-auth/me" || true)"
test "$auth_status" = 401

project_json="${RUNNER_TEMP}/delivery-project.json"
settings_json="${RUNNER_TEMP}/delivery-settings.json"
status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$DELIVERY_PROJECT_NAME?teamId=$VERCEL_ORG_ID")"
if [ "$status" = 404 ]; then
  payload="$(jq -n --arg name "$DELIVERY_PROJECT_NAME" --arg root "$DELIVERY_ROOT_DIRECTORY" '{name:$name,framework:"nextjs",rootDirectory:$root}')"
  status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
    -X POST -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
    "https://api.vercel.com/v11/projects?teamId=$VERCEL_ORG_ID" --data "$payload")"
fi
case "$status" in 200|201) ;; *) cat "$project_json" >&2; exit 1 ;; esac
project_id="$(jq -r '.id // empty' "$project_json")"
test -n "$project_id"
for forbidden in "$CORE_PROJECT_ID" "$MCP_PROJECT_ID" "$ADMIN_PROJECT_ID" "$WEBSITE_PROJECT_ID"; do test "$project_id" != "$forbidden"; done

settings_payload="$(jq -n --arg root "$DELIVERY_ROOT_DIRECTORY" '{framework:"nextjs",rootDirectory:$root,nodeVersion:"24.x"}')"
status="$(curl --silent --show-error --output "$settings_json" --write-out '%{http_code}' \
  -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
  "https://api.vercel.com/v9/projects/$project_id?teamId=$VERCEL_ORG_ID" --data "$settings_payload")"
test "$status" = 200
test "$(jq -r '.rootDirectory' "$settings_json")" = "$DELIVERY_ROOT_DIRECTORY"
test "$(jq -r '.framework' "$settings_json")" = nextjs
test "$(jq -r '.nodeVersion' "$settings_json")" = '24.x'
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('delivery/web/vercel.json', 'utf8'));
if (config.git?.deploymentEnabled !== false) throw new Error('delivery_auto_deploy_not_locked');
NODE

# Keep the Delivery production binding canonical after the VPS cutover. Never derive it from Heroku.
env_body="$(jq -nc \
  --arg core "$CORE_API_INTERNAL_URL" \
  '[
    {key:"CORE_API_INTERNAL_URL",value:$core,type:"sensitive",target:["production"]},
    {key:"NEXT_PUBLIC_APP_LOGO_URL",value:"/logo-transparent.png",type:"sensitive",target:["production"]}
  ]')"
status="$(curl --silent --show-error --output "$RUNNER_TEMP/delivery-env-upsert.json" --write-out '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$env_body" \
  "https://api.vercel.com/v10/projects/$project_id/env?teamId=$VERCEL_ORG_ID&upsert=true")"
case "$status" in 200|201) ;; *) exit 1 ;; esac

env_metadata="$RUNNER_TEMP/delivery-env-metadata.json"
status="$(curl --silent --show-error --output "$env_metadata" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/$project_id/env?teamId=$VERCEL_ORG_ID")"
test "$status" = 200
ENV_METADATA="$env_metadata" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const payload = JSON.parse(readFileSync(process.env.ENV_METADATA, 'utf8'));
const envs = Array.isArray(payload.envs) ? payload.envs : [];
const matches = envs.filter((entry) => entry?.key === 'CORE_API_INTERNAL_URL' && Array.isArray(entry.target) && entry.target.includes('production'));
if (matches.length !== 1) throw new Error('delivery_company_api_production_binding_missing_or_ambiguous');
if (matches[0].type === 'plain') throw new Error('delivery_company_api_production_binding_must_not_be_plain');
NODE

lookup="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$project_id/domains/$DELIVERY_DOMAIN?teamId=$VERCEL_ORG_ID")"
if [ "$lookup" != 200 ]; then
  domain_body="${RUNNER_TEMP}/delivery-domain.json"
  status="$(curl --silent --show-error --output "$domain_body" --write-out '%{http_code}' \
    -X POST -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
    "https://api.vercel.com/v10/projects/$project_id/domains?teamId=$VERCEL_ORG_ID" \
    --data "{\"name\":\"$DELIVERY_DOMAIN\"}")"
  case "$status" in 200|201) ;; *) cat "$domain_body" >&2; exit 1 ;; esac
fi

mkdir -p .vercel
printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$project_id" > .vercel/project.json
npx --yes vercel@58.0.0 pull --yes --environment=production --token="$VERCEL_TOKEN" >/dev/null
test "$(jq -r '.projectId' .vercel/project.json)" = "$project_id"
test -s .vercel/.env.production.local

npm ci --ignore-scripts
(
  cd delivery/web
  npm run verify
)
npx --yes vercel@58.0.0 build --prod --token="$VERCEL_TOKEN"
deployment_url="$(npx --yes vercel@58.0.0 deploy --prebuilt --prod --token="$VERCEL_TOKEN")"
test -n "$deployment_url"

deployment_reachable=false
last_deployment_status=""
for attempt in $(seq 1 10); do
  last_deployment_status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output /dev/null --write-out '%{http_code}' "$deployment_url/login" || true)"
  case "$last_deployment_status" in 200|301|302|303|307|308|401|403) deployment_reachable=true; break ;; esac
  echo "Delivery deployment hostname not reachable yet: attempt=$attempt status=${last_deployment_status:-none}"
  sleep 3
done
test "$deployment_reachable" = true

smoke_url="https://$DELIVERY_DOMAIN"
domain_ready=false
for attempt in $(seq 1 12); do
  login_file="${RUNNER_TEMP}/delivery-login.html"
  unauth="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output /dev/null --write-out '%{http_code}' "$smoke_url/" || true)"
  login_code="$(curl --silent --show-error --connect-timeout 5 --max-time 15 -H 'Accept: text/html' --output "$login_file" --write-out '%{http_code}' "$smoke_url/login" || true)"
  if [ "$unauth" = 401 ] && [ "$login_code" = 200 ] && grep -Fq 'Welcome to Hung Phat Operations.' "$login_file"; then
    asset="$(grep -oE '/_next/static/[^" ]+\.(css|js)' "$login_file" | head -n 1)"
    if [ -n "$asset" ] && curl --fail --silent --show-error "$smoke_url$asset" >/dev/null; then domain_ready=true; break; fi
  fi
  echo "Delivery canonical domain not ready: attempt=$attempt root=$unauth login=$login_code"
  sleep 5
done
test "$domain_ready" = true

auth_me_status="$(curl --silent --show-error --connect-timeout 5 --max-time 20 --output /dev/null --write-out '%{http_code}' "$smoke_url/api/auth/me" || true)"
test "$auth_me_status" = 401

login_headers="$RUNNER_TEMP/delivery-auth-smoke-headers.txt"
login_status="$(curl --silent --show-error --connect-timeout 5 --max-time 20 \
  --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=__delivery_auth_smoke_never_exists__' \
  --data-urlencode 'password=not-a-real-password' \
  --data-urlencode 'returnTo=/' \
  --dump-header "$login_headers" \
  --output /dev/null \
  --write-out '%{http_code}' \
  "$smoke_url/api/auth/login" || true)"
test "$login_status" = 303
location="$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/^[^:]*:[[:space:]]*/,""); sub(/\r$/,""); print; exit}' "$login_headers")"
case "$location" in
  *error=invalid_credentials*) ;;
  *auth_unavailable*) echo 'delivery_company_auth_unavailable' >&2; exit 1 ;;
  *) echo 'unexpected_delivery_login_redirect' >&2; exit 1 ;;
esac

{
  echo "project_id=$project_id"
  echo "deployment_url=$deployment_url"
  echo "domain_ready=$domain_ready"
  echo "auth_source=company-workforce-session"
  echo "auth_connectivity=passed"
  echo "driver_ready=runtime-authorized"
  echo "setup_mode=false"
} >> "$GITHUB_OUTPUT"
