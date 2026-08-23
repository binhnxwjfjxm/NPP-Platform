import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routePath = new URL('../src/routes/reporting-admin-lot-d.js', import.meta.url);
const exportPath = new URL('../src/services/reporting-management-export.js', import.meta.url);
const serverPath = new URL('../src/server.js', import.meta.url);

test('Lô D opens only canonical business alert sources and keeps stable business identities', async () => {
  const source = await readFile(routePath, 'utf8');
  for (const rule of [
    'SALES_GROSS_MARGIN_LINEAGE_MISSING',
    'SALES_GROSS_MARGIN_COST_MISSING',
    'SALES_GROSS_MARGIN_COST_ANOMALY',
    'DEBT_PAYABLE_OVERDUE',
    'INVENTORY_COST_RECONCILIATION_EXCEPTION',
    'DELIVERY_ATTEMPT_FAILED',
    'DELIVERY_COD_COLLECTION_OVERDUE',
    'DELIVERY_COD_HANDOVER_DISCREPANCY',
  ]) assert.match(source, new RegExp(rule));
  for (const canonicalReport of ['grossMarginReport', 'agingReport', 'inventoryReport', 'logisticsReport', 'codReport', 'mcpAlertsReport']) {
    assert.match(source, new RegExp(canonicalReport));
  }
  assert.match(source, /inventoryAlerts[\s\S]*warehouseId[\s\S]*variantId/);
  assert.doesNotMatch(source, /INVENTORY_COST_RECONCILIATION_EXCEPTION'[\s\S]{0,250}quantityDifference\|/);
});

test('Lô D export requires export permission plus each report read contract on the backend', async () => {
  const [route, service] = await Promise.all([readFile(routePath, 'utf8'), readFile(exportPath, 'utf8')]);
  assert.match(route, /coreReportingExport/);
  for (const permission of [
    'coreReportingControlTowerRead',
    'coreReportingSalesRead',
    'coreReportingGrossMarginRead',
    'coreReportingAgingRead',
    'coreReportingInventoryRead',
    'coreReportingLogisticsRead',
    'coreReportingCodRead',
    'coreReportingEmployeeMcpRead',
  ]) assert.match(route, new RegExp(permission));
  assert.match(route, /validateScope/);
  assert.match(route, /resolveReportingMcpScope/);
  assert.match(service, /buildMultiSheetXlsx/);
  assert.match(service, /Phạm vi quyền/);
  assert.match(service, /Đối chiếu/);
  assert.doesNotMatch(service, /client[-_ ]only|CSV browser/i);
});

test('Lô D route is wired ahead of the legacy reporting route', async () => {
  const server = await readFile(serverPath, 'utf8');
  const lotD = server.indexOf('handleAdminLotDRoutes(req, res, routeContext)');
  const reporting = server.indexOf('handleReportingRoutes(req, res, routeContext)');
  assert.ok(lotD > 0 && reporting > lotD);
  assert.match(server, /reporting-admin-lot-d\.js/);
});
