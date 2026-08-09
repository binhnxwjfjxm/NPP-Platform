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

test('failed confirms recover drafts per order using the latest revision and a fresh save key', () => {
  assert.match(uiSource, /const draftRecoveries = new Map<string, DraftRecovery>\(\)/);
  assert.match(uiSource, /draftRecoveries\.set\(confirmedOrderId, lastSavedDraft\)/);
  assert.match(uiSource, /draftRecoveries\.delete\(confirmedOrderId\)/);
  assert.match(uiSource, /recoveryForDraftPath/);
  assert.match(uiSource, /sales-save-recovery-/);
  assert.match(uiSource, /expectedRevision: draft\.revision/);
  assert.match(uiSource, /Object\.fromEntries\(new Headers\(request\.init\.headers/);
  assert.match(uiSource, /payload\?\.error\?\.retryable === true \|\| response\.status >= 500/);
  assert.doesNotMatch(uiSource, /failedConfirmOrderIds/);
  assert.doesNotMatch(uiSource, /sales-confirm-retry-/);
});

test('a successful confirm only clears recovery for that confirmed order', () => {
  assert.match(uiSource, /draftRecoveries\.delete\(confirmedOrderId\)/);
  assert.match(uiSource, /lastSavedDraft\?\.order\.id === confirmedOrderId/);
  assert.doesNotMatch(uiSource, /draftRecoveries\.clear\(\)/);
});

test('Sales Order timestamps render deterministically in Vietnam time during SSR and hydration', () => {
  assert.match(uiSource, /VIETNAM_UTC_OFFSET_MS = 7 \* 60 \* 60 \* 1000/);
  assert.match(uiSource, /export function formatVietnamDateTime/);
  assert.match(workspaceSource, /formatVietnamDateTime\(order\.updatedAt\)/);
  assert.doesNotMatch(workspaceSource, /toLocaleString\('vi-VN'\)/);
});
