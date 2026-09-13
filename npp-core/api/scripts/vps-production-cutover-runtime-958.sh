# sourced by vps-production-cutover-958.sh
# Build production runtime env files from existing production config, changing provider-only values.
COMPANY_PW="$company_pw" MCP_PW="$mcp_pw" DB_PRIVATE_IP="$db_private_ip" DB_PUBLIC_HOST="$VPS_DB_HOST" COMPANY_API_URL="$company_api_url" \
COMPANY_CFG="$company_cfg" MCP_CFG="$mcp_cfg" COMPANY_ENV="$company_env" MCP_ENV="$mcp_env" \
node <<'NODE'
const fs=require('node:fs');
const company=JSON.parse(fs.readFileSync(process.env.COMPANY_CFG,'utf8'));
const mcp=JSON.parse(fs.readFileSync(process.env.MCP_CFG,'utf8'));
function envText(values){return Object.keys(values).sort().map(k=>{const v=String(values[k]??'');if(!/^[A-Z_][A-Z0-9_]*$/.test(k)||/[\r\n]/.test(v))throw new Error('invalid_env');return `${k}="${v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;}).join('\n')+'\n';}
Object.assign(company,{NODE_ENV:'production',HOST:'127.0.0.1',PORT:'3104',DATABASE_URL:`postgresql://npp_company_runtime:${process.env.COMPANY_PW}@${process.env.DB_PRIVATE_IP}:5432/npp_production`,DATABASE_SSL_MODE:'require'});
for(const k of ['DATABASE_URL','HOST','PORT','LEGACY_INTERNAL_PORT','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','MCP_MIGRATION_DATABASE_URL','NODE_EXTRA_CA_CERTS']) delete mcp[k];
Object.assign(mcp,{NODE_ENV:'production',HOST:'127.0.0.1',PORT:'3105',LEGACY_INTERNAL_PORT:'3106',PERSISTENCE_PROVIDER:'postgresql',DATABASE_URL:`postgresql://mcp_runtime:${process.env.MCP_PW}@${process.env.DB_PUBLIC_HOST}:5432/npp_production`,MCP_DB_SCHEMA:'mcp',MCP_DB_ROLE:'mcp_runtime',MCP_LEGACY_RUNTIME_ENABLED:'false',CORE_SALES_API_BASE_URL:process.env.COMPANY_API_URL,CORE_ONBOARDING_API_BASE_URL:process.env.COMPANY_API_URL});
fs.writeFileSync(process.env.COMPANY_ENV,envText(company),{mode:0o600});
fs.writeFileSync(process.env.MCP_ENV,envText(mcp),{mode:0o600});
NODE

scp_put "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" "$company_env" /tmp/npp-company-production.env
ssh_run "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" 'sudo -n install -d -m 0755 /etc/npp; sudo -n install -o root -g npp-company -m 0640 /tmp/npp-company-production.env /etc/npp/company.env; rm -f /tmp/npp-company-production.env; sudo -n grep -q "/npp_production" /etc/npp/company.env; sudo -n grep -q "npp_company_runtime" /etc/npp/company.env'
scp_put "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" "$mcp_env" /tmp/npp-mcp-production.env
ssh_run "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" 'sudo -n install -d -m 0755 /etc/npp; sudo -n install -o root -g npp-mcp -m 0640 /tmp/npp-mcp-production.env /etc/npp/mcp.env; rm -f /tmp/npp-mcp-production.env; sudo -n grep -q "/npp_production" /etc/npp/mcp.env; sudo -n grep -q "MCP_DB_ROLE=\"mcp_runtime\"" /etc/npp/mcp.env; ! sudo -n grep -Eq "^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|MCP_MIGRATION_DATABASE_URL|NODE_EXTRA_CA_CERTS)=" /etc/npp/mcp.env'

install_https_freeze() {
  local key="$1" known="$2" host="$3" public_ip="$4" port="$5" site="$6" proxy_guard="$7"
  ssh_run "$key" "$known" "$host" "bash -s -- '$public_ip' '$port' '$site' '$proxy_guard'" <<'REMOTE'
set -euo pipefail
ip="$1"; app_port="$2"; site="$3"; proxy_guard="$4"
sudo -n true
verify_proxy(){ [ "$proxy_guard" != yes ] || { for s in ipv4-proxy ipv6-proxy oci-ipv6-pool; do test "$(systemctl is-active "$s")" = active; done; test "$(ss -lntH | awk '{n=split($4,a,":");p=a[n]+0;if(p>=3128&&p<=3427)c++}END{print c+0}')" = 300; }; }
verify_proxy
sudo -n apt-get update -y >/dev/null
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y nginx python3-venv >/dev/null
if [ ! -x /opt/npp-certbot/bin/certbot ]; then sudo -n python3 -m venv /opt/npp-certbot; sudo -n /opt/npp-certbot/bin/pip install -q 'certbot>=5.4,<6'; fi
sudo -n install -d -m 0755 /var/www/npp-acme/.well-known/acme-challenge
http="$(mktemp)"; cat > "$http" <<EOF2
server { listen 80; listen [::]:80; server_name $ip; location /.well-known/acme-challenge/ { root /var/www/npp-acme; } location / { return 503; } }
EOF2
sudo -n install -m 0644 "$http" /etc/nginx/sites-available/npp-acme.conf; rm -f "$http"
sudo -n ln -sfn /etc/nginx/sites-available/npp-acme.conf /etc/nginx/sites-enabled/npp-acme.conf
sudo -n ufw allow 80/tcp >/dev/null; sudo -n ufw allow 443/tcp >/dev/null; sudo -n ufw --force enable >/dev/null
sudo -n nginx -t >/dev/null; sudo -n systemctl enable --now nginx >/dev/null; sudo -n systemctl reload nginx

cert="/etc/letsencrypt/live/$site/fullchain.pem"
pkey="/etc/letsencrypt/live/$site/privkey.pem"
cert_reusable=no
if sudo -n test -s "$cert" && sudo -n test -s "$pkey"; then
  if sudo -n openssl x509 -checkend 43200 -noout -in "$cert" >/dev/null 2>&1 \
    && sudo -n openssl x509 -noout -ext subjectAltName -in "$cert" 2>/dev/null | grep -Fq "IP Address:$ip"; then
    cert_reusable=yes
  fi
fi

# A retry must reuse a healthy owned certificate rather than invoke Certbot again. If a
# certificate really must be issued/renewed, pause only the NPP renewal timer and wait for
# its oneshot to finish. A legacy/snap Certbot job can still briefly hold Certbot's global
# lock, so retry only that exact lock condition; all other Certbot failures remain fatal.
renew_timer_was_active=no
restore_renew_timer() {
  if [ "$renew_timer_was_active" = yes ]; then sudo -n systemctl start npp-ip-cert-renew.timer >/dev/null 2>&1 || true; fi
}
if [ "$cert_reusable" != yes ]; then
  if systemctl is-active --quiet npp-ip-cert-renew.timer 2>/dev/null; then
    renew_timer_was_active=yes
    sudo -n systemctl stop npp-ip-cert-renew.timer
  fi
  trap restore_renew_timer EXIT
  for _ in $(seq 1 60); do
    if ! systemctl is-active --quiet npp-ip-cert-renew.service 2>/dev/null; then break; fi
    sleep 1
  done
  if systemctl is-active --quiet npp-ip-cert-renew.service 2>/dev/null; then
    echo npp_certbot_renew_still_active >&2
    exit 53
  fi

  certbot_err="$(mktemp)"
  certbot_ok=no
  for attempt in 1 2 3 4; do
    : > "$certbot_err"
    if sudo -n /opt/npp-certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --preferred-profile shortlived --webroot --webroot-path /var/www/npp-acme --ip-address "$ip" --cert-name "$site" --keep-until-expiring >/dev/null 2>"$certbot_err"; then
      certbot_ok=yes
      break
    fi
    if grep -Fq 'Another instance of Certbot is already running.' "$certbot_err" && [ "$attempt" -lt 4 ]; then
      sleep 5
      continue
    fi
    cat "$certbot_err" >&2
    rm -f "$certbot_err"
    exit 54
  done
  rm -f "$certbot_err"
  test "$certbot_ok" = yes
fi
sudo -n test -s "$cert"; sudo -n test -s "$pkey"

conf="$(mktemp)"; cat > "$conf" <<EOF2
server {
  listen 443 ssl default_server;
  listen [::]:443 ssl default_server;
  server_name _;
  ssl_certificate $cert;
  ssl_certificate_key $pkey;
  ssl_protocols TLSv1.2 TLSv1.3;
  location = /health/live { proxy_pass http://127.0.0.1:${app_port}/health/live; proxy_set_header X-Forwarded-Proto https; }
  location = /health/ready { proxy_pass http://127.0.0.1:${app_port}/health/ready; proxy_set_header X-Forwarded-Proto https; }
  location / { # NPP958 CUTOVER FREEZE
    return 503;
  }
}
EOF2
sudo -n install -m 0644 "$conf" "/etc/nginx/sites-available/$site.conf"; rm -f "$conf"
# Remove only the known Issue #958 test endpoint. Never delete unrelated nginx sites.
sudo -n rm -f /etc/nginx/sites-enabled/npp958-company-test.conf

# Make the HTTPS install idempotent. A prior interrupted cutover can leave this exact
# production site enabled; remove its symlink from the candidate set before checking for
# unrelated default 443 listeners, then recreate it below. On MCP, the audited Ubuntu
# `default` symlink is the only old 443 default and is not part of the proxy runtime; retire
# only that exact symlink, preserving its source file and proving the 300 proxy listeners
# before and after. Any other default 443 listener remains a hard blocker.
own_enabled="/etc/nginx/sites-enabled/$site.conf"
own_target="/etc/nginx/sites-available/$site.conf"
own_was_enabled=no
if [ -L "$own_enabled" ]; then
  test "$(readlink -f "$own_enabled")" = "$own_target"
  sudo -n rm "$own_enabled"
  own_was_enabled=yes
elif [ -e "$own_enabled" ]; then
  echo unexpected_existing_production_site >&2
  exit 50
fi

default_disabled=no
default_target=""
if [ "$proxy_guard" = yes ] && [ -L /etc/nginx/sites-enabled/default ]; then
  default_target="$(readlink -f /etc/nginx/sites-enabled/default)"
  test "$default_target" = /etc/nginx/sites-available/default
  sudo -n rm /etc/nginx/sites-enabled/default
  default_disabled=yes
  verify_proxy
fi

restore_previous_sites() {
  if [ "$own_was_enabled" = yes ]; then sudo -n ln -sfn "$own_target" "$own_enabled"; fi
  if [ "$default_disabled" = yes ]; then sudo -n ln -sfn "$default_target" /etc/nginx/sites-enabled/default; fi
}

if sudo -n nginx -T 2>/dev/null | grep -E '^[[:space:]]*listen[[:space:]]+.*443.*default_server' | grep -q .; then
  restore_previous_sites
  echo unexpected_existing_default_443 >&2
  exit 51
fi

sudo -n ln -sfn "$own_target" "$own_enabled"
if ! sudo -n nginx -t >/dev/null 2>&1; then
  sudo -n rm -f "$own_enabled"
  restore_previous_sites
  echo production_nginx_validation_failed >&2
  exit 52
fi
sudo -n systemctl reload nginx
verify_proxy
sudo -n tee /usr/local/sbin/npp-certbot-nginx-reload >/dev/null <<'EOF2'
#!/bin/sh
set -eu
/usr/bin/systemctl reload nginx
EOF2
sudo -n chmod 0755 /usr/local/sbin/npp-certbot-nginx-reload
sudo -n tee /etc/systemd/system/npp-ip-cert-renew.service >/dev/null <<EOF2
[Unit]
Description=Renew NPP short-lived IP certificate
[Service]
Type=oneshot
ExecStart=/opt/npp-certbot/bin/certbot renew --quiet --cert-name $site --deploy-hook /usr/local/sbin/npp-certbot-nginx-reload
EOF2
sudo -n tee /etc/systemd/system/npp-ip-cert-renew.timer >/dev/null <<'EOF2'
[Unit]
Description=Renew NPP short-lived IP certificate regularly
[Timer]
OnCalendar=*-*-* 00/4:17:00
Persistent=true
RandomizedDelaySec=900
[Install]
WantedBy=timers.target
EOF2
sudo -n systemctl daemon-reload; sudo -n systemctl enable --now npp-ip-cert-renew.timer >/dev/null
renew_timer_was_active=no
trap - EXIT
verify_proxy
REMOTE
}
install_https_freeze "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" "$company_public_ip" 3104 npp-company-production no
install_https_freeze "$MCP_KEY" "$MCP_KNOWN" "$VPS_MCP_HOST" "$mcp_public_ip" 3105 npp-mcp-production yes
