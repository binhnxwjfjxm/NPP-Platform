# VPS Production Runtime Manifest — Issue #958

> Status: SOURCE AUDIT BASELINE — PROVIDER/VPS VALUES PENDING READ-ONLY AUDIT  
> Captured: 2026-09-12  
> NPP-Platform baseline: `609a66ca54737ea458023fb19a8a18c7588c67a1`  
> Website/Customer Ordering baseline: `e42fb166ef15e38217d990dbe5ed92ff6c5dd4c6`  
> Issue: #958  
> Branch: `agent/vps-runtime-manifest-958`

## 1. Mục tiêu

Tài liệu này là manifest **tên biến + dây kết nối + nơi dùng + hành động khi chuyển VPS**. Không lưu secret value, password, token value, private key hoặc `DATABASE_URL` value.

Kiến trúc đích owner đã khóa:

```text
7 frontend Vercel giữ nguyên
Cloudflare R2 giữ nguyên

VPS 1 — PostgreSQL production duy nhất
VPS 2 — Công Ty API
VPS 3 — proxy hiện có + MCP API
```

MongoDB/MongoDB Atlas không thuộc đường dữ liệu production của cutover này.

## 2. Quy ước trạng thái

- `SOURCE_REQUIRED`: source bắt buộc trong runtime tương ứng.
- `SOURCE_CONDITIONAL`: chỉ bắt buộc khi feature được bật/cấu hình.
- `SOURCE_DEFAULTED`: source có default nhưng production vẫn phải audit giá trị thực tế.
- `FRONTEND_SERVER_ONLY`: nằm ở Vercel/server route, không được lộ browser.
- `BROWSER_PUBLIC`: được phép xuất hiện phía browser.
- `TEST_ONLY`: không được mang sang production chỉ vì có trong `.env.example`/CI.
- `RETIRED_CANDIDATE`: source hiện tại đã bỏ hoặc thay đường dùng; provider audit phải xác nhận trước khi xóa.
- `FORBIDDEN_RUNTIME`: không được tồn tại ở runtime production.
- `PROVIDER_UNKNOWN`: source đã biết nhưng presence/value tại provider chưa được audit lại.
- `VPS_UNKNOWN`: chưa audit 3 VPS.

Mọi dòng production bắt buộc còn `PROVIDER_UNKNOWN` hoặc `VPS_UNKNOWN` tại gate cutover phải fail closed.

---

## 3. Công Ty API — VPS 2

### 3.1 Runtime nền

| Tên | Phân loại | Đích | Hành động | Kiểm |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | SOURCE_DEFAULTED | VPS 2 | CHANGE/VERIFY | startup + public config |
| `HOST` | SOURCE_DEFAULTED | VPS 2 | CHANGE/VERIFY | bind/listen + reverse proxy |
| `PORT` | SOURCE_DEFAULTED | VPS 2 | CHANGE/VERIFY | listen + health |
| `INSTALLATION_ID` | SOURCE_REQUIRED | VPS 2 | KEEP | `/health/ready` + config identity |
| `DATABASE_URL` | SOURCE_REQUIRED/SECRET | VPS 2 | CHANGE | DB connect + readiness |
| `DATABASE_SSL_MODE` | SOURCE_DEFAULTED | VPS 2 | CHANGE/VERIFY theo network thật | DB connect |
| `BACKEND_API_TOKEN` | SOURCE_REQUIRED/SECRET | VPS 2 | KEEP/ROTATE only if planned | authenticated API smoke |
| `CORE_BOOTSTRAP_ACTOR_ID` | SOURCE_REQUIRED | VPS 2 | KEEP | config/auth smoke |
| `CORS_ORIGINS` | SOURCE_REQUIRED in production | VPS 2 | VERIFY/CHANGE | CORS smoke từ domain thật |

### 3.2 MCP -> Công Ty integration

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `MCP_ONBOARDING_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| `MCP_ONBOARDING_ACTOR_ID` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `MCP_SALES_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| `MCP_SALES_ACTOR_ID` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `MCP_SALES_WAREHOUSE_IDS` | SOURCE_CONDITIONAL | VPS 2 | KEEP/VERIFY UUID scope |

Token onboarding, sales và backend token không được reuse sai contract.

