import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gateway = await readFile(new URL('../lib/company-gateway.ts', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/retail/[...segments]/route.ts', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');

test('lưu nháp, chốt và hoàn tất trả xác nhận ghi ngay, không chờ API tên sản phẩm', () => {
  const mutations = route.slice(route.indexOf('export async function POST'));
  assert.match(mutations, /retailWriteResponse\(result\.data\)/);
  assert.match(mutations, /retailWriteResponse\(reloaded\.data\)/);
  assert.doesNotMatch(mutations, /await enrichRetailProductNames/);
  // Tải chi tiết vẫn bổ sung tên đầy đủ nhưng không được chặn phản hồi ghi.
  const reads = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(reads, /await enrichRetailProductNames\(result\.data, result\.requestId\)/);
  assert.match(route, /function retailWriteResponse\(data: unknown\)/);
  assert.match(route, /normalizeOrderAmounts\(data\)/);
});

test('gateway phân loại timeout 504, mất kết nối 503 và lỗi từ Công Ty theo cùng request ID', () => {
  assert.match(gateway, /setTimeout\(\(\) => controller\.abort\(\), 15_000\)/);
  assert.match(gateway, /const timedOut = controller\.signal\.aborted/);
  assert.match(gateway, /timedOut \? 'COMPANY_TIMEOUT' : 'COMPANY_UNAVAILABLE'/);
  assert.match(gateway, /timedOut \? 504 : 503/);
  assert.match(gateway, /if \(response\.status >= 500\) logCompanyFailure/);
  assert.match(gateway, /requestId: id, operation: companyOperation\(options\.path\)/);
  assert.match(gateway, /return \{ data: payload\.data as T, requestId: payload\.requestId \?\? id \}/);
});

test('log sự cố chỉ ghi mã thao tác cố định, không xuất token và payload ra nhật ký', () => {
  const logging = gateway.slice(gateway.indexOf('function logCompanyFailure('), gateway.indexOf('function workforceToken()'));
  assert.match(logging, /requestId: id/);
  assert.match(logging, /operation: companyOperation\(options\.path\)/);
  assert.match(logging, /durationMs: Date\.now\(\) - startedAt/);
  assert.doesNotMatch(logging, /JSON\.stringify\(options\)/);
  assert.doesNotMatch(logging, /options\.body|Authorization|workforceToken|process\.env|requestUrl/);
  assert.match(gateway, /function requestId\(value\?: string \| null\)/);
});

test('lỗi lưu không báo thành công và tiếp tục xác minh trước khi thử lại', () => {
  assert.match(workspace, /if \(!isSavedCartCurrent\(next\)\)/);
  assert.match(workspace, /await api<Order>\(`\/api\/retail\/orders\/\$\{currentOrder\.id\}`\)/);
  assert.match(workspace, /const latest = await api<Order>\(`\/api\/retail\/orders\/\$\{order\.id\}`\)/);
  assert.match(workspace, /Idempotency-Key': keyFor\('draft-sync'/);
  assert.match(workspace, /Idempotency-Key': keyFor\('create-draft'/);
});
