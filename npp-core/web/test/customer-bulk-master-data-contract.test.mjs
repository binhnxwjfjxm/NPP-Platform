import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Khách hàng — có hai tab Nhập KH và Cập nhật KH trong cùng khu vực quản lý', () => {
  const launcher = read('app/customers/customer-bulk-tabs-launcher.tsx');
  const page = read('app/customers/page.tsx');
  assert.match(page, /CustomerBulkTabsLauncher/);
  assert.match(launcher, />Nhập KH</);
  assert.match(launcher, />Cập nhật KH</);
  assert.match(launcher, /insertBefore\(nextTabHost, existingButtons\[1\]\)/, 'hai tab bulk phải nằm trước Nhóm khách hàng');
});

test('Cập nhật KH — cột 1 cố định là Mã khách hàng và không cho đổi mapping', () => {
  const source = read('app/customers/customer-bulk-workspace.tsx');
  assert.match(source, /mode === 'update' && index === 0/);
  assert.match(source, /Cột 1 · Mã khách hàng/);
  assert.match(source, /Khóa truy vấn/);
  assert.match(source, /\/api\/customers\/identify/);
  assert.match(source, /\/api\/customers\/bulk-update/);
});

test('Nhập KH — mã có thể để trống và hệ thống tự sinh, không upsert ngầm', () => {
  const source = read('app/customers/customer-bulk-workspace.tsx');
  assert.match(source, /Mã khách hàng có thể để trống để Công Ty tự sinh/);
  assert.match(source, /\/api\/customers\/import/);
  assert.match(source, /Chưa có địa chỉ giao hàng/);
});

test('Bulk KH — apply reuse đúng operationKey do dry-run trả về', () => {
  const source = read('app/customers/customer-bulk-workspace.tsx');
  assert.match(source, /setOperationKey\(envelope\.data\.operationKey \?\? null\)/);
  assert.match(source, /'Idempotency-Key': operationKey/);
  assert.match(source, /expectedUpdatedAt: versionByRow\.get\(row\.rowNumber\)/);
});

test('Web proxy — có đủ ba endpoint bulk khách hàng', () => {
  const identify = read('app/api/customers/identify/route.ts');
  const importRoute = read('app/api/customers/import/route.ts');
  const updateRoute = read('app/api/customers/bulk-update/route.ts');
  const gateway = read('lib/customer-bulk-gateway.ts');
  assert.match(identify, /identifyCustomers/);
  assert.match(importRoute, /importCustomers/);
  assert.match(updateRoute, /bulkUpdateCustomers/);
  assert.match(gateway, /\/api\/customers\/identify/);
  assert.match(gateway, /\/api\/customers\/import/);
  assert.match(gateway, /\/api\/customers\/bulk-update/);
});

test('Bulk KH — timeout đủ cho lô lớn và quay lại danh sách sẽ nạp dữ liệu mới', () => {
  const gateway = read('lib/customer-bulk-gateway.ts');
  const launcher = read('app/customers/customer-bulk-tabs-launcher.tsx');
  assert.match(gateway, /REQUEST_TIMEOUT_MS = 60_000/);
  assert.match(launcher, /modeRef\.current/);
  assert.match(launcher, /window\.location\.reload\(\)/);
});

test('Bulk KH — apply từ API chặn mốc thời gian đối chiếu sai trước khi vào service', () => {
  const route = read('../api/src/routes/customer-bulk.js');
  assert.match(route, /invalidExpectedUpdatedAtRows/);
  assert.match(route, /INVALID_EXPECTED_UPDATED_AT/);
  assert.match(route, /Number\.isNaN\(new Date\(value\)\.getTime\(\)\)/);
});
