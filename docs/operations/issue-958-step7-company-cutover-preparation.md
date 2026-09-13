# Issue #958 — Bước 7: chuẩn bị cutover Công Ty

> Trạng thái: **PREPARED / HOLD — CHƯA CUTOVER**
>
> Phạm vi ưu tiên: **Công Ty API + PostgreSQL dùng chung + frontend Công Ty + R2 + auth/CORS + rollback**.
>
> MCP, Delivery, Website, Customer Ordering và các frontend khác chỉ được kiểm ở mức không làm hỏng đường Công Ty trong bước này. Không mở rộng tối ưu hoặc cutover các app đó trước lệnh riêng.

## 1. Nguồn quyết định

Issue #958 là quyết định hạ tầng mới hơn và **ưu tiên hơn** các đoạn tài liệu cũ còn ghi Heroku là provider đích.

Kiến trúc đích của Issue #958:

```text
Vercel frontends giữ nguyên
Cloudflare R2 giữ nguyên

VPS 1 — PostgreSQL production duy nhất
VPS 2 — Công Ty API
VPS 3 — proxy hiện có + MCP API
```

Heroku hiện vẫn là production cho đến khi Bước 8 được owner ra lệnh rõ ràng. Bước 7 không đổi authority DB, DNS, traffic hoặc provider production.

## 2. Evidence đã đạt trước Bước 7

Bước 6 đã PASS trên exact main tại thời điểm rehearsal:

```text
main candidate: ff302d266bbd236c0b244160e7a821e3e15128f6
VPS parallel full-system smoke: 34731451212 — PASS
MCP rehearsal deploy trước smoke: 34731418998 — PASS
```

Evidence Bước 6 xác nhận:

- Công Ty rehearsal backend và package path khớp source đã smoke;
- Công Ty health/auth/business reads và write rollback/idempotency PASS;
- R2 historical read + temporary write/read/delete PASS;
- MCP boundary/business workflow PASS nhưng không phải trọng tâm cutover Công Ty;
- frontend/server wiring liên quan đã được smoke;
- production Heroku/Vercel vẫn hiện diện;
- `PRODUCTION_DB_CUTOVER=false`;
- `PRODUCTION_TRAFFIC_CUTOVER=false`;
- `PRODUCTION_DNS_CHANGED=false`.

Evidence rehearsal không thay thế preflight ngay trước cửa sổ cutover.

## 3. Exact source SHA

Không hardcode một SHA cũ thành production target vĩnh viễn.

Tại thời điểm owner yêu cầu Bước 8, phải chốt:

```text
CUTOVER_SHA = exact origin/main tại thời điểm bắt đầu cửa sổ
```

Gate bắt buộc:

1. working source dùng đúng `origin/main`;
2. không có PR/source mutation khác được chen vào sau khi chốt SHA;
3. release Công Ty VPS phải được build/deploy từ đúng `CUTOVER_SHA`;
4. nếu `main` đổi trước cutover, **hủy SHA cũ và chạy lại preflight động**.

## 4. Preflight động phải chạy sát giờ cutover

Các mục dưới đây không được coi là PASS chỉ vì rehearsal trước đó đã PASS.

| Gate | Cách kiểm | GO | NO-GO |
| --- | --- | --- | --- |
| Exact main | xác minh `HEAD == origin/main` | cùng một SHA | lệch SHA |
| CI exact head | CI bắt buộc của exact SHA | xanh | đỏ/đang chạy ở gate bắt buộc |
| Công Ty VPS | audit read-only CPU/RAM/disk/service/health | đủ headroom, service/health đúng | thiếu tài nguyên hoặc health fail |
| PostgreSQL VPS | version/service/disk/firewall/network | healthy, 5432 không public, Công Ty kết nối được | network/firewall/service sai |
| Migration head | audit migration registry production và target | khớp kế hoạch, không pending không giải thích | drift/pending chưa xử lý |
| Heroku production | current release + health + DB attachment | xác minh được và đang phục vụ bình thường trước freeze | provider state không rõ |
| Backup cuối | fresh backup production ngay trước cutover | backup hoàn tất + reference/check xác minh được | backup fail/chưa xác minh |
| Restore rehearsal | evidence restore + reconciliation gần nhất | PASS và còn phù hợp source/schema | stale/không phù hợp/fail |
| Công Ty auth/CORS | smoke production contract + VPS target | PASS | fail |
| R2 | historical read và temporary lifecycle | PASS | fail |
| Frontend Công Ty wiring | production frontend/server routes biết target theo runbook | xác minh được | env/wiring UNKNOWN |
| Rollback | previous Heroku state + previous VPS release/config reference | có đường quay lại trước GO write | thiếu rollback evidence |

Chỉ một dòng NO-GO là dừng cutover.

