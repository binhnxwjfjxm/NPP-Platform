import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 4 renders leave balance inside Nghỉ và đơn nghỉ without a new sidebar item', async () => {
  const [workspace, shell] = await Promise.all([
    source('app/workforce/leave/leave-workspace.tsx'),
    source('app/components/app-shell-core.tsx'),
  ]);
  assert.match(workspace, /Số dư và sổ phép/);
  assert.match(workspace, /Số dư theo ngày và lịch sử phát sinh/);
  assert.match(workspace, /Ghi sổ phép/);
  assert.match(workspace, /Cấp đầu kỳ/);
  assert.match(workspace, /Chuyển năm/);
  assert.match(workspace, /Nghỉ bù/);
  assert.equal((shell.match(/href: '\/workforce\/leave'/g) ?? []).length, 1);
});

test('Issue #1140 Lô 4 exposes balance policy controls and canonical retry-safe mutation', async () => {
  const [workspace, gateway, route] = await Promise.all([
    source('app/workforce/leave/leave-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/leave/balances/entries/route.ts'),
  ]);
  assert.match(workspace, /Theo dõi số dư phép/);
  assert.match(workspace, /Cho phép số dư âm/);
  assert.match(workspace, /\/api\/workforce\/leave\/balances\/entries/);
  assert.match(workspace, /stableKey\(balanceAttempt, 'web-leave-balance-entry'/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'leave-balance-entry'\)/);
  assert.match(route, /request\.headers\.get\('idempotency-key'\)/);
});

test('Issue #1140 Lô 4 keeps office-language balance UX and does not expose delete/edit ledger actions', async () => {
  const workspace = await source('app/workforce/leave/leave-workspace.tsx');
  assert.match(workspace, /Ngày hiệu lực/);
  assert.match(workspace, /Lý do/);
  assert.match(workspace, /Phát sinh gần nhất/);
  assert.doesNotMatch(workspace, />Xóa bút toán</);
  assert.doesNotMatch(workspace, />Sửa bút toán</);
});
