import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 5 adds one compact workforce navigation item with two business tabs', async () => {
  const [shell, workspace] = await Promise.all([
    source('app/components/app-shell-core.tsx'),
    source('app/workforce/overtime/overtime-closeout-workspace.tsx'),
  ]);
  assert.equal((shell.match(/href: '\/workforce\/overtime'/g) ?? []).length, 1);
  assert.match(shell, /Tăng ca & chốt công/);
  assert.match(workspace, />Tăng ca</);
  assert.match(workspace, />Chốt công</);
  assert.match(workspace, /Đăng ký → duyệt → thực tế → xác nhận giờ tính/);
  assert.match(workspace, /Đang tổng hợp → Cần xử lý → Đã đối soát → Đã chốt/);
});

test('Issue #1140 Lô 5 uses retry-safe canonical mutations for OT and closeout', async () => {
  const [workspace, gateway] = await Promise.all([
    source('app/workforce/overtime/overtime-closeout-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
  ]);
  assert.match(workspace, /stableKey\(overtimeAttempt, 'web-overtime-submit'/);
  assert.match(workspace, /stableKey\(reviewAttempt, 'web-overtime-review'/);
  assert.match(workspace, /stableKey\(actualAttempt, 'web-overtime-actual'/);
  assert.match(workspace, /stableKey\(confirmAttempt, 'web-overtime-confirm'/);
  assert.match(workspace, /stableKey\(periodAttempt, 'web-attendance-period-action'/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'overtime-submit'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-period-action'\)/);
});

test('Issue #1140 Lô 5 only exposes closed attendance snapshot as payroll input and does not add Payroll navigation early', async () => {
  const [workspace, shell, gateway] = await Promise.all([
    source('app/workforce/overtime/overtime-closeout-workspace.tsx'),
    source('app/components/app-shell-core.tsx'),
    source('lib/workforce-gateway.ts'),
  ]);
  assert.match(workspace, /Bản chốt kỳ công lần/);
  assert.match(workspace, /Chỉ đọc/);
  assert.match(workspace, /Giờ tăng ca đã xác nhận/);
  assert.match(gateway, /attendance\/payroll-input/);
  assert.equal((shell.match(/href: '\/workforce\/payroll'/g) ?? []).length, 0);
});

test('Issue #1140 Lô 5 web routes forward the same incoming idempotency key', async () => {
  const routes = await Promise.all([
    source('app/api/workforce/overtime/route.ts'),
    source('app/api/workforce/overtime/review/route.ts'),
    source('app/api/workforce/overtime/actual/route.ts'),
    source('app/api/workforce/overtime/confirm/route.ts'),
    source('app/api/workforce/attendance/periods/route.ts'),
  ]);
  for (const route of routes) assert.match(route, /headers\.get\('idempotency-key'\)/);
});
