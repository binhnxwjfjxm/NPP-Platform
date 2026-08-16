import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const gatewaySource = read('lib/logistics-gateway.ts');
const proxySource = read('app/api/logistics/trips/[tripId]/[action]/route.ts');
const workspaceSource = read('app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');
const appShellCoreSource = read('app/components/app-shell-core.tsx');

test('NPP gateway allows only explicit reconciliation trip actions', () => {
  assert.match(gatewaySource, /READ_ACTIONS\s*=\s*new Set\(\['dispatch',\s*'reconciliation'\]\)/);
  assert.match(gatewaySource, /'return-receipts'/);
  assert.match(gatewaySource, /'close'/);
  assert.match(gatewaySource, /k(?:ey)?\s*===?\s*'status'\s*&&\s*v(?:alue)?\s*===?\s*'all'/);
  assert.match(gatewaySource, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gatewaySource, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(gatewaySource, /NEXT_PUBLIC_.*TOKEN/);
});

test('same-origin proxy preserves idempotency for reconciliation mutations', () => {
  assert.match(proxySource, /request\.headers\.get\('idempotency-key'\)/);
  assert.match(proxySource, /readJsonBody/);
  assert.match(proxySource, /transitionDeliveryTrip/);
});

test('workspace keeps custody lifecycle and uses the shared idempotency contract', () => {
  assert.match(workspaceSource, /Đối soát cuối chuyến/);
  assert.match(workspaceSource, /outstandingBaseQuantity/);
  assert.match(workspaceSource, /returnedBaseQuantity/);
  assert.match(workspaceSource, /\/return-receipts/);
  assert.match(workspaceSource, /\/close/);
  assert.match(workspaceSource, /import \{ createIdempotencyKey \} from '@npp\/contracts';/);
  assert.match(workspaceSource, /createIdempotencyKey\('trip-reconciliation-receive'\)/);
  assert.match(workspaceSource, /createIdempotencyKey\('trip-reconciliation-close'\)/);
  assert.doesNotMatch(workspaceSource, /function freshKey|crypto\.randomUUID\(\)/);
  assert.match(workspaceSource, /Xác nhận nhập hàng về kho/);
  assert.match(workspaceSource, /Đóng chuyến đã đối soát/);
  assert.doesNotMatch(workspaceSource, /driverId|employeeId|DATABASE_URL|CORE_API_SERVER_TOKEN/);
});

test('workspace makes the four reconciliation steps and close blocker visible', () => {
  assert.match(workspaceSource, /Chọn chuyến/);
  assert.match(workspaceSource, /Kiểm tra chênh lệch/);
  assert.match(workspaceSource, /Nhận hàng trả về/);
  assert.match(workspaceSource, /Đóng chuyến/);
  assert.match(workspaceSource, /Việc tiếp theo/);
  assert.match(workspaceSource, /Dòng còn trên xe/);
  assert.match(workspaceSource, /Chưa thể đóng:/);
  assert.match(workspaceSource, /Cần đối soát/);
  assert.match(workspaceSource, /Đủ điều kiện/);
  assert.match(workspaceSource, /Đã đóng/);
  assert.match(workspaceSource, /Lịch sử kho nhận lại/);
  assert.match(workspaceSource, /Mã nhập kho:/);
  assert.doesNotMatch(workspaceSource, /Movement:/);
});

test('persistent logistics navigation exposes reconciliation workspace', () => {
  assert.match(appShellCoreSource, /href: '\/logistics\/trip-reconciliation'/);
  assert.match(appShellCoreSource, /label: 'Đối soát cuối chuyến'/);
  assert.match(appShellCoreSource, /testId: 'nav-logistics-trip-reconciliation'/);
});