### 3.3 Website / Customer Ordering / Delivery capability

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `WEBSITE_AI_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| `WEBSITE_AI_ACTOR_ID` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `ORDERING_AI_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| `ORDERING_AI_ACTOR_ID` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `DELIVERY_FRONTEND_API_TOKEN` | SOURCE_CONDITIONAL/legacy-compatible | VPS 2 | AUDIT USE BEFORE KEEP |
| `DELIVERY_FRONTEND_ACTOR_ID` | SOURCE_CONDITIONAL/legacy-compatible | VPS 2 | AUDIT USE BEFORE KEEP |
| `DELIVERY_FRONTEND_WAREHOUSE_IDS` | SOURCE_CONDITIONAL/legacy-compatible | VPS 2 | AUDIT USE BEFORE KEEP |

Delivery frontend hiện đã chuyển sang workforce session; nhóm `DELIVERY_FRONTEND_*` phải được audit current usage/provider trước khi mang sang VPS.

### 3.4 Trợ lý Công Ty

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `ADMIN_AI_GATEWAY_BASE_URL` | SOURCE_CONDITIONAL | VPS 2 | KEEP/VERIFY endpoint |
| `ADMIN_AI_AGENT_MODEL` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `WEBSITE_AI_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | VPS 2 | dùng chung capability theo source hiện tại |

Google/Dialogflow credential của Website không được copy sang VPS chỉ để chạy Trợ lý Công Ty; source hiện đi qua Website AI gateway.

### 3.5 Customer Portal / Clerk verification

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `CUSTOMER_PORTAL_ENABLED` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `CUSTOMER_PORTAL_CLERK_ISSUER` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `CUSTOMER_PORTAL_CLERK_JWKS_URL` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `CUSTOMER_PORTAL_CLERK_AUDIENCE` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `CUSTOMER_PORTAL_CLERK_AUTHORIZED_PARTIES` | SOURCE_CONDITIONAL | VPS 2 | KEEP |

Công Ty chỉ xác minh JWT qua public JWKS; không đưa Clerk secret key vào Công Ty backend nếu source không yêu cầu.

### 3.6 Workforce auth / Owner challenge

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `INTERNAL_AUTH_ENABLED` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `INTERNAL_SESSION_TTL_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED` | SOURCE_DEFAULTED; production forced true | VPS 2 | KEEP/VERIFY |
| `ALLOW_FIXED_OWNER_CODE` | SOURCE_DEFAULTED; production must false | VPS 2 | VERIFY false |
| `SECURITY_OWNER_TEST_CODE` | TEST/conditional secret | VPS 2 | DO NOT COPY unless explicitly required outside prod; prod fixed code forbidden |
| `SECURITY_OWNER_EMAILS` | SOURCE_CONDITIONAL/sensitive config | VPS 2 | KEEP securely |
| `IMPLEMENTATION_OWNER_EMAILS` | SOURCE_CONDITIONAL/sensitive config | VPS 2 | KEEP securely |
| `INTERNAL_AUTH_CHALLENGE_PEPPER` | SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| `INTERNAL_WEB_CHALLENGE_TTL_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `INTERNAL_WEB_CHALLENGE_MAX_ATTEMPTS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `INTERNAL_WEB_CHALLENGE_RESEND_COOLDOWN_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |

