import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 8.7 NPP keeps detailed history while business UI hides technical jargon by default', () => {
  const audit = source('../app/operations/audit-history/page.tsx');
  const jobs = source('../app/operations/import-export-history/page.tsx');
  const gateway = source('../lib/operations-history-gateway.ts');

  assert.match(audit, /Lịch sử thay đổi hệ thống/);
  assert.match(audit, /Thông tin kỹ thuật/);
  assert.match(audit, /actionLabel/);
  assert.match(audit, /resourceLabel/);
  assert.doesNotMatch(audit, /Audit & hoạt động hệ thống|append-only|Metadata only|Có snapshot thay đổi|Nguồn \/ request|sales\.order\.confirmed|placeholder="sales-order"|placeholder="npp"/);

  assert.match(jobs, /Lịch sử nhập\/xuất dữ liệu/);
  assert.match(jobs, /definitionLabel/);
  assert.match(jobs, /Có lỗi cần xử lý/);
  assert.match(jobs, /Thông tin kỹ thuật/);
  assert.doesNotMatch(jobs, /Ví dụ: products|Yêu cầu: \{row\.requestId\}|Phiên bản \{row\.definitionVersion\}/);

  assert.match(gateway, /\/api\/reporting\/audit-history/);
  assert.match(gateway, /\/api\/reporting\/import-export-history/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /process\.env\.CORE_API_SERVER_TOKEN/);
  assert.doesNotMatch(audit, /beforeData|afterData/);
});
