#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is required}"

RETAIL_PROJECT_NAME="${RETAIL_PROJECT_NAME:-npp-retail}"
RETAIL_ROOT_DIRECTORY="${RETAIL_ROOT_DIRECTORY:-retail/web}"
RETAIL_DOMAIN="${RETAIL_DOMAIN:-retail.nguyenlieuhungphat.com}"

for secret in "$VERCEL_TOKEN"; do echo "::add-mask::$secret"; done

project_json="${RUNNER_TEMP:-/tmp}/retail-project.json"
settings_json="${RUNNER_TEMP:-/tmp}/retail-settings.json"
setup_mode="existing"

status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$RETAIL_PROJECT_NAME?teamId=$VERCEL_ORG_ID")"

if [ "$status" = 404 ]; then
  setup_mode="created"
  payload="$(jq -n --arg name "$RETAIL_PROJECT_NAME" --arg root "$RETAIL_ROOT_DIRECTORY" '{name:$name,framework:"nextjs",rootDirectory:$root}')"
  status="$(curl --silent --show-error --output "$project_json" --write-out '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.vercel.com/v11/projects?teamId=$VERCEL_ORG_ID" \
    --data "$payload")"
fi

case "$status" in
  200|201) ;;
  *) cat "$project_json" >&2; exit 1 ;;
esac

project_id="$(jq -r '.id // empty' "$project_json")"
test -n "$project_id"

for forbidden in \
  prj_vFEAzoxesLqNJIfD8uF4q1kytpvk \
  prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux \
  prj_854SWdJeDEOPezAvvTZzTaRvZUSq \
  prj_btLk3p4FhmShgKFdRBMq6ZFOagKe \
  prj_0hp2A8WyUW4zgglShPTzL70hesVC \
  prj_rXqH83GFDHuEGUcQrrv82JBPWnjU; do
  test "$project_id" != "$forbidden"
done

settings_payload="$(jq -n --arg root "$RETAIL_ROOT_DIRECTORY" '{framework:"nextjs",rootDirectory:$root,nodeVersion:"20.x"}')"
status="$(curl --silent --show-error --output "$settings_json" --write-out '%{http_code}' \
  -X PATCH \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://api.vercel.com/v9/projects/$project_id?teamId=$VERCEL_ORG_ID" \
  --data "$settings_payload")"
test "$status" = 200
test "$(jq -r '.name' "$settings_json")" = "$RETAIL_PROJECT_NAME"
test "$(jq -r '.rootDirectory' "$settings_json")" = "$RETAIL_ROOT_DIRECTORY"
test "$(jq -r '.framework' "$settings_json")" = nextjs
test "$(jq -r '.nodeVersion' "$settings_json")" = '20.x'

node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('retail/web/vercel.json', 'utf8'));
if (config.git?.deploymentEnabled !== false) throw new Error('retail_auto_deploy_not_locked');
NODE

lookup="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$project_id/domains/$RETAIL_DOMAIN?teamId=$VERCEL_ORG_ID")"
if [ "$lookup" != 200 ]; then
  domain_body="${RUNNER_TEMP:-/tmp}/retail-domain.json"
  status="$(curl --silent --show-error --output "$domain_body" --write-out '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.vercel.com/v10/projects/$project_id/domains?teamId=$VERCEL_ORG_ID" \
    --data "{\"name\":\"$RETAIL_DOMAIN\"}")"
  case "$status" in 200|201) ;; *) cat "$domain_body" >&2; exit 1 ;; esac
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "project_id=$project_id"
    echo "setup_mode=$setup_mode"
    echo "domain=$RETAIL_DOMAIN"
  } >> "$GITHUB_OUTPUT"
fi

printf 'Retail Vercel project ready: name=%s root=%s auto_deploy=off setup=%s\n' \
  "$RETAIL_PROJECT_NAME" "$RETAIL_ROOT_DIRECTORY" "$setup_mode"
