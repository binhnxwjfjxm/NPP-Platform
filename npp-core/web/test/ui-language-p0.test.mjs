import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('P0 Core UI keeps developer and infrastructure language off business surfaces', () => {
  const login = read('app/login/page.tsx');
  const roles = read('app/access/roles/role-workspace.tsx');
  const audit = read('app/operations/audit-history/page.tsx');
  const jobs = read('app/operations/import-export-history/page.tsx');
  const numbering = read('app/document-numbering/document-numbering-workspace.tsx');
  const receivables = read('app/accounting/receivables/page.tsx');
  const logistics = read('app/logistics/trips/trip-planning-workspace.tsx');
  const organization = read('app/organization/organization-workspace.tsx');
  const products = read('app/products/product-workspace.tsx');

  assert.doesNotMatch(login, /Welcome to Hung Phat Operations|Hưng Phát Company|Security\/Implementation Owner|email Owner|NPP Core/);
  assert.doesNotMatch(roles, /Web\/PWA:|Security Owner|Role giao nhận|\bfield\b|role kế toán/);

  assert.doesNotMatch(audit, /Audit & hoạt động hệ thống|append-only|Metadata only|Có snapshot thay đổi|Nguồn \/ request|Phase 8\.7/);
  assert.match(audit, /Lịch sử thay đổi hệ thống/);
  assert.match(audit, /<summary>Thông tin kỹ thuật<\/summary>/);

  assert.doesNotMatch(jobs, /Ví dụ: products|Yêu cầu: \{row\.requestId\}|Phiên bản \{row\.definitionVersion\}/);
  assert.match(jobs, /definitionLabel/);
  assert.match(jobs, /<summary>Thông tin kỹ thuật<\/summary>/);

  assert.doesNotMatch(numbering, /Mã yêu cầu|allocation-key-input|Tạo mã yêu cầu mới|function requestKey/);
  assert.match(numbering, /createIdempotencyKey\('document-number-reference'\)/);

  assert.doesNotMatch(receivables, /\{detail\.collectionPolicy\}|\{entry\.entryType\}|\{entry\.requestId\}|detail\.salesOrderId/);
  assert.match(receivables, /collectionPolicyLabel/);
  assert.match(receivables, /ledgerEntryLabel/);

  assert.doesNotMatch(logistics, /hợp đồng API|installation hiện tại|Phiếu giao thiếu mã canonical/);
  assert.match(logistics, /createIdempotencyKey\('web-logistics'\)/);

  for (const source of [organization, products]) {
    assert.doesNotMatch(source, /Mở màn hình xử lý:/);
    assert.doesNotMatch(source, /error\?\.message \|\| error\?\.code/);
    assert.match(source, /managementScreenLabel/);
  }
});

test('P2 Core UI keeps office wording and object-specific statuses consistent', () => {
  const shell = read('app/components/app-shell-core.tsx');
  const dashboard = read('app/dashboard/page.tsx');
  const users = read('app/access/users/user-workspace.tsx');
  const employees = read('app/access/employees/employee-workspace.tsx');
  const roles = read('app/access/roles/role-workspace.tsx');
  const suppliers = read('app/suppliers/supplier-workspace.tsx');
  const products = read('app/products/product-workspace.tsx');
  const dataExchange = read('app/operations/data-exchange/data-exchange-view.tsx');

  assert.doesNotMatch(shell, /Giá bán & khuyến mãi|Vai trò & phân quyền|Điều chỉnh & xử lý tồn|Lập & xếp chuyến|Bàn giao & xuất phát|COD & đối soát|Nhập \/ xuất dữ liệu|Lịch sử nhập \/ xuất/);
  assert.match(shell, /Giá bán và khuyến mãi/);
  assert.match(shell, /Nhập\/xuất dữ liệu/);

  assert.doesNotMatch(dashboard, /Bán hàng & khách hàng|Mua hàng & kho|Giao hàng & công nợ|Lập & xếp chuyến/);
  assert.doesNotMatch(users, /Không hoạt động|có quyền sử dụng app|Nhân sự &amp; phân quyền/);
  assert.match(users, /Đang hoạt động/);
  assert.match(users, /Ngừng sử dụng/);

  assert.doesNotMatch(employees, /Ngừng hoạt động|Kích hoạt nhân sự/);
  assert.match(employees, /Đang làm việc/);
  assert.match(employees, /Ngừng làm việc/);

  assert.doesNotMatch(roles, /Ngừng hoạt động|Vai trò đã được kích hoạt/);
  assert.match(roles, /Đang sử dụng/);
  assert.match(roles, /Ngừng sử dụng/);

  assert.doesNotMatch(suppliers, />Hoạt động<|Không hoạt động/);
  assert.match(suppliers, /Đang hoạt động/);
  assert.match(suppliers, /Ngừng sử dụng/);

  assert.doesNotMatch(products, /Đơn vị &amp;|>Hoạt động<|>Ngừng</);
  assert.match(products, /Mã hàng \(SKU\)/);
  assert.match(products, /Đang sử dụng/);

  assert.doesNotMatch(dataExchange, /Nhập \/ xuất|FIXED_PRICE|backend đối chiếu|định dạng kỹ thuật ở phía sau|Theo ngành \/ nhóm|Chọn kho \/ vị trí \/ SKU \/ lô/);
  assert.match(dataExchange, /Nhập\/xuất dữ liệu và báo giá/);
  assert.match(dataExchange, /Tệp chỉ cần Mã hàng \(SKU\) và Giá bán/);
});

test('touched mutation paths use the shared canonical idempotency generator and preserve retry keys', () => {
  const roles = read('app/access/roles/role-workspace.tsx');
  const numbering = read('app/document-numbering/document-numbering-workspace.tsx');
  const logistics = read('app/logistics/trips/trip-planning-workspace.tsx');
  const organization = read('app/organization/organization-workspace.tsx');

  for (const source of [roles, numbering, logistics, organization]) {
    assert.match(source, /createIdempotencyKey/);
    assert.doesNotMatch(source, /`web-\$\{crypto\.randomUUID\(\)\}`/);
  }

  assert.match(roles, /mutationKeys\.current\.get\(scope\)/);
  assert.match(logistics, /operationKeys\.current\.get\(scope\)/);
  assert.match(organization, /mutationKeys\.current\.get\(operationScope\)/);
  assert.match(numbering, /headers: \{ 'Content-Type': 'application\/json', 'Idempotency-Key': allocationKey \}/);
});
