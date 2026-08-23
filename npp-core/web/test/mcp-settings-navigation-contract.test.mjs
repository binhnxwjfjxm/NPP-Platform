import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shellPath = new URL('../app/components/app-shell-core.tsx', import.meta.url);
const legacyPagePath = new URL('../app/access/employees/performance/page.tsx', import.meta.url);
const settingsPagePath = new URL('../app/settings/mcp-routes/page.tsx', import.meta.url);

test('MCP supervision is placed under Company settings instead of user access', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const accessItems = shell.match(/const accessItems:[\s\S]*?\n\];/)?.[0] ?? '';
  const settingsItems = shell.match(/const settingsItems:[\s\S]*?\n\];/)?.[0] ?? '';

  assert.doesNotMatch(accessItems, /employees\/performance|Hiệu suất nhân viên thị trường/);
  assert.match(settingsItems, /\/settings\/mcp-routes/);
  assert.match(settingsItems, /MCP và tuyến/);
  assert.match(shell, /Cài đặt Công Ty/);
  assert.match(shell, /Hồ sơ, tài khoản, vai trò và phạm vi truy cập/);
});

test('legacy employee performance deep-link redirects to the MCP route settings area', async () => {
  const [legacyPage, settingsPage] = await Promise.all([
    readFile(legacyPagePath, 'utf8'),
    readFile(settingsPagePath, 'utf8'),
  ]);

  assert.match(legacyPage, /redirect\('\/settings\/mcp-routes'\)/);
  assert.match(settingsPage, /EmployeeMcpReportingWorkspace/);
});
