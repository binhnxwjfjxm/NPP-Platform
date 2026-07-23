# F0.2 — Deployment runbook

> Mục tiêu: triển khai Foundation Gateway mà không làm gián đoạn production.  
> Quy tắc: **đặt environment trước khi merge/pull code mới**.  
> Không commit hoặc gửi `BACKEND_API_TOKEN` vào GitHub, log, ảnh chụp hoặc chat công khai.

## Trạng thái trước khi chạy

```text
PR: #4
Branch: f0-2-installation-context-config
Code CI: pass
Production: vẫn đang chạy code main cũ
```

## Thứ tự bắt buộc

```text
1. VPS: tạo token và bổ sung env, chưa pull code.
2. Vercel: đặt cùng token và backend URL, chưa redeploy.
3. GitHub: merge PR #4 vào main.
4. VPS: chạy pullmcp.
5. VPS: verify process/ports/auth/CORS.
6. Vercel: production deploy main mới.
7. LOCAL hoặc VPS: chạy boundary smoke.
8. Chạy MCP v1 production smoke.
9. Chỉ khi tất cả pass mới đánh dấu F0.2 DEPLOYED/FROZEN.
```

---

# A. CẦN LÀM TRÊN VPS — trước khi merge

SSH:

```powershell
sssh -i "F:\1_A_Disk_D\khuong-binh\TK\DIGI-OCEAN\DO-backend-02\backend-DO-02" root@165.22.109.61
```

Vào backend và backup env:

```bash
cd /var/www/mcp-plan-backend
cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
chmod 600 .env
```

Tạo token 64 ký tự hex:

```bash
openssl rand -hex 32
```

Copy kết quả vào trình quản lý mật khẩu tạm thời để dùng **cùng một giá trị** ở VPS và Vercel.

Bổ sung/cập nhật `.env`:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
LEGACY_INTERNAL_PORT=3002

INSTALLATION_ID=mcp-plan-prod
NPP_CODE=MCP-PLAN
MCP_LEGACY_ACTOR_ID=service:mcp-plan:mcp-v1
AUTH_MODE=proxy-service
BACKEND_API_TOKEN=<TOKEN_VUA_TAO>

CORS_ORIGINS=https://mcp-plan.vercel.app,https://mcp-plan-nietz.vercel.app,https://mcp-plan-git-main-nietz.vercel.app
UPSTREAM_TIMEOUT_MS=65000

# Giữ nguyên giá trị production hiện có:
SUPABASE_URL=<GIU_NGUYEN>
SUPABASE_SERVICE_ROLE_KEY=<GIU_NGUYEN>
```

Không chạy `pullmcp` ở bước này. Code cũ chưa dùng các biến mới nên production vẫn hoạt động.

Kiểm tra không in secret:

```bash
node - <<'NODE'
const fs = require('fs');
const text = fs.readFileSync('/var/www/mcp-plan-backend/.env', 'utf8');
const names = [
  'NODE_ENV','HOST','PORT','LEGACY_INTERNAL_PORT','INSTALLATION_ID','NPP_CODE',
  'MCP_LEGACY_ACTOR_ID','AUTH_MODE','BACKEND_API_TOKEN','CORS_ORIGINS',
  'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'
];
const env = Object.fromEntries(text.split(/\r?\n/).filter(Boolean).filter(x => !x.trim().startsWith('#')).map(line => {
  const i = line.indexOf('=');
  return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}));
for (const name of names) console.log(`${name}=${env[name] ? 'SET' : 'MISSING'}`);
NODE
```

Mọi dòng phải là `SET`.

---

# B. CẦN LÀM TRÊN VERCEL — trước khi merge

Project:

```text
Team: Nietz
Project: mcp-plan
Production domain: https://mcp-plan.vercel.app
```

Vào **Settings → Environment Variables**, thêm/cập nhật cho `Production` và `Preview`:

```text
BACKEND_API_BASE_URL=http://165.22.109.61
BACKEND_API_TOKEN=<CÙNG TOKEN TRÊN VPS>
MCP_LEGACY_ACTOR_ID=service:mcp-plan:mcp-v1
SUPABASE_URL=<PROJECT URL HIỆN TẠI>
SUPABASE_ANON_KEY=<ANON KEY HIỆN TẠI>
```

Giữ nguyên nếu đang dùng:

```text
MCP_REPORT_AGENT_URL
MCP_REPORT_AGENT_TOKEN
```

Không đặt trên Vercel:

```text
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL production trực tiếp
```

Chưa redeploy ở bước này.

---

# C. GITHUB — sau khi VPS và Vercel env đều đã đặt

PR #4 phải còn CI xanh và mergeable.

Merge PR #4 bằng squash hoặc merge theo quy ước repository. Sau merge, xác nhận `main` chứa F0.2.

---

# D. CẦN PULL TRÊN VPS — ngay sau merge

`pullmcp` là lệnh production duy nhất cho backend MCP-Plan. Trước khi chạy, file `/var/www/mcp-plan-backend/.env` phải có `DATABASE_URL` production hợp lệ cùng `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, và installation id để runner có thể apply migration và gọi RPC capability check. Không copy hoặc in các secret này vào log/ticket.

```bash
pullmcp
```

Thứ tự an toàn bắt buộc của `pullmcp`:

