import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataPath = new URL('../app/reports/report-lot-c-data.ts', import.meta.url);
const drilldownPath = new URL('../app/reports/report-lot-c-drilldown.ts', import.meta.url);
const reportsPagePath = new URL('../app/reports/page.tsx', import.meta.url);
const detailPath = new URL('../app/reports/[reportId]/page.tsx', import.meta.url);
const alertDataPath = new URL('../app/alerts/alert-data.ts', import.meta.url);
const alertDetailPath = new URL('../app/alerts/[alertId]/page.tsx', import.meta.url);
const proposalDetailPath = new URL('../app/approvals/[approvalId]/page.tsx', import.meta.url);

test('Admin Lô C opens existing reporting detail for inventory, gross margin, COD and decisions', async () => {
  const drilldown = await readFile(drilldownPath, 'utf8');
  for (const endpoint of [
    '/api/reporting/inventory',
    '/api/reporting/gross-margin',
    '/api/reporting/cod',
    '/api/management-proposals',
    '/api/reporting/admin-alerts',
  ]) assert.match(drilldown, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(drilldown, /Kho → SKU → tồn \/ lô-HSD \/ hàng chậm \/ ngoại lệ/);
  assert.match(drilldown, /Khách hàng \/ SKU → chứng từ và dòng lãi gộp/);
  assert.match(drilldown, /Giao vận → khoản thu → COD giữ → bàn giao \/ ngoại lệ/);
  assert.match(drilldown, /Đề xuất & cảnh báo → từng việc/);
  assert.match(drilldown, /href:/);
});

test('Admin Lô C warehouse filter uses canonical warehouseId only where supported', async () => {
  const [data, page, detail] = await Promise.all([
    readFile(dataPath, 'utf8'),
    readFile(reportsPagePath, 'utf8'),
    readFile(detailPath, 'utf8'),
  ]);
  assert.match(data, /warehouseId/);
  assert.match(data, /reporting\/inventory/);
  assert.match(data, /reporting\/cod/);
  assert.match(page, /warehouseFilterDomains/);
  assert.match(page, /Tất cả kho/);
  assert.match(detail, /warehouseId/);
  assert.doesNotMatch(page, /branchId|employeeId|customerId|channelId/);
});

test('Admin Lô C debt is visibly current balance and no longer offers a historical period selector', async () => {
  const [data, page] = await Promise.all([readFile(dataPath, 'utf8'), readFile(reportsPagePath, 'utf8')]);
  assert.match(data, /Phạm vi thời gian', value: 'Số dư hiện tại'/);
  assert.match(page, /selected === 'debt'/);
  assert.match(page, />Số dư hiện tại</);
});

test('Admin Lô C alert history shows resolved actor and report deep-links preserve return flow', async () => {
  const [alertData, alertDetail, proposalDetail] = await Promise.all([
    readFile(alertDataPath, 'utf8'),
    readFile(alertDetailPath, 'utf8'),
    readFile(proposalDetailPath, 'utf8'),
  ]);
  assert.match(alertData, /actorLabel/);
  assert.match(alertDetail, /Người thao tác: \{event\.actorLabel\}/);
  assert.match(alertDetail, /safeReturnTo\.startsWith\('\/reports\/'\)/);
  assert.match(proposalDetail, /safeReturnTo\.startsWith\('\/reports\/'\)/);
});