### 3.7 Email/Resend

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| `INTERNAL_AUTH_EMAIL_FROM` | SOURCE_CONDITIONAL | VPS 2 | KEEP |
| `RESEND_EMAIL_TIMEOUT_MS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |

`CLOUDFLARE_EMAIL_API_TOKEN` xuất hiện trong workflow/history cũ nhưng current auth source dùng Resend; đánh dấu `RETIRED_CANDIDATE` và chỉ xóa sau provider audit.

### 3.8 Khu vực kỹ thuật / xóa dữ liệu

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `TECHNICAL_BACKUP_CHALLENGE_TTL_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `TECHNICAL_BACKUP_UNLOCK_TTL_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `TECHNICAL_BACKUP_CHALLENGE_MAX_ATTEMPTS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `DATA_DELETION_CHALLENGE_TTL_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `DATA_DELETION_CHALLENGE_MAX_ATTEMPTS` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `INTERNAL_AUTH_CHALLENGE_PEPPER` | shared SOURCE_CONDITIONAL/SECRET | VPS 2 | KEEP |
| Resend group | shared SOURCE_CONDITIONAL | VPS 2 | KEEP |

### 3.9 R2 — Công Ty

| Tên | Phân loại | Đích | Hành động |
| --- | --- | --- | --- |
| `R2_ENABLED` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |
| `R2_ENDPOINT` | required when enabled | VPS 2 | KEEP |
| `R2_REGION` | SOURCE_DEFAULTED | VPS 2 | KEEP |
| `R2_BUCKET` | required when enabled | VPS 2 | KEEP |
| `R2_ACCESS_KEY_ID` | required when enabled/SECRET | VPS 2 | KEEP |
| `R2_SECRET_ACCESS_KEY` | required when enabled/SECRET | VPS 2 | KEEP |
| `R2_PUBLIC_BASE_URL` | optional | VPS 2 | KEEP/VERIFY |
| `R2_PRESIGNED_URL_MAX_SECONDS` | SOURCE_DEFAULTED | VPS 2 | KEEP |
| `R2_MAX_OBJECT_BYTES` | SOURCE_DEFAULTED | VPS 2 | KEEP |
| `R2_CONTRACT_ROUTE_ENABLED` | SOURCE_DEFAULTED | VPS 2 | KEEP/VERIFY |

---

## 4. MCP API — VPS 3

| Tên | Phân loại | Hành động |
| --- | --- | --- |
| `NODE_ENV` | SOURCE_DEFAULTED | production |
| `SERVICE_NAME` | SOURCE_DEFAULTED | KEEP |
| `HOST` | SOURCE_DEFAULTED | VERIFY bind sau proxy audit |
| `PORT` | SOURCE_DEFAULTED | VERIFY không đụng proxy port |
| `LEGACY_INTERNAL_PORT` | SOURCE_DEFAULTED | VERIFY collision/actual use |
| `INSTALLATION_ID` | SOURCE_REQUIRED | KEEP |
| `NPP_CODE` | SOURCE_REQUIRED | KEEP |
| `MCP_LEGACY_ACTOR_ID` | SOURCE_REQUIRED | KEEP dù tên legacy còn trong contract |
| `AUTH_MODE` | SOURCE_DEFAULTED; current only `proxy-service` | KEEP |
| `BACKEND_API_TOKEN` | SOURCE_REQUIRED/SECRET | KEEP |
| `CORE_ONBOARDING_API_BASE_URL` | SOURCE_CONDITIONAL | CHANGE sang Công Ty VPS endpoint |
| `CORE_ONBOARDING_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | KEEP |
| `CORE_ONBOARDING_TIMEOUT_MS` | SOURCE_DEFAULTED | KEEP |
| `CORE_SALES_API_BASE_URL` | SOURCE_CONDITIONAL | CHANGE sang Công Ty VPS endpoint |
| `CORE_SALES_API_TOKEN` | SOURCE_CONDITIONAL/SECRET | KEEP |
| `CORE_SALES_DEFAULT_WAREHOUSE_ID` | SOURCE_CONDITIONAL | KEEP |
| `CORE_SALES_TIMEOUT_MS` | SOURCE_DEFAULTED | KEEP |
| `MCP_SERVICE_ROLES` | SOURCE_DEFAULTED/list | KEEP/VERIFY |
| `MCP_SERVICE_PERMISSIONS` | SOURCE_REQUIRED by production contract | KEEP |
| `MCP_SERVICE_SCOPES` | SOURCE_REQUIRED by production contract | KEEP |
| `PERSISTENCE_PROVIDER` | SOURCE_DEFAULTED | must be `postgresql` in production |
| `DATABASE_URL` | required for PostgreSQL/SECRET | CHANGE sang VPS 1 |
| `MCP_DB_SCHEMA` | SOURCE_DEFAULTED | KEEP/VERIFY actual schema |
| `MCP_DB_ROLE` | SOURCE_CONDITIONAL expected role | CHANGE/VERIFY VPS DB role |
| `MCP_DB_POOL_MAX` | SOURCE_DEFAULTED | tune for 1 GB DB VPS |
| `MCP_DB_CONNECT_TIMEOUT_MS` | SOURCE_DEFAULTED | KEEP/VERIFY |
| `MCP_DB_IDLE_TIMEOUT_MS` | SOURCE_DEFAULTED | KEEP/VERIFY |
| `MCP_DB_STATEMENT_TIMEOUT_MS` | SOURCE_DEFAULTED | KEEP/VERIFY |
| `MCP_LEGACY_RUNTIME_ENABLED` | SOURCE_DEFAULTED | must remain false production |
| `CORS_ORIGINS` | SOURCE_REQUIRED in production | VERIFY production MCP domain |
| `UPSTREAM_TIMEOUT_MS` | SOURCE_DEFAULTED | KEEP/VERIFY |
| `R2_BUCKET_NAME` | conditional | KEEP |
| `R2_ENDPOINT` | conditional | KEEP |
| `R2_ACCESS_KEY_ID` | conditional/SECRET | KEEP |
| `R2_SECRET_ACCESS_KEY` | conditional/SECRET | KEEP |
| `R2_REGION` | SOURCE_DEFAULTED | KEEP |
| `MCP_MIGRATION_DATABASE_URL` | FORBIDDEN_RUNTIME | DO NOT STORE in production runtime |
| `SUPABASE_URL` | legacy-only | DO NOT MIGRATE as production dependency |
| `SUPABASE_SERVICE_ROLE_KEY` | legacy-only/SECRET | DO NOT MIGRATE as production dependency |

