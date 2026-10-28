import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.module.css', import.meta.url), 'utf8');
const proxy = await readFile(new URL('../app/api/inventory/manual-inbounds/operator/[action]/route.ts', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../lib/manual-inbound-operator-gateway.ts', import.meta.url), 'utf8');

test('Lô 3 giữ mỗi sản phẩm trên một dòng và đánh dấu trường bắt buộc ngay tại ô', () => {
  assert.doesNotMatch(workspace, /previewDetailRow/);
  assert.doesNotMatch(workspace, /errorList/);
  assert.doesNotMatch(workspace, /<Fragment/);
  assert.match(workspace, /requiredMark/);
  assert.match(css, /\.requiredMark\{[^}]*color:#dc2626/);
  assert.match(workspace, /Bổ sung trực tiếp tại ô có dấu \* đỏ/);
  assert.match(workspace, /row\.requiredFields\.includes\('LOCATION'\)/);
  assert.match(workspace, /row\.requiredFields\.includes\('EXPIRY'\)/);
  assert.match(workspace, /showCost \? <div className=\{styles\.inlineEditor\}>/);
});

test('XÁC NHẬN NHẬP dùng shared canonical Idempotency-Key và retry giữ nguyên intent', () => {
  assert.match(workspace, /createIdempotencyKey\('manual-inbound-confirm'\)/);
  assert.match(workspace, /pendingConfirm\.current = pending/);
  assert.match(workspace, /headers: \{ 'Idempotency-Key': pending\.key \}/);
  assert.match(workspace, /body: pending\.body/);
  assert.match(workspace, /XÁC NHẬN NHẬP/);
  assert.match(gateway, /normalizeIdempotencyKey/);
  assert.match(gateway, /isValidIdempotencyKey/);
  assert.match(gateway, /operator\/confirm/);
  assert.match(proxy, /request\.headers\.get\('Idempotency-Key'\)/);
});

test('Lô 3 có lịch sử lọc nghiệp vụ và đảo chứng từ append-only', () => {
  assert.match(workspace, /Lịch sử nhập kho thủ công/);
  assert.match(workspace, /Số phiếu hoặc tham chiếu/);
  assert.match(workspace, /Đảo chứng từ/);
  assert.match(workspace, /createIdempotencyKey\('manual-inbound-reverse'\)/);
  assert.match(gateway, /MANUAL_INBOUND_CORRECTION/);
  assert.match(gateway, /operator\/history/);
  assert.match(proxy, /params\.action === 'history'/);
  assert.match(proxy, /reverseManualInboundOperator/);
});

test('Mất phản hồi xác nhận: đối chiếu cùng khóa, không tạo phiếu mới hay che lỗi lịch sử', () => {
  assert.match(workspace, /confirmationRecovery === 'unresolved'/);
  assert.match(workspace, /getManualInboundConfirmationStatus|checkConfirmationStatus/);
  assert.match(workspace, /idempotencyKey:|\x27Idempotency-Key\x27: pending\.key/);
  assert.match(workspace, /finishInboundConfirmation\(status\.document\)/);
  assert.match(workspace, /if \(confirmingRef\.current/);
  assert.match(workspace, /Không tạo phiếu khác cho lần nhập này/);
  assert.doesNotMatch(workspace, /if \(!append\) \{\s*setHistory\(\[\]\)/);
  assert.match(workspace, /historyMessage \? null : <p className=\{styles\.emptyState\}>Chưa có chứng từ phù hợp/);
  assert.match(workspace, /loadHistory\(\x27\x27, \x27\x27\)/);
  assert.match(gateway, /operator\/confirmation-status/);
  assert.match(proxy, /params\.action === 'confirmation-status'/);
});
