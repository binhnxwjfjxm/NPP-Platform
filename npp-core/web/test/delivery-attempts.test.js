import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const gatewaySource = read('lib/delivery-attempt-gateway.ts');
const routeSource = read('app/api/logistics/trips/[tripId]/attempts/route.ts');
const workspaceSource = read('app/logistics/delivery-attempts/delivery-attempt-workspace.tsx');
const appShellSource = read('app/components/app-shell.tsx');

test('NPP attempt gateway is server-only and read-only', () => {
  assert.match(gatewaySource, /import 'server-only'/);
  assert.match(gatewaySource, /CORE_API_SERVER_TOKEN/);
  assert.match(gatewaySource, /method: 'GET'/);
  assert.match(gatewaySource, /cache: 'no-store'/);
  assert.doesNotMatch(gatewaySource, /NEXT_PUBLIC_.*TOKEN/);
  assert.doesNotMatch(gatewaySource, /method: '(POST|PUT|PATCH|DELETE)'/);
});

test('NPP route exposes GET summary only', () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /getDeliveryAttemptSummary/);
  assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)/);
});

test('dispatcher workspace reads attempt summary without driver mutation', () => {
  assert.match(workspaceSource, /Theo dõi kết quả lần giao/);
  assert.match(workspaceSource, /Đọc kết quả tài xế đã ghi/);
  assert.match(workspaceSource, /\/attempts/);
  assert.match(workspaceSource, /delivered_full/);
  assert.match(workspaceSource, /delivered_partial/);
  assert.match(workspaceSource, /failed/);
  assert.match(workspaceSource, /rescheduled/);
  assert.match(workspaceSource, /không tạo Inventory IN/);
  assert.doesNotMatch(workspaceSource, /method:\s*'(POST|PUT|PATCH|DELETE)'|Idempotency-Key|driverId|employeeId/);
});

test('logistics navigation exposes read-only attempt monitor', () => {
  assert.match(appShellSource, /\/logistics\/delivery-attempts/);
  assert.match(appShellSource, /Kết quả lần giao/);
  assert.match(appShellSource, /logistics-attempt-shortcut/);
});
