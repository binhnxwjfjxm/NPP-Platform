#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

RETAIL_PROJECT_NAME="${RETAIL_PROJECT_NAME:-npp-retail}"
RETAIL_ROOT_DIRECTORY="${RETAIL_ROOT_DIRECTORY:-retail/web}"
RETAIL_DOMAIN="${RETAIL_DOMAIN:-retail.nguyenlieuhungphat.com}"

echo "::add-mask::$VERCEL_TOKEN"

project_json="${RUNNER_TEMP}/retail-project.json"
status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$RETAIL_PROJECT_NAME?teamId=$VERCEL_ORG_ID")"
test "$status" = 200
project_id="$(jq -r '.id // empty' "$project_json")"
test -n "$project_id"
test "$VERCEL_PROJECT_ID" = "$project_id"
test "$(jq -r '.rootDirectory' "$project_json")" = "$RETAIL_ROOT_DIRECTORY"
test "$(jq -r '.framework' "$project_json")" = nextjs

# Configuration-only bootstrap; it must not deploy.
GITHUB_OUTPUT= bash retail/web/scripts/bootstrap-project.sh
runtime_readback_json="${RUNNER_TEMP}/retail-runtime-readback.json"
status="$(curl --silent --show-error --output "$runtime_readback_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$project_id?teamId=$VERCEL_ORG_ID")"
test "$status" = 200
test "$(jq -r '.id' "$runtime_readback_json")" = "$project_id"
test "$(jq -r '.name' "$runtime_readback_json")" = "$RETAIL_PROJECT_NAME"
test "$(jq -r '.rootDirectory' "$runtime_readback_json")" = "$RETAIL_ROOT_DIRECTORY"
test "$(jq -r '.framework' "$runtime_readback_json")" = nextjs
test "$(jq -r '.nodeVersion' "$runtime_readback_json")" = '24.x'

node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('retail/web/vercel.json', 'utf8'));
if (config.git?.deploymentEnabled !== false) throw new Error('retail_auto_deploy_not_locked');
NODE

# Provider target is owned by Vercel production configuration. The cutover stores
# CORE_API_INTERNAL_URL as a Sensitive value, so the deploy path must validate only
# its metadata here and let Vercel inject the value during the remote production build.
env_metadata_json="${RUNNER_TEMP}/retail-production-env-metadata.json"
status="$(curl --silent --show-error --output "$env_metadata_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/$project_id/env?teamId=$VERCEL_ORG_ID")"
test "$status" = 200
ENV_METADATA_JSON="$env_metadata_json" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const payload = JSON.parse(readFileSync(process.env.ENV_METADATA_JSON, 'utf8'));
const matches = (Array.isArray(payload.envs) ? payload.envs : []).filter((entry) => (
  entry?.key === 'CORE_API_INTERNAL_URL'
  && Array.isArray(entry.target)
  && entry.target.includes('production')
));
if (matches.length !== 1) throw new Error('retail_company_api_production_binding_missing_or_ambiguous');
if (matches[0].type === 'plain') throw new Error('retail_company_api_binding_must_not_be_plain');
NODE

mkdir -p .vercel
printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$project_id" > .vercel/project.json
test "$(jq -r '.projectId' .vercel/project.json)" = "$project_id"

(
  cd retail/web
  npm install --no-audit --no-fund
  npm run verify
)

# Do not prebuild locally: Sensitive production env values are intentionally not
# readable through `vercel pull`. A remote production build receives them inside Vercel.
deployment_url="$(npx --yes vercel@58.0.0 deploy --prod --yes --token="$VERCEL_TOKEN")"
test -n "$deployment_url"

smoke_url="https://$RETAIL_DOMAIN"
domain_ready=false
for attempt in $(seq 1 12); do
  page="${RUNNER_TEMP}/retail-home.html"
  code="$(curl --silent --show-error --location --connect-timeout 5 --max-time 15 -H 'Accept: text/html' --output "$page" --write-out '%{http_code}' "$smoke_url/" || true)"
  health="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output /dev/null --write-out '%{http_code}' "$smoke_url/api/health" || true)"
  company="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output /dev/null --write-out '%{http_code}' "$smoke_url/api/cong-ty/health" || true)"
  if [ "$code" = 200 ] && [ "$health" = 200 ] && [ "$company" = 200 ] && grep -Fq 'Bán tại quầy' "$page"; then
    asset="$(grep -oE '/_next/static/[^" ]+\.(css|js)' "$page" | head -n 1)"
    if [ -n "$asset" ] && curl --fail --silent --show-error "$smoke_url$asset" >/dev/null; then domain_ready=true; break; fi
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