**Trap bắt buộc:** Công Ty dùng `R2_BUCKET`, MCP dùng `R2_BUCKET_NAME`.

---

## 5. Vercel frontend wiring

### 5.1 Công Ty Operations

Current source contract:

- `CORE_API_INTERNAL_URL` — `FRONTEND_SERVER_ONLY`; phải đổi target sang Công Ty VPS khi cutover.
- `NEXT_PUBLIC_CORE_API_URL` — current env contract vẫn giữ; audit runtime use trước cutover.
- `NEXT_PUBLIC_APP_NAME` — presentation.
- `FOUNDATION_TEST_UI_ENABLED` — production phải audit/không bật ngoài chủ đích.
- `FOUNDATION_R2_TEST_ENABLED` — production phải audit/không bật ngoài chủ đích.
- `E2E_DATABASE_URL` — `TEST_ONLY`, không đưa production.
- `E2E_BACKEND_API_TOKEN` — `TEST_ONLY`, không đưa production.

Current source đã thay static `CORE_API_SERVER_TOKEN` bằng workforce session bearer. Các tên sau là `RETIRED_CANDIDATE`, không copy lại chỉ vì provider cũ còn giữ:

- `CORE_API_SERVER_TOKEN`
- `CORE_WEB_ADMIN_USERNAME`
- `CORE_WEB_ADMIN_PASSWORD`

### 5.2 MCP Field

- `BACKEND_API_BASE_URL` — server-only target MCP API; đổi sang VPS 3.
- `BACKEND_API_TOKEN` — server-only secret; KEEP.
- `MCP_LEGACY_ACTOR_ID` — current contract; KEEP.
- `NEXT_PUBLIC_APP_NAME` — presentation.
- `MCP_REPORT_AGENT_URL` — optional; provider audit.
- `MCP_REPORT_AGENT_TOKEN` — optional/secret; provider audit.

### 5.3 Admin

Current source contract:

- `CORE_API_INTERNAL_URL` — đổi sang Công Ty VPS endpoint.
- `NPP_OPERATIONS_URL` — giữ domain Công Ty Operations.

Retired candidates từ auth cũ:

- `CORE_API_SERVER_TOKEN`
- `CORE_WEB_ADMIN_USERNAME`
- `CORE_WEB_ADMIN_PASSWORD`

### 5.4 Delivery

Current source contract:

- `CORE_API_INTERNAL_URL` — đổi sang Công Ty VPS endpoint.
- `NEXT_PUBLIC_APP_LOGO_URL` — presentation.

Current source dùng workforce session. Các biến human/service cũ là retired candidate và không copy lại:

- `DELIVERY_CORE_API_TOKEN`
- `DELIVERY_WEB_USERS_JSON`
- `DELIVERY_SETUP_MODE`
- setup username/password cũ nếu provider còn sót.

### 5.5 Retail

- `CORE_API_INTERNAL_URL` — server-only; đổi sang Công Ty VPS endpoint.
- Auth dùng workforce session cookie, không cần đưa backend service token mới vào Retail.

### 5.6 Website — repo `nguyenlieuhungphat`

