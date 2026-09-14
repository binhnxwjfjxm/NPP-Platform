# MCP Field manual Vercel deployment

## Boundary

MCP Field là frontend Vercel độc lập. Sau Issue #958, frontend này có hai dependency server-side khác nhau:

```text
MCP Field -> CORE_API_INTERNAL_URL -> Công Ty VPS (đăng nhập/phiên nhân sự)
MCP Field -> BACKEND_API_BASE_URL -> MCP VPS (nghiệp vụ MCP)
```

- Công Ty frontend: `/deploy-vercel-production` trên Issue #5.
- MCP Field: `/deploy-vercel-mcp-production` trên Issue #5.
- Cả hai chỉ deploy exact current `main` sau CI xanh.
- Automatic Vercel deployments luôn OFF.
- Deploy MCP Field không deploy/restart backend Công Ty, backend MCP, PostgreSQL hoặc hệ proxy.

## Production identity

```text
Vercel team: team_hBA8rX68UHC8ogvREkOyQlJ2
MCP project: prj_854SWdJeDEOPezAvvTZzTaRvZUSq
Production domain: https://mcp.nguyenlieuhungphat.com
Root directory: mcp
```

Provider target sau cutover:

- `CORE_API_INTERNAL_URL` lấy từ `VPS_COMPANY_HOST` và phải là HTTPS Công Ty production.
- `BACKEND_API_BASE_URL` lấy từ `VPS_MCP_HOST` và phải là HTTPS MCP production.
- `BACKEND_API_TOKEN` là server secret đã lưu trong Vercel production; deploy path chỉ kiểm metadata tồn tại, không đọc/in giá trị và không lấy lại từ Heroku.
- `MCP_LEGACY_ACTOR_ID` vẫn là service actor non-secret hiện hữu cho các route tương thích.

Không dùng Heroku API, Supabase service role, `DATABASE_URL` hoặc secret database trong frontend deploy.

## Manual rollout

1. Merge MCP frontend change vào `main` khi exact-head CI xanh.
2. Xác nhận `VPS_COMPANY_HOST` và `VPS_MCP_HOST` GitHub variables đang là production target đã audit.
3. Comment chính xác `/deploy-vercel-mcp-production` trên Issue #5.
4. Workflow kiểm health Công Ty/MCP, khóa hai URL production, kiểm `BACKEND_API_TOKEN` tồn tại trong Vercel production, rồi remote-build exact `main`.
5. Smoke domain production gồm login, static asset, route bảo vệ và login connectivity tới Công Ty.
6. Ghi exact deployed SHA/deployment URL vào Issue #5.

## Repair auth wiring sau cutover

Nếu MCP Field đang chạy đúng source nhưng mất dây xác thực sang Công Ty, dùng lệnh riêng:

```text
/repair-mcp-auth-wiring-production
```

Lệnh này chỉ:

- cập nhật `CORE_API_INTERNAL_URL` của project MCP Field về Công Ty VPS production;
- redeploy **deployment production hiện tại** để nạp binding mới;
- smoke login connectivity.

Nó không đổi `BACKEND_API_BASE_URL`, không đổi token, không deploy source mới, không restart backend/DB/proxy.