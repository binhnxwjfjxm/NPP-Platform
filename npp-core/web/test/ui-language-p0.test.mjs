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
