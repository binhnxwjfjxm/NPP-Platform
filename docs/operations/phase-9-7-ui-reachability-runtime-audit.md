# Phase 9.7 — UI reachability + Vercel/DNS/env cutover audit

> Issue: #394  
> Parent: #386  
> NPP baseline: `main@528218c25328628f5859cde2675943fb781fcdff`  
> Website/Customer baseline: `main@b6bef8c868b4caa37abcb80355cecaf339e232a0`  
> Production mutation in this source slice: **NONE**

## 1. Kết luận source reachability

Audit route/navigation không phát hiện defect top-level cần sửa UI.

- **NPP Operations**: business routes được đi vào từ Core AppShell theo nhóm access, organization, sales, purchasing, inventory, logistics, accounting và operations. `/login`, `/dashboard`, `/foundation` là auth/landing/internal surfaces, không phải orphan business navigation.
- **MCP Field**: `/`, `/mcp`, `/routes`, `/visits`, `/mcp/sessions`, `/customers`, `/orders`, `/reports`, `/field-checks`, `/plans`, `/mcp-setting`, `/settings` đều có entry. `/actions` là alias của `/plans`; `/visits/order-intent` là deep workflow dưới Visits.
- **Admin MCP/NPP**: `/`, `/customer-onboarding`, `/menu` có entry; `/login` là auth route. Không redesign Admin trong 9.7.
- **Delivery**: `/` là danh sách chuyến; `/trips/[tripId]` là drill-down và có đường quay lại danh sách; `/login` là auth route.
- **Website**: header phủ `/`, `/gioi-thieu`, `/nganh-hang`, `/san-pham`, `/lien-he`, `/tuyen-dung`; footer phủ privacy và category links. Dynamic category/product routes là deep routes.
- **Customer Ordering**: bottom navigation phủ Home/Products/Quick Order/Orders/Account; header/cart phủ News/Cart; checkout, order-success, detail, SSO callback và offline là workflow/deep/system routes.

Machine-readable evidence nằm ở `docs/operations/phase-9-7-route-runtime-manifest.json`. Regression được nối vào test Vercel deployment control hiện hữu để route/source/provider claims không bị nới lỏng âm thầm.

## 2. Vercel provider readback

Đã đọc được đúng **6 project** và production deployment metadata. Tất cả latest deployment được quan sát đều `READY`, target `production`, Git ref `main`, đúng owning repository.

| Surface | Project | Deployed SHA lúc audit | Root evidence |
| --- | --- | --- | --- |
| NPP Operations | `npp-platform` | `efe2069...` | `npp-core/web` — deployment metadata |
| MCP Field | `mcp-field` | `bb163c6...` | `mcp` — deployment metadata |
| Admin MCP/NPP | `admin-mcp-npp` | `efe2069...` | `admin/web` — deployment metadata |
| Delivery | `npp-delivery` | `583b556...` | không có field root trong metadata trả về |
| Website | `nguyenlieuhungphat` | `e536726...` | không có field root trong metadata trả về |
| Customer Ordering | `customer-ordering` | `b6bef8c...` | không có field root trong metadata trả về |

Production SHA không đồng nhất với current `main` là **deployment drift có chủ đích cần rollout riêng**, không phải bằng chứng source lỗi. Source merge không đồng nghĩa production deployment.

Một số deployment MCP/Admin/Delivery trả `gitDirty=1`. 9.7 chỉ ghi nhận field này như provider evidence; không suy diễn nó thành source defect hoặc tự tạo commit để “sửa”.

## 3. Env/backend contract

Source chỉ khóa **tên biến**, không ghi value vào manifest.

Đặc biệt MCP frontend:
- build/runtime server-side bắt buộc `BACKEND_API_BASE_URL`, `BACKEND_API_TOKEN`, `MCP_LEGACY_ACTOR_ID`;
- `BACKEND_API_BASE_URL` được đọc trong server boundary, không có `NEXT_PUBLIC_BACKEND_API_BASE_URL`;
- backend đích theo architecture là `hung-phat-mcp`.

Current Vercel connector không đọc được env-name presence/value, vì vậy 9.7 **không tuyên bố production `BACKEND_API_BASE_URL` đã trỏ đúng**. Đây vẫn là provider evidence gate.

## 4. Provider fields chưa verify được

Current connector không cung cấp đủ readback cho:

- Vercel environment-variable names/values;
- custom-domain assignment;
- Auto Deploy project setting;
- root directory đối với Delivery, Website, Customer Ordering khi deployment metadata không có field này;
- DNS records;
- production value của MCP `BACKEND_API_BASE_URL`.

Không dùng source docs, domain kỳ vọng hoặc READY status để thay thế các evidence này.

## 5. Production gate

Source route reachability: **PASS**.  
Project identity + repository + production branch from deployment metadata: **PASS**.  
Root directory: **PARTIAL**.  
Env-name presence: **NOT VERIFIED**.  
Custom domain assignment: **NOT VERIFIED**.  
Auto Deploy provider setting: **NOT VERIFIED**.  
MCP API-base production value: **NOT VERIFIED**.  
DNS/env switch: **NOT PERFORMED**.

Vì vậy Phase 9.7 **chưa được gọi production-ready/closed** chỉ từ source PR này.

Một operation riêng, có owner command rõ, phải đọc provider fields còn thiếu bằng capability phù hợp rồi mới:
1. khóa root/domain/env/Auto Deploy;
2. verify MCP API base trỏ MCP backend;
3. thực hiện DNS/env switch nếu thực sự cần;
4. smoke từng frontend bị ảnh hưởng.

Không deploy, đổi env/domain/DNS, chạy migration hoặc final data closeout trong source slice này. Final production closeout thuộc #395.
