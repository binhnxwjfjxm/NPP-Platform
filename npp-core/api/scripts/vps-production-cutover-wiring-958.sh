# sourced by vps-production-cutover-958.sh
upsert_env() {
  local pid="$1" key="$2" value="$3"
  body="$(jq -nc --arg k "$key" --arg v "$value" '[{key:$k,value:$v,type:"sensitive",target:["production"]}]')"
  vercel_api "/v10/projects/$pid/env?teamId=$VERCEL_TEAM&upsert=true" POST "$body" >/dev/null
}
latest_prod_url() {
  local pid="$1" raw
  raw="$(vercel_api "/v6/deployments?projectId=$pid&target=production&state=READY&limit=1&teamId=$VERCEL_TEAM" | jq -r '.deployments[0].url // empty')"
  test -n "$raw"
  printf 'https://%s\n' "$raw"
}
redeploy_project() {
  local pid="$1" name="$2" old_url
  old_url="$(latest_prod_url "$pid")"; test -n "$old_url"; printf '%s\t%s\t%s\n' "$pid" "$name" "$old_url" >> "$vercel_state"
  npx --yes vercel@58.0.0 redeploy "$old_url" --yes --token="$VERCEL_TOKEN" >/dev/null
}
restore_vercel_bindings() {
  upsert_env "$PROJECT_COMPANY" CORE_API_INTERNAL_URL "$old_company_internal"
  upsert_env "$PROJECT_COMPANY" NEXT_PUBLIC_CORE_API_URL "$old_company_public"
  upsert_env "$PROJECT_ADMIN" CORE_API_INTERNAL_URL "$old_admin_core"
  upsert_env "$PROJECT_DELIVERY" CORE_API_INTERNAL_URL "$old_delivery_core"
  upsert_env "$PROJECT_RETAIL" CORE_API_INTERNAL_URL "$old_retail_core"
  upsert_env "$PROJECT_ORDERING" CORE_API_BASE_URL "$old_ordering_core"
  upsert_env "$PROJECT_MCP" BACKEND_API_BASE_URL "$old_mcp_backend"
  while IFS=$'\t' read -r pid name url; do [ -z "$pid" ] || npx --yes vercel@58.0.0 redeploy "$url" --yes --token="$VERCEL_TOKEN" >/dev/null || true; done < "$vercel_state"
}

# Gate E: wire every backend-consuming frontend; Website is explicitly unchanged because it has no backend binding contract.
upsert_env "$PROJECT_COMPANY" CORE_API_INTERNAL_URL "$company_api_url"
upsert_env "$PROJECT_COMPANY" NEXT_PUBLIC_CORE_API_URL "$company_api_url"
upsert_env "$PROJECT_ADMIN" CORE_API_INTERNAL_URL "$company_api_url"
upsert_env "$PROJECT_DELIVERY" CORE_API_INTERNAL_URL "$company_api_url"
upsert_env "$PROJECT_RETAIL" CORE_API_INTERNAL_URL "$company_api_url"
upsert_env "$PROJECT_ORDERING" CORE_API_BASE_URL "$company_api_url"
upsert_env "$PROJECT_MCP" BACKEND_API_BASE_URL "$mcp_api_url"
vercel_mutated=true
for spec in "$PROJECT_COMPANY:npp-platform" "$PROJECT_ADMIN:admin-mcp-npp" "$PROJECT_DELIVERY:npp-delivery" "$PROJECT_RETAIL:npp-retail" "$PROJECT_ORDERING:customer-ordering" "$PROJECT_MCP:mcp-field"; do
  redeploy_project "${spec%%:*}" "${spec#*:}"
done

echo 'WEBSITE_BACKEND_BINDING=not_applicable' >> "$REPORT_FILE"
echo 'GATE_E_FRONTEND_WIRING=PASS' >> "$REPORT_FILE"