## 5. Backup và database authority

Fresh backup **không chạy ở Bước 7 nếu cutover còn để sau**, vì backup đó sẽ cũ trước cửa sổ thật.

Khi owner mở Bước 8:

1. đưa hệ thống vào cửa sổ write-freeze đã chốt;
2. tạo fresh production backup;
3. xác minh backup hoàn tất và có reference hợp lệ;
4. restore/final sync theo workflow đã review;
5. chạy migration status/verify theo registry;
6. reconciliation bắt buộc PASS;
7. chỉ sau đó mới được quyết định chuyển PostgreSQL authority sang VPS.

Không cho phép hai database cùng nhận write production độc lập.

## 6. Cửa sổ write-freeze

Bước 7 chỉ chuẩn bị thủ tục; **không tự chọn giờ**.

Khi owner chốt thời điểm, phải thông báo nội bộ một cửa sổ ngắn. Trong cửa sổ đó:

```text
STOP NEW WRITES
-> fresh backup
-> final restore/sync + migration verify
-> reconciliation
-> GO/NO-GO
-> switch Công Ty
-> smoke
-> RESUME WRITES
```

Nếu quá thời lượng cho phép hoặc có reconciliation mismatch: **NO-GO**, giữ production cũ.

## 7. Runbook Bước 8 đã chuẩn bị nhưng chưa được phép chạy

Thứ tự Công Ty:

1. Chốt `CUTOVER_SHA` và khóa thay đổi source cho cửa sổ.
2. Chạy read-only audit provider/VPS/DB và exact-head CI.
3. Bật write-freeze theo cửa sổ owner đã duyệt.
4. Tạo fresh Heroku PostgreSQL backup và xác minh.
5. Final restore/sync sang PostgreSQL VPS theo workflow được review.
6. Migration status -> apply phần đã được duyệt nếu có -> rerun no-op -> verify.
7. Reconciliation dữ liệu trọng yếu Công Ty.
8. Xác nhận PostgreSQL VPS là candidate authority duy nhất.
9. Deploy/activate Công Ty VPS từ exact `CUTOVER_SHA` bằng workflow manual của Công Ty.
10. `/health/live` + `/health/ready` + business smoke Công Ty.
11. Chuyển đường production Công Ty theo cơ chế đã audit (env/DNS/proxy tùy topology thực tế tại thời điểm đó).
12. Smoke URL production thật: login/auth, khách hàng, sản phẩm/SKU, đơn bán hàng, tồn kho, công nợ, import/export cần thiết, R2.
13. Chỉ khi smoke PASS mới gỡ write-freeze.
14. Giữ Heroku/previous release trong thời gian quan sát; không xóa provider cũ trong cùng cutover operation.

MCP và các app khác không tự động đi theo bước 9–14 nếu chưa có lệnh riêng.

## 8. Rollback decision

Rollback phải được quyết định theo thời điểm:

### Trước khi VPS DB nhận production write

Có thể NO-GO và giữ nguyên Heroku + DB production hiện tại. Đây là rollback an toàn nhất.

### Sau khi đã chuyển authority nhưng trước khi mở write

Có thể trả traffic Công Ty về provider cũ nếu database authority vẫn chưa phát sinh write mới và runbook xác minh được state tương thích.

### Sau khi đã mở production write trên VPS DB

Không được tự ý "quay ngược" DB bằng restore cũ vì có nguy cơ mất dữ liệu mới. Phải freeze write lại, đối soát delta và thực hiện forward-fix hoặc rollback có kế hoạch dữ liệu riêng được owner duyệt.

## 9. GO / NO-GO

**GO** chỉ khi tất cả điều kiện sau cùng đúng tại cửa sổ thực tế:

```text
exact main SHA locked
exact-head CI green
Công Ty VPS healthy
PostgreSQL VPS healthy + network/firewall đúng
migration head verified
fresh production backup verified
restore/final sync PASS
reconciliation PASS
R2/auth/CORS/frontend wiring PASS
rollback references present
owner explicitly says CUTOVER
```

Nếu thiếu bất kỳ điều kiện nào: **NO-GO**.

## 10. Trạng thái sau Bước 7

Khi tài liệu/preflight source này đã merge và read-only VPS audit mới nhất PASS, trạng thái được ghi là:

```text
STEP_7_PREPARED=true
CUTOVER_AUTHORIZED=false
PRODUCTION_DB_CUTOVER=false
PRODUCTION_TRAFFIC_CUTOVER=false
PRODUCTION_DNS_CHANGED=false
```

Fresh backup cuối, write-freeze, final restore/sync và production switch là hành động just-in-time của Bước 8; không chạy trước chỉ để đánh dấu Bước 7 hoàn tất.
