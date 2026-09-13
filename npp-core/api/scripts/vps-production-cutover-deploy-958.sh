# sourced by vps-production-cutover-958.sh
# Deploy exact source onto both VPS runtimes while public business routes remain frozen.
deploy_company() {
  archive="$RUNNER_TEMP/company-source.tgz"; git archive --format=tar "$CUTOVER_SHA" package.json package-lock.json Procfile npp-core/api packages | gzip -9 > "$archive"
  scp_put "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" "$archive" "/tmp/npp-company-$CUTOVER_SHA.tgz"
  ssh_run "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" "bash -s -- '$CUTOVER_SHA'" <<'REMOTE'
set -euo pipefail
sha="$1"; root=/srv/npp/company; releases="$root/releases"; current="$root/current"; target="$releases/$sha"; archive="/tmp/npp-company-$sha.tgz"; previous="$(readlink -f "$current" 2>/dev/null || true)"
sudo -n test -f /etc/npp/company.env; sudo -n grep -q '/npp_production' /etc/npp/company.env; sudo -n grep -q 'npp_company_runtime' /etc/npp/company.env
sudo -n install -d -m 0755 "$target"; sudo -n tar -xzf "$archive" -C "$target"; rm -f "$archive"; sudo -n chown -R "$USER":"$(id -gn)" "$target"
(cd "$target" && npm ci --omit=dev --ignore-scripts --workspace npp-core-api && npm --workspace npp-core-api run build)
sudo -n chown -R npp-company:npp-company "$target"; sudo -n ln -sfn "$target" "$current"; sudo -n systemctl restart npp-company-api.service
for p in /health/live /health/ready; do for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:3104$p" >/dev/null && break; sleep 3; done; curl -fsS "http://127.0.0.1:3104$p" >/dev/null || { [ -z "$previous" ] || sudo -n ln -sfn "$previous" "$current"; sudo -n systemctl restart npp-company-api.service; exit 61; }; done
REMOTE
}
deploy_mcp() {
  archive="$RUNNER_TEMP/mcp-source.tgz"; git archive --format=tar "$CUTOVER_SHA" mcp/apps/backend packages/contracts | gzip -9 > "$archive"
  scp_put "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" "$archive" "/tmp/npp-mcp-$CUTOVER_SHA.tgz"
  ssh_run "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" "bash -s -- '$CUTOVER_SHA'" <<'REMOTE'
set -euo pipefail
sha="$1"; root=/srv/npp/mcp; releases="$root/releases"; current="$root/current"; release="$releases/$sha"; target="$release/mcp/apps/backend"; archive="/tmp/npp-mcp-$sha.tgz"; previous="$(readlink -f "$current" 2>/dev/null || true)"
verify_proxy(){ for s in ipv4-proxy ipv6-proxy oci-ipv6-pool; do test "$(systemctl is-active "$s")" = active; done; test "$(ss -lntH | awk '{n=split($4,a,":");p=a[n]+0;if(p>=3128&&p<=3427)c++}END{print c+0}')" = 300; }
verify_proxy; sudo -n test -f /etc/npp/mcp.env; sudo -n grep -q '/npp_production' /etc/npp/mcp.env; sudo -n grep -q 'MCP_DB_ROLE="mcp_runtime"' /etc/npp/mcp.env
sudo -n install -d -m 0755 "$release"; sudo -n tar -xzf "$archive" -C "$release"; rm -f "$archive"; sudo -n chown -R "$USER":"$(id -gn)" "$release"
(cd "$target" && npm ci --omit=dev --ignore-scripts); sudo -n chown -R npp-mcp:npp-mcp "$release"; sudo -n ln -sfnT "$target" "$current"; sudo -n systemctl restart npp-mcp-api.service
for p in /health/live /health/ready; do for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:3105$p" >/dev/null && break; sleep 3; done; curl -fsS "http://127.0.0.1:3105$p" >/dev/null || { [ -z "$previous" ] || sudo -n ln -sfnT "$previous" "$current"; sudo -n systemctl restart npp-mcp-api.service; verify_proxy; exit 62; }; done
verify_proxy
REMOTE
}
deploy_company
deploy_mcp
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$company_api_url/health/live" >/dev/null
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$mcp_api_url/health/live" >/dev/null

echo 'GATE_D_RUNTIME_HTTPS=PASS' >> "$REPORT_FILE"
