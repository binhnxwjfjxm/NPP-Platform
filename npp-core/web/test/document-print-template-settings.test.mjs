import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('app/settings/print-templates/print-templates-workspace.tsx');
const settingsTabs = read('app/settings/settings-tabs.tsx');
const sharedPrint = read('app/components/business-document-print.tsx');
const gateway = read('lib/document-print-template-gateway.ts');

test('Cài đặt Mẫu in uses the shared Core gateway and provides field selection plus preview', () => {
  assert.match(settingsTabs, /href: '\/settings\/print-templates'/);
  assert.match(workspace, /Cấu hình mẫu in dùng chung/);
  assert.match(workspace, /Thông tin được in/);
  assert.match(workspace, /Xem trước/);
  assert.match(workspace, /Khôi phục mặc định/);
  assert.match(workspace, /Idempotency-Key/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_|DATABASE_URL/);
});

test('all existing print surfaces resolve one centrally configured template instead of local mutation', () => {
  assert.match(sharedPrint, /documentType/);
  assert.match(sharedPrint, /templateCode/);
  assert.match(sharedPrint, /visibleFieldKeys/);
  assert.match(sharedPrint, /template\?\.pageSize/);
  assert.doesNotMatch(sharedPrint, /method:\s*['"]PATCH['"]/);
});