Website vẫn ở Vercel. Current source `.env.example` có:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_QUOTE_CHAT_ID`
- `TELEGRAM_ADMIN_CHAT_ID`
- `TELEGRAM_HR_CHAT_ID`
- `SUPABASE_CONNECTION_STRING` — **AUDIT CURRENT USE**, không tự mang sang VPS và không coi là target DB.
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_R2_ASSET_URL`
- `COMPANY_API_URL` — đổi target sang Công Ty VPS nếu production hiện trỏ Heroku.
- `COMPANY_WEBSITE_AI_API_TOKEN`
- `DIALOGFLOW_CX_PROJECT_ID`
- `DIALOGFLOW_CX_LOCATION`
- `DIALOGFLOW_CX_AGENT_ID`
- `DIALOGFLOW_CX_AGENT_DISPLAY_NAME`
- `DIALOGFLOW_CX_LANGUAGE_CODE`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `DIALOGFLOW_SERVICE_ACCOUNT_JSON`
- `DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON`

Google/Dialogflow/Telegram secrets vẫn thuộc Vercel Website; không copy sang VPS trừ khi source/runtime contract thực tế yêu cầu.

### 5.7 Customer Ordering — repo `nguyenlieuhungphat`

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — BROWSER_PUBLIC.
- `NEXT_PUBLIC_CUSTOMER_ORDERING_DATA_MODE` — production expected `core`.
- `CORE_API_BASE_URL` — FRONTEND_SERVER_ONLY; đổi sang Công Ty VPS endpoint.
- `ORDERING_AI_API_TOKEN` — server-only secret; KEEP.
- `WEBSITE_AI_BASE_URL` — giữ Website gateway.

Không thêm Công Ty bootstrap/server token vào Customer Ordering nếu source không yêu cầu.

---

## 6. GitHub deployment / secret-name manifest

Heroku workflow hiện có pattern cần giữ: manual owner command -> exact main SHA -> preflight -> release -> health -> rollback.

### Current provider-specific names

- `HEROKU_API_KEY` — Heroku-only; chỉ bỏ sau khi đóng Heroku.
- Heroku app identity variables trong workflow — provider-specific, sẽ supersede.

### VPS names cần thiết kế trong source task, hiện `TO_DEFINE`

Không coi các tên dưới đây là đã tồn tại; agent phải thiết kế rồi cấu hình GitHub Secrets an toàn:

- SSH target identity cho VPS 2 Công Ty.
- SSH target identity cho VPS 3 MCP.
- SSH user / private key / host-key fingerprint hoặc cơ chế deploy tương đương.
- Release path/current symlink/service name cho từng backend.
- VPS 1 migration/backup access chỉ trong workflow cần thiết; không để migration credential trong app runtime.

Không ghi private key, password, host secret hoặc DB URL vào repo/issue.

---

## 7. Dây không nằm trong env

Agent ngày mai phải audit và điền trạng thái cho từng dây sau:

| Dây | Target | Gate |
| --- | --- | --- |
| DNS/API hostname Công Ty | VPS 2 | HTTPS + production URL smoke |
| DNS/API hostname MCP | VPS 3 | HTTPS + production URL smoke |
| TLS certificate/renewal | VPS 2/VPS 3 | valid chain + auto renewal |
| reverse proxy route | VPS 2/VPS 3 | route đúng service/port |
| proxy hiện có trên VPS 3 | VPS 3 | không collision, không gián đoạn |
| firewall 80/443 | VPS 2/VPS 3 | chỉ mở cần thiết |
| PostgreSQL 5432 | VPS 1 | không public; chỉ allow VPS 2/3/private path |
| VPS2 -> VPS1 network | private/allowlisted | DB connect |
| VPS3 -> VPS1 network | private/allowlisted | DB connect |
| VPS3 -> VPS2 Công Ty API | HTTPS/private path | onboarding + Sales smoke |
| PostgreSQL version | VPS 1 | compatible with source/backup |
| extensions | VPS 1 | audit production actual use, không đoán |
| schemas | VPS 1 | `shared,mcp,sales,purchasing,inventory,logistics,accounting,reporting` theo actual migration state |
| DB roles/grants | VPS 1 | least privilege phù hợp source/provider capability |
| migration history/head | VPS 1 | restore rehearsal + verify |
| connection pool | cả 2 backend | tổng connection phù hợp 1 GB DB VPS |
| systemd/process restart | VPS 2/VPS 3 | reboot/restart smoke |
| log rotation | cả 3 VPS | disk không tăng vô hạn |
| NTP/timezone | cả 3 VPS | đồng bộ thời gian |
| disk/swap | cả 3 VPS | headroom trước restore/deploy |
| backup schedule | VPS 1 | automatic |
| backup destination | R2/external | off-box |
| restore procedure | disposable/rehearsal | thực sự restore được |
| R2 object access | VPS 2/VPS 3 | upload/read/delete/history smoke |
| health endpoints | 2 backend | `/health/live`, `/health/ready` |
| deployed SHA identity | 2 backend | phân biệt Heroku/VPS trong evidence |
| manual deploy gate | GitHub | Auto Deploy OFF |
| rollback release | VPS 2/VPS 3 | rollback app release, không rollback về stale DB |

