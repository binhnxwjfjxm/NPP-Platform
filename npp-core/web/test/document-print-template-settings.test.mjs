import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('app/settings/print-templates/print-templates-workspace.tsx');
const settingsTabs = read('app/settings/settings-tabs.tsx');
const sharedPrint = read('app/components/business-document-print.tsx');
const gateway = read('lib/document-print-template-gateway.ts');

test('Cài đặt Mẫu in dùng cấu hình chung, có phần đầu phiếu và xem trước theo renderer thật', () => {
  assert.match(settingsTabs, /href: '\/settings\/print-templates'/);
  assert.match(workspace, /Cấu hình mẫu in dùng chung/);
  assert.match(workspace, /Phần đầu phiếu/);
  assert.match(workspace, /Tên Công Ty/);
  assert.match(workspace, /Loại đơn/);
  assert.match(workspace, /headingVisible/);
  assert.match(workspace, /headingAlign/);
  assert.match(workspace, /titleAlign/);
  assert.match(workspace, /heading: heading\.trim\(\) \|\| null/);
  assert.match(workspace, /maxLength=\{160\}/);
  assert.match(workspace, /business-document-print\.module\.css/);
  assert.match(workspace, /printStyles\.header/);
  assert.match(workspace, /printStyles\.table/);
  assert.match(workspace, /Thông tin được in/);
  assert.match(workspace, /Xem trước/);
  assert.match(workspace, /Khôi phục mặc định/);
  assert.match(workspace, /Idempotency-Key/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_|DATABASE_URL/);
});

test('phiếu in thực tế nhận đúng cấu hình hiển thị và canh Tên Công Ty / loại đơn', () => {
  assert.match(sharedPrint, /documentType/);
  assert.match(sharedPrint, /templateCode/);
  assert.match(sharedPrint, /visibleFieldKeys/);
  assert.match(sharedPrint, /template\?\.pageSize/);
  assert.match(sharedPrint, /const headingVisible = template\?\.headingVisible \?\? true/);
  assert.match(sharedPrint, /const headingAlign = template\?\.headingAlign \?\? 'left'/);
  assert.match(sharedPrint, /const titleAlign = template\?\.titleAlign \?\? 'right'/);
  assert.match(sharedPrint, /style=\{\{ textAlign: headingAlign \}\}/);
  assert.match(sharedPrint, /style=\{\{ textAlign: titleAlign \}\}/);
  assert.match(sharedPrint, /headingVisible && displayHeading/);
  assert.doesNotMatch(sharedPrint, /method:\s*['"]PATCH['"]/);
});
