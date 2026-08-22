import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('Lô 4 MCP supervision stays server-side and does not infer misconduct', async () => {
  const [detail, supervision] = await Promise.all([read('app/reports/[reportId]/page.tsx'), read('app/reports/mcp-supervision.tsx')]);
  for (const label of ['Tổng quan','Nhân viên','Tuyến','Khách đã ghé','Bất thường']) assert.match(supervision, new RegExp(label));
  assert.match(detail, /McpSupervision/);
  assert.match(supervision, /\/api\/reporting\/mcp-supervision/);
  assert.match(supervision, /Cần kiểm tra vị trí/);
  assert.doesNotMatch(`${detail}\n${supervision}`, /gian lận|vi phạm|giả mạo/i);
});

test('Lô 4 alert lifecycle uses shared canonical idempotency generator', async () => {
  const [pkg, detail, action, declaration] = await Promise.all([read('package.json'), read('app/alerts/[alertId]/page.tsx'), read('app/alerts/actions.ts'), read('contracts.d.ts')]);
  assert.match(pkg, /@npp\/contracts/);
  assert.match(detail, /createIdempotencyKey\('admin-alert-status'\)/);
  assert.match(action, /idempotencyKey/);
  assert.match(declaration, /createIdempotencyKey/);
  assert.doesNotMatch(action, /randomUUID|Date\.now|Math\.random/);
});
