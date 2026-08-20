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

RETAIL_PROJECT_NAME="${RETAIL_PROJECT_NAME:-npp-retail}"
RETAIL_ROOT_DIRECTORY="${RETAIL_ROOT_DIRECTORY:-retail/web}"
RETAIL_DOMAIN="${RETAIL_DOMAIN:-retail.nguyenlieuhungphat.com}"
CORE_HEROKU_APP_NAME="${CORE_HEROKU_APP_NAME:-hung-phat}"

for secret in "$VERCEL_TOKEN" "$HEROKU_API_KEY"; do echo "::add-mask::$secret"; done

project_json="${RUNNER_TEMP}/retail-project.json"
status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$RETAIL_PROJECT_NAME?teamId=$VERCEL_ORG_ID")"
test "$status" = 200
project_id="$(jq -r '.id // empty' "$project_json")"
test -n "$project_id"
test "$(jq -r '.rootDirectory' "$project_json")" = "$RETAIL_ROOT_DIRECTORY"
test "$(jq -r '.framework' "$project_json")" = nextjs

node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('retail/web/vercel.json', 'utf8'));
if (config.git?.deploymentEnabled !== false) throw new Error('retail_auto_deploy_not_locked');
NODE

app_json="${RUNNER_TEMP}/core-app.json"
curl --fail --silent --show-error \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  "https://api.heroku.com/apps/$CORE_HEROKU_APP_NAME" > "$app_json"
core_url="$(jq -r '.web_url // empty' "$app_json")"
core_url="${core_url%/}"
test -n "$core_url"
CORE_URL="$core_url" node --input-type=module <<'NODE'
const url = new URL(process.env.CORE_URL);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_company_api_url');
NODE
echo "::add-mask::$core_url"
marker="RETAIL_CORE_API_${RANDOM}_${RANDOM}"
{
  echo "CORE_API_INTERNAL_URL<<$marker"
  echo "$core_url"
  echo "$marker"
} >> "$GITHUB_ENV"
export CORE_API_INTERNAL_URL="$core_url"

RETAIL_PROJECT_ID="$project_id" node --input-type=module <<'NODE'
const response = await fetch(`https://api.vercel.com/v10/projects/${process.env.RETAIL_PROJECT_ID}/env?teamId=${process.env.VERCEL_ORG_ID}&upsert=true`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([
    {
      key: 'CORE_API_INTERNAL_URL',
      value: process.env.CORE_API_INTERNAL_URL,
      type: 'sensitive',
      target: ['production'],
    },
  ]),
});
const payload = await response.json().catch(() => null);
if (!response.ok) throw new Error(`retail_env_upsert_failed:${response.status}:${payload?.error?.code || 'unknown'}`);
NODE

mkdir -p .vercel
printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$project_id" > .vercel/project.json
npx --yes vercel@58.0.0 pull --yes --environment=production --token="$VERCEL_TOKEN" >/dev/null
test "$(jq -r '.projectId' .vercel/project.json)" = "$project_id"

(
  cd retail/web
  npm install --no-audit --no-fund
  npm run verify
)

npx --yes vercel@58.0.0 build --prod --token="$VERCEL_TOKEN"
deployment_url="$(npx --yes vercel@58.0.0 deploy --prebuilt --prod --token="$VERCEL_TOKEN")"
test -n "$deployment_url"

smoke_url="https://$RETAIL_DOMAIN"
domain_ready=false
for attempt in $(seq 1 12); do
  page="${RUNNER_TEMP}/retail-home.html"
  code="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    -H 'Accept: text/html' --output "$page" --write-out '%{http_code}' "$smoke_url/" || true)"
  health="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out '%{http_code}' "$smoke_url/api/health" || true)"
  company="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out '%{http_code}' "$smoke_url/api/cong-ty/health" || true)"
  if [ "$code" = 200 ] && [ "$health" = 200 ] && [ "$company" = 200 ] && grep -Fq 'Bán tại quầy' "$page"; then
    asset="$(grep -oE '/_next/static/[^" ]+\.(css|js)' "$page" | head -n 1)"
    if [ -n "$asset" ] && curl --fail --silent --show-error "$smoke_url$asset" >/dev/null; then
      domain_ready=true
      break
    fi
  fi
  echo "Retail canonical domain not ready: attempt=$attempt root=$code health=$health company=$company"
  sleep 5
done
test "$domain_ready" = true

{
  echo "project_id=$project_id"
  echo "deployment_url=$deployment_url"
  echo "domain_ready=$domain_ready"
} >> "$GITHUB_OUTPUT"
