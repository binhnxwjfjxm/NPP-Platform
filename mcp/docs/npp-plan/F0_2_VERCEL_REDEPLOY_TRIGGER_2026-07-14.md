# F0.2 — Vercel redeploy trigger

Ngày: 2026-07-14

Mục đích của commit này là kích hoạt lại Preview Deployment cho branch `f0-2-installation-context-config` sau khi giới hạn/chặn build trên Vercel đã được gỡ.

Không thay đổi logic runtime, không thay đổi database và không chứa secret.

Deployment gate vẫn giữ nguyên:

```text
1. Preview F0.2 phải build READY.
2. PR #4 vẫn chưa merge.
3. VPS chưa chạy pullmcp.
4. Chỉ merge/pull VPS sau khi preview và smoke gate đạt.
```
