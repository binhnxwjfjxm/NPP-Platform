import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(
  new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url),
  'utf8',
);
const formSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url),
  'utf8',
);

test('each Sales Order form owns the exact committed draft used for confirm retry', () => {
  assert.match(formSource, /const committedDraftRef = useRef<SalesOrder \| null>\(null\)/);
  assert.match(formSource, /draftRecoveryTarget\([\s\S]*committedDraftRef\.current/);
  assert.match(formSource, /path = recovery\.path/);
  assert.match(formSource, /expectedRevision: recovery\.expectedRevision/);
  assert.match(formSource, /committedDraftRef\.current = savedOrder/);
  assert.match(formSource, /committedDraftRef\.current = null/);
  assert.match(formSource, /setSaveKey\(mutationKey\(`sales-\$\{props\.mode\}-save`\)\)/);
});

test('draft recovery targets the committed order itself and has no shared mutable form state', () => {
  assert.match(uiSource, /export function draftRecoveryTarget/);
  assert.match(uiSource, /`\/api\/sales-orders\/\$\{order\.id\}\/draft`/);
  assert.match(uiSource, /expectedRevision: draft\.revision/);
  assert.doesNotMatch(uiSource, /lastSavedDraft/);
  assert.doesNotMatch(uiSource, /draftRecoveries/);
  assert.doesNotMatch(uiSource, /recoveryForDraftPath/);
  assert.doesNotMatch(uiSource, /sales-save-recovery-/);
});

test('retryable confirm failures keep the server idempotency key while non-retryable fixes rotate it', () => {
  assert.match(uiSource, /payload\?\.error\?\.retryable === true \|\| response\.status >= 500 \|\| priceChangedConfirm/);
  assert.match(formSource, /error\.code === 'SALES_PRICE_CHANGED'[\s\S]*setConfirmKey\(mutationKey/);
  assert.match(formSource, /!error\.retryable[\s\S]*setSaveKey\(mutationKey[\s\S]*setConfirmKey\(mutationKey/);
});

test('Sales Order timestamps render deterministically in Vietnam time during SSR and hydration', () => {
  assert.match(uiSource, /VIETNAM_UTC_OFFSET_MS = 7 \* 60 \* 60 \* 1000/);
  assert.match(uiSource, /export function formatVietnamDateTime/);
  assert.match(workspaceSource, /formatVietnamDateTime\(order\.updatedAt\)/);
  assert.doesNotMatch(workspaceSource, /toLocaleString\('vi-VN'\)/);
});
