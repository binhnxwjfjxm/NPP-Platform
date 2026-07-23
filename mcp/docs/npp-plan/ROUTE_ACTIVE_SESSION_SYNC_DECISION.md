# Route master -> active session customer sync decision

> Cập nhật: **2026-07-17**  
> Trạng thái: **DECISION LOCKED — NOT IMPLEMENTED**  
> Phạm vi: **F05 hotfix hành vi, không phải A5.5.2/NPP-F06/Order Core**

## 1. Vấn đề

Khi thêm một khách vào tuyến cố định trong lúc tuyến đó đang có phiên active, khách chỉ xuất hiện trong route master. Phiên đang chạy giữ snapshot cũ nên sales phải mở phiên mới mới thấy khách.

Không nên giữ hành vi này làm mặc định vì gây gián đoạn phiên đang chạy. Cũng không được tự động đồng bộ âm thầm mọi thay đổi route master vào phiên active vì có thể làm thay đổi kế hoạch giữa ca mà sales không biết.

## 2. Quyết định đã chốt

Khi người dùng thêm khách từ màn hình tuyến cố định và tuyến đang có phiên active, UI phải hỏi rõ:

```text
Tuyến này đang có phiên hoạt động. Thêm khách vào phiên hiện tại luôn?
```

Hai lựa chọn:

```text
1. Thêm vào tuyến và phiên hiện tại — mặc định.
2. Chỉ thêm vào tuyến cố định — áp dụng từ phiên sau.
```

Không bắt sales đóng/mở phiên mới.

## 3. Ownership

- `mcp_route_customers` là route master cho các phiên tương lai.
- `mcp_session_customers` là snapshot vận hành của phiên hiện tại.
- Chỉ thao tác thêm khách có lựa chọn `includeActiveSession=true` mới ghi thêm snapshot vào phiên active.
- Không có background sync, render sync hoặc reload sync từ route master sang phiên.

## 4. Mutation đúng logic

Phải dùng một typed idempotent transaction duy nhất:

```text
lock route + active session
-> validate route/session ownership
-> create or resolve route customer
-> when includeActiveSession=true:
     create or resolve session customer snapshot
-> preserve existing active-session rows and statuses
-> append audit
-> persist idempotency response
-> return routeCustomerId + optional sessionCustomerId
```

Không thực hiện bằng hai request rời, không chép lại toàn bộ route vào phiên, không gọi refresh để suy diễn đồng bộ.

## 5. Chống trùng và concurrency

- Cùng một user intent dùng một `Idempotency-Key`.
- Retry cùng key/payload phải replay cùng response.
- Cùng key khác payload phải trả conflict.
- Phải khóa route/active session trước khi tạo.
- Nếu khách đã có trong route master thì resolve row hiện hữu thay vì tạo trùng.
- Nếu khách đã có trong active session thì trả row hiện hữu thay vì mọc thêm snapshot.
- Không thay đổi `visit_status`, check-in, result, order, report hoặc follow-up của row phiên đã tồn tại.

## 6. UI/UX

- Prompt chỉ xuất hiện khi tìm thấy đúng một phiên active thuộc tuyến đang sửa.
- Không có phiên active: lưu route master bình thường, không prompt.
- Phiên đã closed/cancelled: không được ghi snapshot vào phiên đó.
- Nút mặc định: `Thêm vào tuyến và phiên`.
- Nút phụ: `Chỉ thêm vào tuyến`.
- Thông báo thành công phải phân biệt:
  - đã thêm vào tuyến và phiên hiện tại;
  - đã thêm vào tuyến, áp dụng từ phiên sau;
  - khách đã tồn tại và được dùng lại.

## 7. Những cách bị cấm

- Tự đồng bộ route master vào phiên khi mở trang hoặc refresh.
- Xóa rồi tạo lại toàn bộ `mcp_session_customers` từ route master.
- Hạ requirement `Idempotency-Key` ở backend.
- Sinh key tại proxy/Gateway thay cho caller UI.
- Hai mutation độc lập: một request thêm route, một request thêm session.
- Chạm các trạng thái xử lý hiện hữu của khách trong phiên.

## 8. Acceptance tests bắt buộc

```text
A. Route không có active session
   -> tạo route customer
   -> không tạo session customer

B. Route có active session + includeActiveSession=true
   -> tạo/resolve route customer
   -> tạo/resolve session snapshot trong cùng transaction
   -> trả cả hai id

C. Route có active session + includeActiveSession=false
   -> chỉ tạo/resolve route customer
   -> active session không đổi

D. Retry cùng key/payload
   -> replay cùng response
   -> không tạo trùng

E. Cùng key khác payload
   -> idempotency conflict

F. Khách đã có trong route
   -> không tạo route row trùng

G. Khách đã có trong active session
   -> không tạo snapshot trùng
   -> giữ nguyên visit_status/check-in/result

H. Session closed/cancelled
   -> không ghi vào session

I. Concurrency hai request cùng khách
   -> một logical route customer
   -> tối đa một logical session snapshot

J. Regression
   -> luồng Thêm khách bên trong Phiên vẫn ghi đồng thời route master + phiên
   -> check-in, field-check, report settings, order và 21 legacy routes không bị ảnh hưởng
```

## 9. Tiến độ dự án tại thời điểm chốt

```text
Master plan:        Phase A / NPP-F05 / A5.5
PR #25:             persisted idempotency core — merged, DB verified
PR #26:             session UI + manual check-in — merged, DB verified
PR #27:             repeatable F05 runtime smoke — merged
PR #28:             add-customer missing Idempotency-Key — merged + Vercel deployed
Hotfix UI smoke:    pending thao tác thật
VPS pullmcp:        pending output thật
F05 runtime smoke:  pending
A5.5.2:             not started
NPP-F06:            not started
Order Core:         not started
```

## 10. Bước tiếp theo cho chat mới

1. Đọc `CURRENT_PROGRESS.md` và file này.
2. Audit route-master add-customer caller, backend owner và RPC hiện tại.
3. Tạo branch riêng cho hotfix route -> active session explicit sync.
4. Viết contract/migration tests trước.
5. Triển khai typed idempotent transaction và prompt hai lựa chọn.
6. Chạy scanner, backend tests, TypeScript và Next production build.
7. Chỉ apply migration production sau khi CI xanh.
8. Smoke bằng fixture an toàn, restore/cleanup đầy đủ.
9. Merge, deploy Vercel/VPS theo đúng phần thay đổi.
10. Cập nhật `CURRENT_PROGRESS.md` và evidence; không chỉ ghi trong chat.
