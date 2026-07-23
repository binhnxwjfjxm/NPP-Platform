# MCP-Plan

MCP-Plan la phan mem quan ly nha phan phoi duoc xay dung tren du lieu Supabase hien co cua he report/route/test/order.

## Nguyen tac thiet ke

- Khong lam frontend truoc khi chot DB va backend contract.
- Khong sua DB theo kieu chap va; moi thay doi schema phai co migration ro rang.
- Uu tien doc va chuan hoa du lieu hien co truoc, khong pha bang report goc.
- Backend chiu trach nhiem logic nghiep vu; frontend chi hien thi va dieu huong thao tac.
- Moi bug phai tim nguyen nhan logic, tai hien duoc, sua dung tang chiu trach nhiem va test lai luong chinh.

## Ket qua DB audit nhanh

Supabase project: `noiadkpkvdohljgopgfb`

Bang public hien co:

- `mcp_routes`: tuyen ban hang.
- `mcp_route_customers`: khach hang trong tuyen.
- `mcp_route_sessions`: phien di tuyen theo ngay.
- `mcp_visits`: luot ghe tham khach hang.
- `orders`: don hang.
- `order_items`: chi tiet don hang.
- `test_files`: dot test/kiem tra thi truong.
- `test_customers`: khach hang trong dot test.
- `test_file_products`: san pham trong dot test.
- `test_customer_results`: ket qua test theo khach hang va san pham.
- `market_reports`: bao cao thi truong, hien chua co data.

## Thu tu lam dung

1. DB audit va contract du lieu.
2. Backend API read-only cho dashboard/route/test/order.
3. Frontend dashboard toi thieu dung API that.
4. Bo sung bang MCP-Plan rieng de luu ke hoach, hanh dong, goi y.
5. Security hardening: RLS, role, function permission.
6. AI planning/mindmap/report automation.

## Runtime split

- Vercel chay frontend Next.js.
- VPS chay backend API va nghiep vu.
- Supabase giu database va RLS.
- Frontend chi goi API base URL, khong giu service role key.

## Tai lieu chinh

- `docs/DB_AUDIT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/API_PLAN.md`
- `docs/DB_EXTENSION_PLAN.md`
- `docs/VPS_BACKEND_HANDOFF.md`
