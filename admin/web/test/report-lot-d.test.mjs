import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const alertDataPath = new URL('../app/alerts/alert-data.ts', import.meta.url);
const alertsPagePath = new URL('../app/alerts/page.tsx', import.meta.url);
const alertDetailPath = new URL('../app/alerts/[alertId]/page.tsx', import.meta.url);
const reportsPagePath = new URL('../app/reports/page.tsx', import.meta.url);
const exportRoutePath = new URL('../app/reports/export/route.ts', import.meta.url);
const downloadPath = new URL('../lib/core-download.ts', import.meta.url);

test('Admin Lô D renders real multi-domain alerts instead of fixed placeholders', async () => {
  const [data, page, detail] = await Promise.all([
    readFile(alertDataPath, 'utf8'),
    readFile(alertsPagePath, 'utf8'),
    readFile(alertDetailPath, 'utf8'),
  ]);
  for (const domain of ['sales', 'debt', 'inventory', 'delivery', 'mcp']) assert.match(data, new RegExp(`'${domain}'`));
  assert.match(data, /domainAccess/);
  assert.match(page, /activeAlerts\.filter\(\(item\) => item\.domain === selectedDomain\)/);
  assert.doesNotMatch(page, /unavailableTabs/);
  assert.match(page, /rule\.domainLabel/);
  assert.match(detail, /alert\.domainLabel/);
  assert.match(detail, /alert\.context/);
});

test('Admin Lô D exposes official Excel export through the server-side Công Ty gateway', async () => {
  const [page, route, download] = await Promise.all([
    readFile(reportsPagePath, 'utf8'),
    readFile(exportRoutePath, 'utf8'),
    readFile(downloadPath, 'utf8'),
  ]);
  assert.match(page, /Xuất báo cáo Excel/);
  assert.match(page, /resolveReportRange/);
  assert.match(page, /warehouseId/);
  assert.match(route, /management-export/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /requestCoreReportDownload/);
  assert.match(download, /Authorization: `Bearer \$\{token\}`/);
  assert.match(download, /CORE_API_INTERNAL_URL/);
  assert.doesNotMatch(page, /Blob\(|createObjectURL|text\/csv|\.csv/);
});
