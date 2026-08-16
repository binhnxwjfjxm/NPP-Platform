import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workspaceSource = read('app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');
const styles = read('app/logistics/trip-reconciliation/trip-reconciliation-workspace.module.css');

test('Issue #600 Lot C keeps the locked four-step reconciliation lifecycle untouched', () => {
  for (const label of ['Chọn chuyến', 'Kiểm tra chênh lệch', 'Nhận hàng trả về', 'Đóng chuyến']) {
    assert.match(workspaceSource, new RegExp(label));
  }
  assert.match(workspaceSource, /detail\.canClose/);
  assert.match(workspaceSource, /createIdempotencyKey\('trip-reconciliation-receive'\)/);
  assert.match(workspaceSource, /createIdempotencyKey\('trip-reconciliation-close'\)/);
  assert.match(workspaceSource, /const key = receiptKey \|\| createIdempotencyKey/);
  assert.match(workspaceSource, /const key = closeKey \|\| createIdempotencyKey/);
});

test('Issue #600 Lot C removes the nested-card feel from reconciliation detail', () => {
  const detailPanel = styles.match(/\.detailPanel\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(detailPanel, /border:\s*0/);
  assert.match(detailPanel, /background:\s*transparent/);
  assert.match(detailPanel, /box-shadow:\s*none/);

  const actionBox = styles.match(/\.actionBox\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(actionBox, /border:\s*0/);
  assert.match(actionBox, /border-top:\s*1px solid var\(--border\)/);
  assert.match(actionBox, /border-radius:\s*0/);
  assert.match(actionBox, /background:\s*transparent/);

  const receiptRow = styles.match(/\.receipts article\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(receiptRow, /border:\s*0/);
  assert.match(receiptRow, /border-bottom:\s*1px solid var\(--border\)/);
  assert.match(receiptRow, /border-radius:\s*0/);
});

test('Issue #600 Lot C makes blockers and reconciliation counts prominent without oversized controls', () => {
  assert.match(workspaceSource, /Dòng còn trên xe/);
  assert.match(workspaceSource, /Dòng chưa có kết quả giao/);
  assert.match(workspaceSource, /Chưa thể đóng:/);

  const nextAction = styles.match(/\.nextActionCard\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(nextAction, /border-left:\s*4px solid var\(--primary\)/);
  assert.match(nextAction, /border:\s*0/);

  const blocker = styles.match(/\.blockReason\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(blocker, /border-left:\s*3px solid #f59e0b/);
  assert.match(blocker, /font-weight:\s*700/);

  assert.match(styles, /\.heading button, \.actionBox button, \.nextActionCard button\s*\{[\s\S]*min-height:\s*36px/);
});

test('Issue #600 Lot C keeps the four-step rail and two key counters compact on mobile', () => {
  const mobile = styles.slice(styles.indexOf('@media (max-width: 560px)'));
  assert.match(mobile, /\.flowSteps\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(72px, 1fr\)\)/);
  assert.match(mobile, /\.nextActionStats\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(mobile, /\.flowSteps\s*\{[^}]*grid-template-columns:\s*1fr/);
});
