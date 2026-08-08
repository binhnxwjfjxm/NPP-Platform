# Phase 9.1 — Access closure + reporting UI review

Parent: #386  
Task: #388  
Baseline: `main@a0ea94e919f3d94155a44e38b65572ac3df30965`

## Access / permission reconciliation

- Backend permission source-of-truth remains `npp-core/api/src/access/permissions.js` plus its inherited catalogs.
- `requirePermission` rejects an unknown permission key and rejects a principal that does not hold the requested key. Deny-by-default remains unchanged.
- `/access/roles` already loads the permission catalog dynamically from `/api/access/permissions`, creates/updates roles with the selected concrete permission keys, and keeps existing roles editable. Those working contracts are retained.
- The actual defect was presentation grouping: catalog modules such as `Kho`, `Báo cáo tồn kho`, `Báo cáo nhân sự & MCP`, `Điều phối giao hàng`, etc. were falling through to the generic `Nhóm chức năng khác` label. Phase 9.1 now displays the live catalog module name when no legacy alias is required.
- Role presets are suggestions only. Choosing a preset seeds permission checkboxes from keys that exist in the current catalog; the user can add/remove any permission before saving and still chooses the role code/name.
- `core.audit-outbox.test.write`, `core.idempotency.test.write`, and `core.storage.r2.test.write` remain intentionally hidden for new assignment in the product UI. If already granted, they remain visible so the grant can be revoked. This is an intentional internal-verification classification, not a missing-role-UI defect.
- No backend permission was broadened and no role-name-based authorization was introduced.

## Employee / MCP reporting structure

The Phase 8.4 data contract remains the only source: `/api/reporting/employee-mcp`.

The long page is split client-side into five views over the already loaded response:

1. Tổng quan
2. Tuyến & phiên
3. Điểm bán / lượt ghé
4. Nhu cầu & đơn hàng
5. Hiệu quả hoạt động

No new reporting endpoint, metric store, territory inference, Admin redesign, Customer Ordering integration, database migration, provider mutation or production deploy is part of 9.1.

## Gate result

Phase 9.1 closes the identified access-management UI gap without replacing working role CRUD/authorization. Registered business permissions continue to come from the canonical catalog; the only intentionally non-assignable entries in the product UI are the three internal verification permissions listed above.
