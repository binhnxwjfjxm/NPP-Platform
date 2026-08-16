import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceUrl = new URL('../app/settings/data-backup/data-backup-workspace.tsx', import.meta.url);
const gatewayUrl = new URL('../lib/business-data-export-gateway.ts', import.meta.url);
const routeUrl = new URL('../app/api/reporting/business-export/route.ts', import.meta.url);

test('Issue #562 Part 2 presents business Excel before the technical backup area', async () => {
  const source = await readFile(workspaceUrl, 'utf8');
  const businessIndex = source.indexOf('SỐ LIỆU DOANH NGHIỆP');
  const technicalIndex = source.indexOf('SAO LƯU HỆ THỐNG');
  assert.ok(businessIndex >= 0 && technicalIndex > businessIndex);
  assert.match(source, /XUẤT SỐ LIỆU/);
  assert.match(source, /\/api\/reporting\/business-export/);
  assert.match(source, /người dùng được cấp quyền xem/);
  assert.doesNotMatch(source.slice(businessIndex, technicalIndex), /MỞ KHU VỰC KỸ THUẬT|Mã mở khóa|one-time-code/);
  assert.match(source, /createIdempotencyKey/);
});

test('business export uses normal workforce auth and streams Core XLSX without technical OTP', async () => {
  const [gateway, route] = await Promise.all([
    readFile(gatewayUrl, 'utf8'),
    readFile(routeUrl, 'utf8'),
  ]);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.match(gateway, /\/api\/reporting\/business-export/);
  assert.doesNotMatch(gateway, /technical|unlock|backup.*cookie|otp/i);
  assert.match(route, /new Response\(response\.body/);
  assert.match(route, /Content-Disposition/);
  assert.doesNotMatch(route, /arrayBuffer\(|blob\(/);
});
