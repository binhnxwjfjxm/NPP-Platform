import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shellPath = new URL('../app/components/app-shell-core.tsx', import.meta.url);
const legacyPagePath = new URL('../app/access/employees/performance/page.tsx', import.meta.url);
const settingsPagePath = new URL('../app/settings/mcp-routes/page.tsx', import.meta.url);
const workspacePath = new URL('../app/settings/mcp-routes/mcp-route-settings-workspace.tsx', import.meta.url);
const gatewayPath = new URL('../lib/mcp-route-settings-gateway.ts', import.meta.url);

test('MCP route setup stays under Company settings instead of user access', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const accessItems = shell.match(/const accessItems:[\s\S]*?\n\];/)?.[0] ?? '';
  const settingsItems = shell.match(/const settingsItems:[\s\S]*?\n\];/)?.[0] ?? '';

  assert.doesNotMatch(accessItems, /employees\/performance|Hiệu suất nhân viên thị trường/);
  assert.match(settingsItems, /\/settings\/mcp-routes/);
  assert.match(settingsItems, /MCP và tuyến/);
  assert.match(settingsItems, /\/settings\/customer-ordering-content/);
  assert.match(shell, /Cài đặt Công Ty/);
});

test('route settings contains setup only while legacy performance keeps reporting', async () => {
  const [legacyPage, settingsPage] = await Promise.all([
    readFile(legacyPagePath, 'utf8'),
    readFile(settingsPagePath, 'utf8'),
  ]);

  assert.match(settingsPage, /McpRouteSettingsWorkspace/);
  assert.doesNotMatch(settingsPage, /EmployeeMcpReportingWorkspace/);
  assert.match(legacyPage, /EmployeeMcpReportingWorkspace/);
  assert.doesNotMatch(legacyPage, /redirect\('\/settings\/mcp-routes'\)/);
});

test('Company route settings use workforce authority and canonical idempotency', async () => {
  const [workspace, gateway] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(gatewayPath, 'utf8'),
  ]);

  assert.match(gateway, /from '@npp\/contracts'/);
  assert.match(gateway, /requestNppInternalAuth<CoreMe>\('\/api\/internal-auth\/me'/);
  assert.match(gateway, /MCP_API_INTERNAL_URL/);
  assert.match(gateway, /MCP_API_SERVER_TOKEN/);
  assert.match(gateway, /normalizeIdempotencyKey/);
  assert.match(gateway, /isValidIdempotencyKey/);
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_.*TOKEN|DATABASE_URL|SUPABASE/);

  assert.match(workspace, /createIdempotencyKey\(operation\)/);
  assert.match(workspace, /const key = mutationKey \|\| createIdempotencyKey\(operation\)/);
  assert.match(workspace, /archiveKeys\[route\.id\] \|\| createIdempotencyKey\('company-mcp-route-archive'\)/);
});
