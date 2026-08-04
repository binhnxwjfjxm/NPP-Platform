# Phase 6E.3 — Delivery frontend foundation decisions

> Status: ACTIVE IMPLEMENTATION DECISION
> Baseline: `main@65a4ce605bcfb8c88550dcfaa5a49d02f694f92b`
> Scope: driver-scoped read-only Delivery frontend foundation.

## Phần này làm gì cho người dùng

Tài xế mở ứng dụng Giao hàng trên điện thoại và chỉ thấy các chuyến đã xuất phát được gán đúng cho hồ sơ tài xế liên kết với nhân viên của mình. Mỗi chuyến hiển thị xe, kho, thời điểm xuất phát, thứ tự điểm giao, khách hàng, địa chỉ và các phiếu giao tại từng điểm.

```text
trip dispatched
-> Delivery frontend xác thực tài xế
-> Core nhận employeeId từ trusted Delivery service principal
-> resolve employee -> active driver profile
-> chỉ đọc trip.primary_driver_id tương ứng
-> hiển thị stops và Delivery Orders read-only
```

## Checklist đủ 5 frontend

1. Website + Customer Ordering — repository riêng.
2. NPP Operations — có source; sở hữu planning, lock và dispatch nội bộ.
3. MCP Field — có source; không được dùng Delivery driver API.
4. Admin MCP/NPP — có source; chỉ tổng hợp/ngoại lệ.
5. Logistics/Delivery — tạo source thật tại `delivery/web` trong slice này.

Delivery dùng Core API, không có backend hay database riêng. Project Vercel, domain, DNS và production rollout vẫn là operation riêng sau merge.

## Ownership

- `shared`: canonical employee identity.
- `logistics`: driver profile, trip, stop và assignment.
- Core API: resolve principal, permission và driver ownership.
- Delivery frontend: app-level authentication và server-side gateway; không giữ Core token ở browser.

## Identity boundary

- Một `shared.employees` active có tối đa một `logistics.driver_profiles` liên kết trong installation.
- Delivery frontend gọi Core bằng dedicated service token.
- Service request phải kèm employee ID do server-side Delivery auth resolve; Core không nhận employee ID từ body/query.
- Core principal có role `driver`, permission duy nhất `core.delivery-trip.driver-read` và warehouse scope cấu hình sẵn.
- Principal tài xế không được gọi route planning, dispatch, Delivery Order administration hoặc inventory.

## Read lifecycle

Slice này chỉ đọc trip `dispatched`:

```text
dispatched -> visible to matching primary driver
```

Không tạo trạng thái accepted/in_progress. Việc ghi delivery attempt và kết quả giao thuộc slice tiếp theo.

## Invariant

1. Trip chỉ hiển thị khi `status = 'dispatched'`.
2. `trip.primary_driver_id` phải trỏ tới driver profile active có `employee_id` đúng principal.
3. Employee và driver profile phải active.
4. Trip phải thuộc warehouse scope của principal.
5. Tài xế A đọc trip của tài xế B nhận `404`, không tiết lộ tồn tại.
6. Response chỉ chứa dữ liệu giao nhận cần thiết; không trả inventory issue internals, audit row hoặc secret.
7. Delivery frontend không kết nối PostgreSQL và không expose Core API token.
8. Không có mutation giao hàng trong slice này.

## Permission

```text
core.delivery-trip.driver-read
```

Permission này chỉ dùng cho dedicated driver routes. Nó không thay thế `core.delivery-trip.read` của điều phối viên.

## API capability

```text
GET /api/logistics/driver/trips
GET /api/logistics/driver/trips/:tripId
```

- list: các trip dispatched của đúng driver;
- detail: trip, vehicle, warehouse, handover summary, ordered stops và Delivery Orders;
- không nhận `driverId` hoặc `employeeId` từ query/body.

## Delivery frontend

Root source:

```text
delivery/web
```

Mobile-first/PWA foundation:

- trang danh sách chuyến của tôi;
- trang chi tiết chuyến;
- stop cards theo sequence;
- customer/address/Delivery Order summary;
- trạng thái read-only rõ ràng;
- app-level Basic Auth map server-side tới employee ID;
- server-side API gateway dùng dedicated Core token;
- Auto Deploy OFF trong `vercel.json`.

Domain đã khóa trong architecture map:

```text
log.nguyenlieuhungphat.com
```

Slice này không tạo hoặc cấu hình Vercel project/domain/DNS.

## Out of scope

- production deploy hoặc production migration;
- nhận/chấp nhận chuyến bằng mutation;
- delivery attempt;
- giao đủ/thiếu/thất bại/reschedule;
- actual delivered quantity;
- POD/photo/signature/GPS;
- return-to-warehouse;
- COD/accounting;
- route optimization/live tracking.

## Gate

- migration `048_logistics_driver_delivery_read` apply/rerun/rehearsal;
- employee-driver uniqueness và FK;
- dedicated principal deny-by-default;
- PostgreSQL integration chứng minh driver A không đọc được trip driver B;
- generic planning/dispatch route vẫn bị từ chối;
- Delivery source contract, typecheck, tests và build;
- Browser E2E mobile list -> detail;
- exact-head CI xanh;
- không unresolved finding hợp lệ thì merge ngay, không chờ CodeRabbit.
