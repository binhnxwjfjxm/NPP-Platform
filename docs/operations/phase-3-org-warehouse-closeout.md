# Phase 3.1 — Organization and Warehouse Structure Closeout

## Trạng thái cuối

```text
Phase: 3.1
Scope: branches -> warehouses -> warehouse locations
Code: merged
CI: green
Production database: migrated and verified
Core API production: healthy
Core web production: live
Canonical organization API: active
Browser authentication gate: active
Auto Deploy: locked
Status: CLOSED
Closed at: 2026-07-26
```

Phase 3.1 chỉ bao gồm cấu trúc tổ chức và kho. Slice này không mở rộng sang người dùng/phân quyền, khách hàng, nhà cung cấp, sản phẩm, tồn kho ledger, mua hàng, bán hàng hoặc MCP cutover.

## Merge record

| Nội dung | PR | Main commit |
|---|---:|---|
| API, migrations, transaction, audit và organization browser flow | #26 | `a8038bfcdead3c6dc2b51b97a690974c30b5475c` |
| Closeout kỹ thuật ban đầu | #27 | `9038e1bd1910ae9e3b466c28a93a605d24d6589b` |
| AppShell, Việt hóa và UI quản trị tổ chức | #28 | `83f32335da98606b6c1634472bf34e7e1100f5cb` |
| Sửa canonical organization API routing | #29 | `20ebda163886e92f5d2c21c9732cfabc3c08cef7` |
| Chuyển Vercel project root sang `npp-core/web` | #30 | `b9b548561c419727013d2fd273bfa0dec5d80a8e` |

## Database production

- Heroku PostgreSQL được audit trước migration.
- Backup trước migration: `b1`.
- Restore rehearsal trên PostgreSQL tạm: PASS.
- Migrations production đã áp dụng: `002_core_idempotency` đến `006_org_locations`.
- Migration verification: `verified=true`, `issues=[]`.
- Backup sau migration: `b002`.
- Không sửa production database thủ công.

## Core API production

- Backend Core chạy trên Heroku app `hung-phat`.
- `/health/live` trả `200`.
- `/health/ready` trả `200`.
- Organization list và mutation dùng PostgreSQL thật.
- Idempotency, optimistic concurrency và audit transaction giữ nguyên implementation production.

## Core web production

- Production domain: `https://npp-platform.vercel.app`.
- Vercel Root Directory: `npp-core/web`.
- Framework preset: Next.js.
- Node.js: `20.x`.
- Production deployment: `dpl_BugXwqsXxFGma3obV3QSAPP2YFu7`.
- Deployment source: Git, branch `main`, target `production`.
- Deployment commit: `23a35cca1004a8ce92f86c5d4ebef6e9fe034f04`.
- Deployment state: `READY`.
- Root `/` redirects tới `/dashboard`.
- `/login` public.
- Dashboard, organization pages và organization API yêu cầu Basic Auth.
- Canonical `/api/organization/*` hoạt động; nested `/npp-core/web/*` trả `404`.
- Browser HTML không chứa Core API token, internal API URL, backend token hoặc database URL.
- Root `vercel.json` và `npp-core/web/vercel.json` đều khóa `deploymentEnabled=false`.

## Verified gates

- Foundation F0.2: PASS.
- Core Foundation: PASS.
- Core UI and Browser E2E: PASS.
- Core API verify: 107/107 tests PASS tại thời điểm hoàn thiện UI.
- Core web typecheck, unit test và build: PASS.
- Dashboard và organization Playwright: PASS.
- PostgreSQL-backed CRUD: PASS.
- Idempotency replay: PASS.
- `expectedUpdatedAt` conflict contract: PASS.
- Static CSS/JS production assets: `200`.
- Canonical organization API không còn Vercel platform `404`.

## Security and transaction decisions

- Browser không gọi Core API bằng privileged token trực tiếp.
- Next.js server-side gateway giữ token server-only.
- Organization pages và API bị chặn trước khi gateway gắn token backend.
- Production organization access yêu cầu HTTPS.
- Create mutations dùng idempotency.
- PATCH dùng optimistic concurrency với `expectedUpdatedAt`.
- Entity mutation và audit commit trong cùng transaction.
- Không thêm memory fallback khi local database không sẵn sàng; E2E dùng PostgreSQL 16 tạm.
- Organization outbox events tiếp tục deferred cho đến khi có consumer, versioned contract, retry policy và operational owner được phê duyệt.

## Product checkpoint sau closeout

Theo yêu cầu chủ sản phẩm, repo **tạm dừng mở Phase 3 slice mới** sau khi đóng Phase 3.1. Việc tiếp theo là tiếp nhận và thực hiện một vòng điều chỉnh UI nhỏ trên shell/dashboard/organization hiện tại.

Không bắt đầu users/employees/roles, customers, suppliers, products, inventory, sales, purchasing hoặc MCP cutover trước khi có chỉ đạo rõ ràng sau vòng điều chỉnh UI.
