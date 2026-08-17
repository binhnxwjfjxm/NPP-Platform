import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');
const styles = read('../app/logistics/trip-reconciliation/trip-reconciliation-workspace.module.css');

test('Issue #615 Lô 5 makes the final reconciliation action explicit without changing close eligibility', () => {
  assert.match(workspace, /Đủ điều kiện chốt đối soát & đóng chuyến/);
  assert.match(workspace, /<h3>Chốt đối soát & đóng chuyến<\/h3>/);
  assert.match(workspace, /disabled=\{busy \|\| !detail\.canClose\}>Chốt đối soát & đóng chuyến<\/button>/);
  assert.match(workspace, /const key = closeKey \|\| createIdempotencyKey\('trip-reconciliation-close'\)/);
  assert.match(workspace, /`\/api\/logistics\/trips\/\$\{detail\.id\}\/close`/);
});

test('Issue #615 Lô 5 shows the blocking reason before close controls while keeping the CTA visible', () => {
  const closeStart = workspace.indexOf('id="trip-reconciliation-close"');
  const closedCardStart = workspace.indexOf('<div className={styles.closedCard}>', closeStart);
  assert.ok(closeStart >= 0 && closedCardStart > closeStart);

  const closeSection = workspace.slice(closeStart, closedCardStart);
  const blocker = closeSection.indexOf('{closeBlockedReason ?');
  const closeTime = closeSection.indexOf('<label>Thời điểm đóng');
  const closeButton = closeSection.indexOf('>Chốt đối soát & đóng chuyến</button>');

  assert.ok(blocker >= 0, 'blocking reason must remain rendered in the close section');
  assert.ok(closeTime > blocker, 'blocking reason must be visible before close controls');
  assert.ok(closeButton > closeTime, 'close CTA must remain present even when disabled');
});

test('Issue #615 Lô 5 keeps a blocked close CTA readable instead of fading it out', () => {
  const blockedDisabled = styles.match(/\.actionBoxBlocked button:disabled\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(blockedDisabled, /opacity:\s*1/);
  assert.match(blockedDisabled, /border:\s*1px solid/);
  assert.match(blockedDisabled, /background:/);
  assert.match(blockedDisabled, /color:\s*var\(--foreground\)/);
  assert.doesNotMatch(blockedDisabled, /opacity:\s*\.45/);
});

test('Issue #615 Lô 5 preserves return history, print and the locked four-step lifecycle', () => {
  for (const label of ['Chọn chuyến', 'Kiểm tra chênh lệch', 'Nhận hàng trả về', 'Đóng chuyến']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /TripReconciliationPrintDock/);
  assert.match(workspace, /Lịch sử kho nhận lại/);
  assert.match(workspace, /return-receipts/);
  assert.match(workspace, /detail\.canClose/);
});
