# Issue #958 — Production runtime & final cutover contract

> Trạng thái nguồn: contract cho đợt chuyển production cuối từ Heroku sang 3 VPS.
>
> Quyết định này **ưu tiên hơn** mọi đoạn tài liệu cũ còn mô tả Heroku là provider đích. Heroku chỉ còn là nguồn production trước cutover và điểm phục hồi có kiểm soát; không còn là kiến trúc đích sau Gate F.

## 1. Kiến trúc production đích

```text
7 frontend Vercel — giữ nguyên project/domain, Auto Deploy OFF
Cloudflare R2 — giữ nguyên

VPS DB      -> PostgreSQL 17, database npp_production
VPS Công Ty -> npp-company-api.service -> 127.0.0.1:3104 -> HTTPS công khai tin cậy
VPS MCP     -> npp-mcp-api.service     -> 127.0.0.1:3105 -> HTTPS công khai tin cậy
             + giữ nguyên proxy 3000 và 3128..3427
```

PostgreSQL là authority duy nhất cho cùng installation. Không có giai đoạn cho Heroku PostgreSQL và VPS PostgreSQL cùng nhận write production độc lập.

## 2. Database/runtime production

- Database production: `npp_production`.
- Runtime Công Ty: `npp_company_runtime`.
- Runtime MCP: `mcp_runtime`.
- Công Ty kết nối DB qua private network đã audit.
- MCP kết nối DB theo allowlist mạng thực tế đã audit; không mở 5432 toàn Internet.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` và `MCP_MIGRATION_DATABASE_URL` không được tồn tại trong MCP production runtime.
- Migrations vẫn thuộc source registry của repo. Final cutover không được tự tạo migration ngoài repo.

Rehearsal vẫn giữ nguyên database `npp_rehearsal_958` và các test roles. Không đổi tên rehearsal thành production và không dùng rehearsal làm authority.

## 3. Final backup và reconciliation

Final cutover tái sử dụng contract đối soát đã review trong `npp-core/api/scripts/vps-db-heroku-rehearsal-958.sh` nhưng chạy vào `npp_production` sau write-freeze.

Bắt buộc:

1. exact `origin/main` được khóa thành `CUTOVER_SHA`;
2. exact-head Foundation CI xanh;
3. cả hai Heroku web formations được đưa về `0` trước fresh backup;
4. migration registry không có pending Core/MCP trước final restore;
5. fresh backup Heroku được restore vào `npp_production`;
6. pre/post full reconciliation, migration no-op, constraints/index checks đều PASS;
7. một bản final dump thứ hai được ghi và HEAD-verify trên Cloudflare R2;
8. chỉ sau đó mới cài runtime production và chuyển frontend.

## 4. Production HTTPS

Hai backend VPS dùng HTTPS công khai với certificate tin cậy cho public IPv4. Certificate được cấp bằng ACME HTTP-01 và profile ngắn hạn, renewal chạy tự động bằng systemd timer; nginx reload sau renewal.

Trong lúc cutover:

- `/health/live` và `/health/ready` vẫn mở để kiểm tra;
- toàn bộ business route trả `503` cho đến khi database, backend và wiring frontend đều sẵn sàng;
- chỉ mở business ingress sau Gate E PASS.

Không dùng CA test `npp958-company.test` cho production. Không mang `NODE_EXTRA_CA_CERTS` test vào production runtime.

## 5. Wiring 7 frontend

| Frontend | Vercel project | Production binding sau cutover |
| --- | --- | --- |
| Công Ty | `npp-platform` | `CORE_API_INTERNAL_URL` + `NEXT_PUBLIC_CORE_API_URL` -> Công Ty VPS HTTPS |
| MCP Field | `mcp-field` | `CORE_API_INTERNAL_URL` -> Công Ty VPS HTTPS **và** `BACKEND_API_BASE_URL` -> MCP VPS HTTPS |
| Admin | `admin-mcp-npp` | `CORE_API_INTERNAL_URL` -> Công Ty VPS HTTPS |
| Delivery | `npp-delivery` | `CORE_API_INTERNAL_URL` -> Công Ty VPS HTTPS |
| Retail | `npp-retail` | `CORE_API_INTERNAL_URL` -> Công Ty VPS HTTPS |
| Customer Ordering | `customer-ordering` | `CORE_API_BASE_URL` -> Công Ty VPS HTTPS |
| Website | `nguyenlieuhungphat` | `COMPANY_API_URL` -> Công Ty VPS HTTPS cho ghi nhận AI và xác thực gateway Ordering |

MCP Field có **hai dependency độc lập**: đăng nhập/phiên nhân sự đi qua Công Ty, còn nghiệp vụ MCP đi qua backend MCP. Không được chỉ cấu hình một trong hai rồi coi frontend MCP đã hoàn tất cutover.

Mỗi binding cũ phải được đọc từ Vercel production trước mutation. Nếu fail trước lúc mở write, rollback phải trả đúng từng giá trị cũ, không giả định tất cả bằng cùng một URL Heroku.

Delivery và Retail production deploy **không được** gọi Heroku API để tự tìm lại Công Ty URL. MCP Field production deploy cũng **không được** gọi Heroku API để tự tìm lại Công Ty hoặc MCP URL; hai URL phải lấy từ provider VPS production đã khóa và `BACKEND_API_TOKEN` tiếp tục thuộc Vercel server-side secret store.

## 6. Manual-only final workflow

Final cutover chỉ chạy bằng comment chính xác trên GitHub Issue #5:

```text
/cutover-vps-production-958
```

Workflow: `.github/workflows/vps-production-cutover-manual.yml`.

Không có `push`, `pull_request` hay auto-deploy trigger cho production mutation. Workflow luôn checkout exact `main`, xác minh exact-head CI, chuẩn bị SSH bằng secrets và ghi evidence đã lọc secret về Issue #958.

## 7. Gate B -> F

- **Gate B — Preflight:** exact main/CI, 7 Vercel projects, 3 VPS, PostgreSQL 17, nginx/Node, proxy 300 listeners và production config nguồn đều xác minh được.
- **Gate C — Final DB:** write-freeze Heroku, fresh backup, restore `npp_production`, migration/reconciliation PASS, final dump R2 PASS.
- **Gate D — Runtime + HTTPS:** production roles/env, exact `CUTOVER_SHA` deploy lên 2 VPS, trusted HTTPS health PASS, proxy không suy giảm.
- **Gate E — Frontend wiring:** đủ 7 frontend được đối chiếu; mọi frontend có backend dependency đổi đúng binding và được redeploy, gồm Website `COMPANY_API_URL` -> Công Ty VPS.
- **Gate F — Authority proof:** business ingress mở, URL production thật smoke PASS, Heroku web formations vẫn `0`, VPS DB/runtime là authority, proxy 300 listeners còn nguyên.

## 8. Rollback boundary

### Fail trước khi mở write trên VPS

- business ingress VPS vẫn freeze;
- Vercel env trả về **đúng từng giá trị đã capture trước cutover** và redeploy;
- Heroku Công Ty/MCP trả về đúng formation quantity cũ;
- không công nhận DB VPS là production authority.

### Fail sau khi đã mở write trên VPS

- tự động freeze business ingress VPS lại;
- **không** restore ngược DB cũ và không tự bật Heroku writer;
- giữ dữ liệu mới trên `npp_production`, thực hiện forward-fix hoặc data-aware recovery theo evidence và quyết định owner.

Đây là ranh giới bắt buộc để không làm mất write mới phát sinh sau cutover.

## 9. Done-when

```text
GATE_B_PREFLIGHT=PASS
GATE_C_FINAL_DB=PASS
GATE_D_RUNTIME_HTTPS=PASS
GATE_E_FRONTEND_WIRING=PASS
GATE_F_AUTHORITY_PROOF=PASS
PRODUCTION_DB_CUTOVER=true
PRODUCTION_TRAFFIC_CUTOVER=true
HEROKU_COMPANY_WEB=0
HEROKU_MCP_WEB=0
PROXY_LISTENER_COUNT=300
```

Heroku chưa bị xóa trong cùng operation. Việc gỡ provider cũ là bước hậu kiểm riêng sau thời gian quan sát.