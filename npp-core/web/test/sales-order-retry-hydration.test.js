import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(
  new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url),
  'utf8',
);

test('any failed confirm recovers the committed draft using its latest revision and a fresh save key', () => {
  assert.match(uiSource, /isConfirm\(request\.path, requestMethod\) && lastSavedDraft/);
  assert.match(uiSource, /draftRecovery = lastSavedDraft/);
  assert.match(uiSource, /sales-save-recovery-/);
  assert.match(uiSource, /expectedRevision: draft\.revision/);
  assert.match(uiSource, /Object\.fromEntries\(new Headers\(request\.init\.headers/);
  assert.match(uiSource, /payload\?\.error\?\.retryable === true \|\| response\.status >= 500/);
  assert.doesNotMatch(uiSource, /failedConfirmOrderIds/);
  assert.doesNotMatch(uiSource, /sales-confirm-retry-/);
});

test('Sales Order timestamps render deterministically in Vietnam time during SSR and hydration', () => {
  assert.match(uiSource, /VIETNAM_UTC_OFFSET_MS = 7 \* 60 \* 60 \* 1000/);
  assert.match(uiSource, /export function formatVietnamDateTime/);
  assert.match(workspaceSource, /formatVietnamDateTime\(order\.updatedAt\)/);
  assert.doesNotMatch(workspaceSource, /toLocaleString\('vi-VN'\)/);
});
