#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${CORE_WEB_ADMIN_USERNAME:?CORE_WEB_ADMIN_USERNAME is required}"
: "${CORE_WEB_ADMIN_PASSWORD:?CORE_WEB_ADMIN_PASSWORD is required}"
: "${DELIVERY_WEB_USERS_JSON:?DELIVERY_WEB_USERS_JSON is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

test "$HEROKU_APP_NAME" = "hung-phat"

NPP_PRODUCTION_URL="${NPP_PRODUCTION_URL:-https://office.nguyenlieuhungphat.com}"
NPP_FALLBACK_URL="${NPP_FALLBACK_URL:-https://npp-platform.vercel.app}"
DELIVERY_PRODUCTION_URL="${DELIVERY_PRODUCTION_URL:-https://log.nguyenlieuhungphat.com}"
DUMMY_UUID="00000000-0000-4000-8000-000000000001"

for value in "$HEROKU_API_KEY" "$CORE_WEB_ADMIN_USERNAME" "$CORE_WEB_ADMIN_PASSWORD" "$DELIVERY_WEB_USERS_JSON"; do
  echo "::add-mask::$value"
done

app_json="$RUNNER_TEMP/phase-6e-core-app.json"
config_json="$RUNNER_TEMP/phase-6e-core-config.json"
response_file="$RUNNER_TEMP/phase-6e-response.json"
html_file="$RUNNER_TEMP/phase-6e-page.html"

curl --fail --silent --show-error \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  "https://api.heroku.com/apps/$HEROKU_APP_NAME" > "$app_json"
curl --fail --silent --show-error \
  -H 'Accept: application/vnd.heroku+json; version=3' \
  -H "Authorization: Bearer $HEROKU_API_KEY" \
  "https://api.heroku.com/apps/$HEROKU_APP_NAME/config-vars" > "$config_json"

core_url="$(jq -r '.web_url // empty' "$app_json")"
core_url="${core_url%/}"
backend_token="$(jq -r '.BACKEND_API_TOKEN // empty' "$config_json")"
delivery_token="$(jq -r '.DELIVERY_FRONTEND_API_TOKEN // empty' "$config_json")"
test -n "$core_url"
test -n "$backend_token"
test -n "$delivery_token"
for value in "$backend_token" "$delivery_token"; do echo "::add-mask::$value"; done

readarray -t delivery_identity < <(
  DELIVERY_USERS_JSON="$DELIVERY_WEB_USERS_JSON" node --input-type=module <<'NODE'
const users = JSON.parse(process.env.DELIVERY_USERS_JSON || 'null');
if (!Array.isArray(users) || users.length < 1) throw new Error('delivery_users_missing');
const user = users[0];
for (const key of ['username', 'password', 'employeeId']) {
  if (!String(user?.[key] || '').trim()) throw new Error(`delivery_user_missing_${key}`);
}
process.stdout.write(`${user.username}\n${user.password}\n${user.employeeId}\n`);
NODE
)
delivery_username="${delivery_identity[0]}"
delivery_password="${delivery_identity[1]}"
delivery_employee_id="${delivery_identity[2]}"
delivery_auth="$delivery_username:$delivery_password"
npp_auth="$CORE_WEB_ADMIN_USERNAME:$CORE_WEB_ADMIN_PASSWORD"
for value in "$delivery_username" "$delivery_password" "$delivery_employee_id" "$delivery_auth" "$npp_auth"; do
  echo "::add-mask::$value"
done

expect_status() {
  local label="$1"
  local expected="$2"
  local url="$3"
  shift 3
  local status
  status="$(curl --silent --show-error --connect-timeout 8 --max-time 30 --retry 4 --retry-delay 3 \
    --output "$response_file" --write-out '%{http_code}' "$@" "$url" || true)"
  if [ "$status" != "$expected" ]; then
    echo "$label failed: expected $expected, got ${status:-none}." >&2
    head -c 1000 "$response_file" >&2 || true
    echo >&2
    exit 1
  fi
}

expect_one_of() {
  local label="$1"
  local allowed="$2"
  local url="$3"
  shift 3
  local status
  status="$(curl --silent --show-error --connect-timeout 8 --max-time 30 --retry 4 --retry-delay 3 \
    --output "$response_file" --write-out '%{http_code}' "$@" "$url" || true)"
  case ",$allowed," in
    *",$status,"*) ;;
    *)
      echo "$label failed: expected one of $allowed, got ${status:-none}." >&2
      head -c 1000 "$response_file" >&2 || true
      echo >&2
      exit 1
      ;;
  esac
}

assert_json_data() {
  jq -e 'has("data") and (.requestId | type == "string")' "$response_file" >/dev/null
}

assert_json_error() {
  jq -e '.error.code | type == "string"' "$response_file" >/dev/null
}

# Core runtime and deny-by-default route registration.
expect_status 'Core live health' 200 "$core_url/health/live"
expect_status 'Core ready health' 200 "$core_url/health/ready"
for path in \
  '/api/logistics/routes?limit=1' \
  '/api/logistics/vehicles?limit=1' \
  '/api/logistics/drivers?limit=1' \
  '/api/logistics/trips?limit=1' \
  '/api/logistics/driver/trips?limit=1'; do
  expect_status "Core unauthenticated $path" 401 "$core_url$path"
  assert_json_error
done

# Dispatcher/bootstrap APIs must be live, not merely registered.
for path in \
  '/api/logistics/routes?limit=1' \
  '/api/logistics/vehicles?limit=1' \
  '/api/logistics/drivers?limit=1' \
  '/api/logistics/trips?limit=1&offset=0'; do
  expect_status "Core authenticated $path" 200 "$core_url$path" \
    -H "Authorization: Bearer $backend_token" \
    -H "x-request-id: phase-6e-smoke-${GITHUB_RUN_ID:-local}"
  assert_json_data
