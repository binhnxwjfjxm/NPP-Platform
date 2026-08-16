import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('9.1 role presets stay optional and seed the live permission catalog only', () => {
  const workspace = source('../app/access/roles/role-workspace.tsx');
  const presets = source('../app/access/roles/role-presets.ts');

  assert.match(workspace, /requestJson<AccessPermission\[]>\('\/api\/access\/permissions'\)/);
  assert.match(workspace, /data-testid="role-preset-select"/);
  assert.match(workspace, /Không dùng mẫu — tự chọn quyền/);
  assert.match(workspace, /resolveRolePresetPermissionKeys\(presetId, permissions\)/);
  assert.match(workspace, /permissionKeys: selectedPermissionKeys/);
  assert.match(workspace, /onChange=\{\(\) => togglePermission\(permission\.permission_key\)\}/);
  assert.match(workspace, /MODULE_LABELS\[module\] \|\| module \|\| 'Nhóm chức năng khác'/);

  for (const presetId of [
    'owner-admin', 'manager-auditor', 'sales-manager', 'sales-rep', 'purchasing',
    'warehouse-manager', 'warehouse-operator', 'accounting', 'dispatcher',
    'driver-delivery', 'mcp-field', 'logistics-manager',
  ]) {
    assert.match(presets, new RegExp(`id: '${presetId}'`));
  }
  assert.match(presets, /INTERNAL_VERIFICATION_PERMISSIONS/);
  assert.match(presets, /permissions\.filter\(\(permission\) => !INTERNAL_VERIFICATION_PERMISSIONS\.has\(permission\.permission_key\)\)/);
});

test('9.1 authorization remains deny-by-default on the backend registry', () => {
  const requestContext = source('../../api/src/request-context.js');
  const permissions = source('../../api/src/access/permissions.js');

  assert.match(requestContext, /if \(!PERMISSION_REGISTRY\.has\(permission\)\) return \{ ok: false, code: 'FORBIDDEN', statusCode: 403 \}/);
  assert.match(requestContext, /!requestContext\.permissions\.includes\(permission\)/);
  assert.match(permissions, /export const PERMISSION_REGISTRY = new Set\(PERMISSION_CATALOG\.map\(\(entry\) => entry\.permissionKey\)\)/);
});

test('9.1 Employee MCP performance uses five UI tabs over the single Phase 8.4 source', () => {
  const workspace = source('../app/components/employee-mcp-reporting-workspace.tsx');

  for (const label of ['Tổng quan', 'Tuyến và phiên', 'Điểm bán và lượt ghé', 'Nhu cầu và đơn hàng', 'Hiệu quả hoạt động']) {
    assert.match(workspace, new RegExp(label));
  }

  assert.equal((workspace.match(/fetch\(`\/api\/reporting\/employee-mcp/g) ?? []).length, 1);
  assert.match(workspace, /activeTab === 'overview'/);
  assert.match(workspace, /activeTab === 'routes'/);
  assert.match(workspace, /activeTab === 'outlets'/);
  assert.match(workspace, /activeTab === 'orders'/);
  assert.match(workspace, /activeTab === 'effectiveness'/);
  assert.match(workspace, /Tổng hợp kế hoạch, điểm đã ghé và số lần ghi nhận hoạt động thực tế/);
  assert.match(workspace, /Theo dõi từ nhu cầu mua, đề nghị mở mã khách đến đơn Công Ty chính thức/);
  assert.doesNotMatch(workspace, /\/api\/reporting\/employee-mcp\/(?:routes|sessions|outlets|orders)/);
});
