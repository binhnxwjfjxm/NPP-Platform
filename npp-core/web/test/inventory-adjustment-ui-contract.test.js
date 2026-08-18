import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/inventory/adjustments/page.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/inventory/adjustments/workspace.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/inventory-adjustment-gateway.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../lib/inventory-adjustment-types.ts', import.meta.url), 'utf8');
const workflowErrors = readFileSync(new URL('../lib/inventory-workflow-errors.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/adjustments/[[...segments]]/route.ts', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../app/api/inventory/_shared.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('adjustment screen lives under Inventory and keeps mutation actions in action rows', () => {
  assert.match(shell, /\/inventory\/adjustments/);
  assert.match(shell, /nav-inventory-adjustments/);
  assert.match(workspace, /inventory-adjustment-page-actions/);
  assert.match(workspace, /inventory-adjustment-document-actions/);
  assert.doesNotMatch(workspace, /Balance[^\n]*(button|onClick)/i);
  assert.doesNotMatch(workspace, /Ledger[^\n]*(button|onClick)/i);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /role="status"/);
  assert.match(workspace, /createIdempotencyKey\('inventory-adjustment'\)/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(workspace, /Date\.now\(\)/);
});

test('adjustment UI presents the office workflow and one final stock update step', () => {
  assert.match(workspace, /Lập phiếu điều chỉnh/);
  assert.match(workspace, /Gửi duyệt/);
  assert.match(workspace, />Duyệt</);
  assert.match(workspace, /Cập nhật tồn kho/);
  assert.match(workspace, /Tồn kho chưa thay đổi\. Chọn Cập nhật tồn kho để hoàn tất\./);
  assert.doesNotMatch(workspace, />Ghi sổ</);
  assert.doesNotMatch(workspace, /Bút toán kho/);
  assert.doesNotMatch(workspace, /Phiên bản/);
  assert.doesNotMatch(workspace, /window\.prompt/);
  assert.match(types, /DRAFT: 'Lập phiếu'/);
  assert.match(types, /APPROVED: 'Chờ cập nhật tồn'/);
  assert.match(types, /POSTED: 'Hoàn tất'/);
});

test('adjustment UI separates source, product, lot, location and quantity effect', () => {
  assert.match(workspace, /Nguồn:/);
  assert.match(workspace, /Điều chỉnh thủ công/);
  assert.match(workspace, /Sản phẩm \/ Lô \/ Vị trí/);
  assert.match(workspace, /Sản phẩm:/);
  assert.match(workspace, /Lô:/);
  assert.match(workspace, /Vị trí:/);
  assert.match(workspace, /Tồn hiện tại/);
  assert.match(workspace, /Điều chỉnh \{formatSignedExactDecimal\(delta\)\}/);
  assert.match(workspace, /Tồn sau điều chỉnh/);
  assert.match(workspace, /addExactDecimal\(loadedOnHand, delta\)/);
  assert.match(workspace, /canPreviewResult/);
});

test('adjustment errors translate self approval and never expose raw backend messages', () => {
  assert.match(workflowErrors, /SELF_APPROVAL_DENIED/);
  assert.match(workflowErrors, /Bạn không thể tự duyệt phiếu mình đã gửi\./);
  assert.match(workspace, /inventoryWorkflowErrorMessage\(payload\?\.error\)/);
  assert.doesNotMatch(workspace, /payload\?\.error\?\.message/);
});

test('web screen uses a real server gateway and catch-all proxy', () => {
  assert.match(page, /listInventoryAdjustments/);
  assert.match(page, /loadInventorySnapshot/);
  assert.match(page, /loadOrganizationSnapshot/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /Idempotency-Key/);
  assert.match(route, /transitionInventoryAdjustment/);
  assert.match(route, /submit.*approve.*post.*cancel.*reverse/s);
});

test('adjustment proxy preserves the domain gateway status instead of collapsing errors to 503', () => {
  assert.match(sharedRoute, /normalizeError: GatewayErrorNormalizer = normalizeInventoryGatewayError/);
  assert.match(route, /normalizeInventoryAdjustmentGatewayError/);
  assert.equal((route.match(/errorResponse\(error, requestId, normalizeInventoryAdjustmentGatewayError\)/g) ?? []).length, 2);
});