done

for path in \
  "/api/logistics/trips/$DUMMY_UUID/attempts" \
  "/api/logistics/trips/$DUMMY_UUID/reconciliation" \
  "/api/logistics/trips/$DUMMY_UUID/attempts/$DUMMY_UUID/pod"; do
  expect_status "Core dynamic capability $path" 404 "$core_url$path" \
    -H "Authorization: Bearer $backend_token" \
    -H "x-request-id: phase-6e-smoke-${GITHUB_RUN_ID:-local}"
  assert_json_error
done

expect_status 'Core driver trip list' 200 "$core_url/api/logistics/driver/trips?limit=1&offset=0" \
  -H "Authorization: Bearer $delivery_token" \
  -H "x-npp-delivery-employee-id: $delivery_employee_id" \
  -H "x-request-id: phase-6e-driver-smoke-${GITHUB_RUN_ID:-local}"
assert_json_data

expect_status 'Core optional POD driver route' 404 \
  "$core_url/api/logistics/driver/trips/$DUMMY_UUID/assignments/$DUMMY_UUID/attempts/$DUMMY_UUID/pod" \
  -H "Authorization: Bearer $delivery_token" \
  -H "x-npp-delivery-employee-id: $delivery_employee_id" \
  -H "x-request-id: phase-6e-pod-smoke-${GITHUB_RUN_ID:-local}"
assert_json_error

# NPP Operations live domain, fallback alias, pages and same-origin API.
for base_url in "$NPP_PRODUCTION_URL" "$NPP_FALLBACK_URL"; do
  base_url="${base_url%/}"
  expect_status "NPP unauthenticated logistics at $base_url" 401 "$base_url/logistics/trips"
  for path in \
    '/logistics/trips' \
    '/logistics/dispatch' \
    '/logistics/delivery-attempts' \
    '/logistics/trip-reconciliation'; do
    expect_status "NPP page $path at $base_url" 200 "$base_url$path" -u "$npp_auth"
  done
  for path in \
    '/api/logistics/routes?limit=1' \
    '/api/logistics/vehicles?limit=1' \
    '/api/logistics/drivers?limit=1' \
    '/api/logistics/trips?limit=1&offset=0'; do
    expect_status "NPP API $path at $base_url" 200 "$base_url$path" -u "$npp_auth"
    assert_json_data
  done
  curl --fail --silent --show-error --retry 4 --retry-delay 3 -u "$npp_auth" \
    "$base_url/logistics/trip-reconciliation" > "$html_file"
  grep -q 'Đối soát' "$html_file"
  css_asset="$(grep -oE '/_next/static/[^" ]+\.css' "$html_file" | head -n 1)"
  js_asset="$(grep -oE '/_next/static/[^" ]+\.js' "$html_file" | head -n 1)"
  test -n "$css_asset"
  test -n "$js_asset"
  curl --fail --silent --show-error "$base_url$css_asset" >/dev/null
  curl --fail --silent --show-error "$base_url$js_asset" >/dev/null
done

# Delivery PWA live domain and authenticated shell.
expect_status 'Delivery unauthenticated root' 401 "${DELIVERY_PRODUCTION_URL%/}/"
curl --fail --silent --show-error --retry 4 --retry-delay 3 -u "$delivery_auth" \
  "${DELIVERY_PRODUCTION_URL%/}/" > "$html_file"
grep -q 'Ứng dụng Giao hàng' "$html_file"
grep -q 'Chuyến của tôi' "$html_file"
grep -qv 'Không tải được chuyến' "$html_file"
css_asset="$(grep -oE '/_next/static/[^" ]+\.css' "$html_file" | head -n 1)"
js_asset="$(grep -oE '/_next/static/[^" ]+\.js' "$html_file" | head -n 1)"
test -n "$css_asset"
test -n "$js_asset"
curl --fail --silent --show-error "${DELIVERY_PRODUCTION_URL%/}$css_asset" >/dev/null
curl --fail --silent --show-error "${DELIVERY_PRODUCTION_URL%/}$js_asset" >/dev/null

r2_enabled="$(jq -r '.R2_ENABLED // "false"' "$config_json" | tr '[:upper:]' '[:lower:]')"
r2_complete=false
if [ "$r2_enabled" = true ]; then
  jq -e '
    (.R2_ENDPOINT // "" | length > 0) and
    (.R2_BUCKET // "" | length > 0) and
    (.R2_ACCESS_KEY_ID // "" | length > 0) and
    (.R2_SECRET_ACCESS_KEY // "" | length > 0)
  ' "$config_json" >/dev/null
  r2_complete=true
fi

{
  echo "PHASE_6E_PRODUCTION_SMOKE=success"
  echo "CORE_APP=$HEROKU_APP_NAME"
  echo "CORE_URL=$core_url"
  echo "NPP_PRIMARY_URL=${NPP_PRODUCTION_URL%/}"
  echo "NPP_FALLBACK_URL=${NPP_FALLBACK_URL%/}"
  echo "DELIVERY_URL=${DELIVERY_PRODUCTION_URL%/}"
  echo "CORE_LOGISTICS_API=success"
  echo "NPP_LOGISTICS_UI_API=success"
  echo "DELIVERY_DRIVER_UI_API=success"
  echo "POD_OPTIONAL_ROUTE=success"
  echo "R2_ENABLED=$r2_enabled"
  echo "R2_CONFIGURATION_COMPLETE=$r2_complete"
} >> "$GITHUB_STEP_SUMMARY"