set_ingress_mode() {
  local mode="$1"
  for tuple in "$COMPANY_KEY|$COMPANY_KNOWN|$VPS_COMPANY_HOST|3104|npp-company-production|no" "$MCP_KEY|$MCP_KNOWN|$VPS_MCP_HOST|3105|npp-mcp-production|yes"; do
    IFS='|' read -r key known host port site guard <<< "$tuple"
    ssh_run "$key" "$known" "$host" "bash -s -- '$mode' '$port' '$site' '$guard'" <<'REMOTE'
set -euo pipefail
mode="$1"; port="$2"; site="$3"; guard="$4"; cert="/etc/letsencrypt/live/$site/fullchain.pem"; pkey="/etc/letsencrypt/live/$site/privkey.pem"
verify_proxy(){ [ "$guard" != yes ] || { for s in ipv4-proxy ipv6-proxy oci-ipv6-pool; do test "$(systemctl is-active "$s")" = active; done; test "$(ss -lntH | awk '{n=split($4,a,":");p=a[n]+0;if(p>=3128&&p<=3427)c++}END{print c+0}')" = 300; }; }
case "$mode" in freeze) body='return 503;' ;; open) body="proxy_pass http://127.0.0.1:${port}; proxy_http_version 1.1; proxy_set_header Host \\$host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;" ;; *) exit 70;; esac
conf="$(mktemp)"; cat > "$conf" <<EOF2
server {
 listen 443 ssl default_server; listen [::]:443 ssl default_server; server_name _;
 ssl_certificate $cert; ssl_certificate_key $pkey; ssl_protocols TLSv1.2 TLSv1.3;
 location = /health/live { proxy_pass http://127.0.0.1:${port}/health/live; proxy_set_header X-Forwarded-Proto https; }
 location = /health/ready { proxy_pass http://127.0.0.1:${port}/health/ready; proxy_set_header X-Forwarded-Proto https; }
 location / { $body }
}
EOF2
sudo -n install -m 0644 "$conf" "/etc/nginx/sites-available/$site.conf"; rm -f "$conf"; sudo -n nginx -t >/dev/null; sudo -n systemctl reload nginx; verify_proxy
REMOTE
  done
}

# Open both VPS APIs only after every frontend is rebuilt against the new provider URLs.
set_ingress_mode open
opened_writes=true

assert_status() {
  local url="$1"; shift
  local deadline=$((SECONDS+180)) code=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    code="$(curl --silent --show-error --location --connect-timeout 5 --max-time 20 --output /dev/null --write-out '%{http_code}' "$url" || true)"
    for x in "$@"; do [ "$code" = "$x" ] && return 0; done
    sleep 5
  done
  echo "unexpected_status url=$url status=${code:-none}" >&2
  return 1
}
assert_status "$company_api_url/health/live" 200
assert_status "$company_api_url/health/ready" 200
assert_status "$company_api_url/api/customers" 401
assert_status "$mcp_api_url/health/live" 200
assert_status "$mcp_api_url/health/ready" 200
assert_status 'https://office.nguyenlieuhungphat.com/login' 200
assert_status 'https://admin.nguyenlieuhungphat.com/' 200 302 307 401
assert_status 'https://log.nguyenlieuhungphat.com/login' 200
assert_status 'https://retail.nguyenlieuhungphat.com/' 200
assert_status 'https://mcp.nguyenlieuhungphat.com/' 200 302 307 401
assert_status 'https://sales.nguyenlieuhungphat.com/' 200 302 307 401
assert_status 'https://nguyenlieuhungphat.com/' 200

# Gate F: prove authority after cutover. Heroku stays available for recovery but has no web writers.
test "$(formation_quantity "$HEROKU_COMPANY_APP")" = 0
test "$(formation_quantity "$HEROKU_MCP_APP")" = 0
ssh_run "$DB_KEY" "$DB_KNOWN" "$VPS_DB_HOST" "sudo -n -u postgres psql -XAtqc \"select 1 from pg_database where datname='$PRODUCTION_DB'\" | grep -qx 1"
ssh_run "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" "sudo -n grep -q '/$PRODUCTION_DB' /etc/npp/company.env; test \"\$(systemctl is-active npp-company-api.service)\" = active"
ssh_run "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" "sudo -n grep -q '/$PRODUCTION_DB' /etc/npp/mcp.env; test \"\$(systemctl is-active npp-mcp-api.service)\" = active; test \"\$(ss -lntH | awk '{n=split(\$4,a,\":\");p=a[n]+0;if(p>=3128&&p<=3427)c++}END{print c+0}')\" = 300"

echo 'GATE_F_AUTHORITY_PROOF=PASS' >> "$REPORT_FILE"
echo 'PRODUCTION_DB_CUTOVER=true' >> "$REPORT_FILE"
echo 'PRODUCTION_TRAFFIC_CUTOVER=true' >> "$REPORT_FILE"
echo 'HEROKU_COMPANY_WEB=0' >> "$REPORT_FILE"
echo 'HEROKU_MCP_WEB=0' >> "$REPORT_FILE"
echo 'PRODUCTION_DB=npp_production' >> "$REPORT_FILE"
echo 'COMPANY_HTTPS=public_trusted_ip_certificate' >> "$REPORT_FILE"
echo 'MCP_HTTPS=public_trusted_ip_certificate' >> "$REPORT_FILE"
echo 'PROXY_LISTENER_COUNT=300' >> "$REPORT_FILE"
trap - EXIT
