import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const alertsPath = new URL('../src/routes/reporting-mcp-alerts.js', import.meta.url);

test('Admin alert history resolves workforce actor label server-side without changing lifecycle mutation', async () => {
  const source = await readFile(alertsPath, 'utf8');
  assert.match(source, /LEFT JOIN shared\.employees employee/);
  assert.match(source, /employee\.full_name AS actor_name/);
  assert.match(source, /actorLabel:/);
  assert.match(source, /withAuditOutboxTransaction/);
  assert.match(source, /insertAuditRecord/);
  assert.match(source, /insertOutboxEvent/);
});