---

## 8. Retired / stale provider candidates — không copy mù

Các tên sau từng xuất hiện trong docs/workflow/provider history nhưng current source đã thay đường dùng hoặc cần audit lại:

```text
CORE_API_SERVER_TOKEN
CORE_WEB_ADMIN_USERNAME
CORE_WEB_ADMIN_PASSWORD
DELIVERY_CORE_API_TOKEN
DELIVERY_WEB_USERS_JSON
DELIVERY_SETUP_MODE
CLOUDFLARE_EMAIL_API_TOKEN
SUPABASE_URL              # MCP legacy only
SUPABASE_SERVICE_ROLE_KEY # MCP legacy only
```

Quy tắc: provider còn biến `EXTRA` không có nghĩa VPS phải copy. Phải phân loại `RETIRED_CANDIDATE` và chỉ xóa provider cũ sau khi source + smoke chứng minh không dùng.

---

## 9. Bảng agent phải điền ngày mai

Mỗi biến/dây production phải được điền theo mẫu:

| name | consumer | source_state | current_provider | provider_state | target | target_state | action | verification | blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<name>` | `<service>` | REQUIRED/CONDITIONAL/DEFAULTED | Heroku/Vercel/R2 | PRESENT/MISSING/EXTRA/UNKNOWN | VPS1/VPS2/VPS3/Vercel | PRESENT/MISSING/UNKNOWN | KEEP/CHANGE/GENERATE/REMOVE | smoke/query | YES/NO |

Không ghi value.

### Provider audit tối thiểu

**Heroku Công Ty:** app identity, release, process/stack, config var names only, DB attachment metadata, health, Auto Deploy OFF.

**Heroku MCP:** tương tự + shared DB attachment + config names only.

**Vercel 7 project:** project/root/domain/branch/Auto Deploy + production env names only; đặc biệt các backend URL phải được map sang VPS target.

**R2:** bucket identity/config names only, không key value.

**3 VPS:** OS, CPU, RAM, disk/free, swap, services, ports, firewall, proxy, network path, Node/PostgreSQL, timezone/NTP, service manager, log rotation, backup path.

---

## 10. Cutover blocker

Không qua cutover nếu còn bất kỳ điều nào sau:

- production variable required còn `UNKNOWN/MISSING`;
- frontend backend URL chưa map rõ;
- MCP -> Công Ty URL/token pair chưa smoke;
- DB version/extension/role/schema chưa verify;
- PostgreSQL 5432 public Internet;
- restore rehearsal chưa PASS;
- reconciliation còn lệch;
- VPS 3 không đủ headroom cho proxy + MCP;
- GitHub deploy/rollback chưa test;
- backup chỉ nằm cùng VPS 1;
- secret value xuất hiện trong issue/repo/log;
- production URL/health/business smoke chưa PASS.

## 11. Ghi chú source audit

- Current source đã chuyển Công Ty Operations/Admin/Delivery/Retail sang workforce session bearer; không phục hồi static human/service token cũ chỉ để giống provider cũ.
- MCP production bắt buộc PostgreSQL; legacy Supabase runtime không phải target.
- Công Ty và MCP dùng khác tên bucket R2 (`R2_BUCKET` vs `R2_BUCKET_NAME`).
- Website/Ordering vẫn ở Vercel; chỉ backend target URL cần đổi khi cutover, không dời toàn bộ credential của chúng sang VPS.
- Tài liệu này là baseline source. Trạng thái provider/VPS phải được audit read-only lại ngay trước mutation.