1. fetch/reset `origin/main` vào source clone;
2. verify source tree;
3. preflight `.env` production và port trước downtime;
4. apply `supabase/migrations/*.sql` theo thứ tự filename vào database từ `DATABASE_URL`, ghi `public.mcp_schema_migrations` với filename/version, SHA-256 checksum, và `applied_at`;
5. fail nếu migration đã apply nhưng checksum khác, skip nếu checksum giống;
6. verify RPC `mcp_f05_archive_proof_capabilities` trả `targetScopedMediaClaim=true`, `targetScopedDeleteJobClaim=true`, `broadBatchClaimsForbidden=true`;
7. stage và atomic swap chỉ runtime `mcp-plan-backend`;
8. restart chỉ PM2 name `mcp-plan-backend`;
9. chạy health/auth/CORS smoke hiện hữu;
10. rollback runtime nếu deploy fail sau swap.

Không chạy thủ công `pm2 restart`, migration SQL, production smoke, hoặc đổi port để né lỗi trừ khi có runbook sự cố riêng. Nếu process fail, xem log và sửa đúng environment/config:

```bash
pm2 logs mcp-plan-backend --lines 100
```

Kiểm tra listener chỉ để quan sát, không kill process khác:

```bash
ss -lntp | grep -E ':3001|:3002'
```

Kỳ vọng:

```text
3001: Foundation Gateway, chỉ loopback/Nginx truy cập
3002: MCP legacy/milktea, không bị pullmcp restart hoặc modify
```

## VPS health/auth checks

Health public:

```bash
curl -i http://127.0.0.1:3001/api/health
```

Kỳ vọng `200`, có `X-Request-Id`, không có `installationId` hoặc `nppCode` trong body.

Business API thiếu token:

```bash
curl -i http://127.0.0.1:3001/api/routes
```

Kỳ vọng `401 backend_auth_required`.

Business API có token:

```bash
set -a
. /var/www/mcp-plan-backend/.env
set +a
curl -i \
  -H "X-Backend-Token: $BACKEND_API_TOKEN" \
  -H "X-Request-Id: vps_smoke_12345678" \
  http://127.0.0.1:3001/api/routes
```

Kỳ vọng `2xx`, response giữ `X-Request-Id: vps_smoke_12345678`.

---

# E. CẦN DEPLOY TRÊN VERCEL — sau khi VPS gateway pass

Redeploy `main` production từ Vercel hoặc chờ Git integration deploy commit merge.

Chỉ tiếp tục khi deployment state là `READY`.

---

# F. CẦN CHẠY TRÊN LOCAL HOẶC VPS — boundary smoke

Không ghi token trực tiếp vào history lâu dài.

PowerShell local:

```powershell
cd "F:\1_A_Disk_D\Tool\mcp-plan"
git pull origin main
$env:BACKEND_API_BASE_URL="http://165.22.109.61"
$env:BACKEND_API_TOKEN="<TOKEN_CÙNG_VPS_VERCEL>"
$env:F0_2_ALLOWED_ORIGIN="https://mcp-plan.vercel.app"
npm run smoke:f0-2-boundary
Remove-Item Env:BACKEND_API_TOKEN
```

Hoặc VPS:

```bash
cd /var/www/mcp-plan-backend
set -a
. ./.env
set +a
export BACKEND_API_BASE_URL=http://127.0.0.1:3001
export F0_2_ALLOWED_ORIGIN=https://mcp-plan.vercel.app
npm run smoke:f0-2-boundary
unset BACKEND_API_TOKEN
```

Kỳ vọng:

```json
{
  "ok": true,
  "checks": [
    "health_public_ok",
    "business_api_auth_required_ok",
    "cors_allowed_origin_ok",
    "cors_denied_origin_ok",
    "authorized_business_api_ok",
    "request_id_preserved_ok"
  ]
}
```

---

# G. MCP v1 production smoke

Chạy smoke MCP hiện có qua public boundary với token/config mới. Xác nhận:

```text
route/session read pass
open-session pass
second open-session không duplicate
status/order/test/report/follow-up pass
closed session mutation vẫn bị khóa
không có request nào gọi port 3002 từ bên ngoài
```

---

# H. Rollback

Nếu VPS gateway không start hoặc smoke fail trước Vercel deploy:

```bash
cd /var/www/mcp-plan-backend
cp <FILE_BACKUP_ENV> .env
# checkout/redeploy commit main trước F0.2 theo runbook hiện tại
pm2 restart mcp-plan-backend --update-env
```

Nếu Vercel mới lỗi nhưng VPS gateway khỏe:

```text
Rollback Vercel về deployment production READY trước đó.
Không xóa token/gateway env khỏi VPS cho đến khi điều tra xong.
```

Không rollback database vì F0.2 không có migration.

---

# I. Acceptance cuối

```text
[ ] VPS env đã backup
[ ] Token mạnh đã đặt giống nhau ở VPS/Vercel
[ ] Vercel không có service-role key
[ ] PR #4 đã merge
[ ] VPS đã chạy pullmcp
[ ] Backend verify pass
[ ] :3001 gateway hoạt động
[ ] :3002 chỉ loopback
[ ] Health 200 và không lộ installation identity
[ ] Thiếu token trả 401
[ ] Origin lạ trả 403
[ ] Boundary smoke pass
[ ] Vercel production READY
[ ] MCP v1 production smoke pass
```

Chỉ sau checklist này mới cập nhật:

```text
F0.2 DEPLOYMENT = COMPLETE
F0.2 = FROZEN
```
