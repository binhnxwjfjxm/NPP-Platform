import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { BUSINESS_EXPORT_DEFINITIONS, BUSINESS_EXPORT_FORBIDDEN_SOURCE_TOKENS } from '../src/business-export/definitions.js';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { createBusinessDataExport } from '../src/services/business-data-export.js';

const EXPECTED_SHEETS = [
  'Khách hàng',
  'Sản phẩm & Giá bán',
  'Tồn kho',
  'Nhật ký kho',
  'Đơn bán hàng',
  'Công nợ khách hàng',
  'Thu điều chỉnh công nợ',
  'Nhà cung cấp',
  'Đơn mua hàng',
  'Nhập hàng',
  'Công nợ nhà cung cấp',
  'Giao hàng',
  'Nhân viên',
  'MCP Tuyến & điểm bán',
  'MCP Đơn hàng',
  'MCP Báo cáo thị trường',
];

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3092',
    INSTALLATION_ID: `business-export-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

const config = loadConfig(testEnv());
const pool = getPool(config);
after(async () => { await closePool(); });

test('Issue #562 Part 2 uses only curated business worksheets and normal permissions', async () => {
  assert.deepEqual(BUSINESS_EXPORT_DEFINITIONS.map((item) => item.sheetName), EXPECTED_SHEETS);
  for (const definition of BUSINESS_EXPORT_DEFINITIONS) {
    assert.ok(definition.permissions.length > 0, `${definition.key} must have read permission`);
    assert.ok(!definition.columns.some(([key, label]) => key === 'id' || /uuid/i.test(key) || /UUID/i.test(label)), `${definition.key} must not expose raw UUID columns`);
    const sql = definition.sql.toLowerCase();
    assert.doesNotMatch(sql, /raw_payload/);
    for (const token of BUSINESS_EXPORT_FORBIDDEN_SOURCE_TOKENS) {
      assert.ok(!sql.includes(token.toLowerCase()), `${definition.key} must not read ${token}`);
    }
  }

  const route = await readFile(new URL('../src/routes/reporting-sales-purchasing.js', import.meta.url), 'utf8');
  assert.match(route, /\/api\/reporting\/business-export/);
  assert.match(route, /coreReportingExport/);
  assert.match(route, /resolveEmployeeMcpScope/);
  assert.doesNotMatch(route, /technical-backup|technicalAccess|unlock/i);

  const service = await readFile(new URL('../src/services/business-data-export.js', import.meta.url), 'utf8');
  assert.match(service, /REPEATABLE READ READ ONLY/);
  assert.match(service, /FETCH FORWARD/);
  assert.match(service, /buildMultiSheetXlsx/);
  assert.match(service, /to_regclass/);
  assert.match(service, /definition\.mcpScoped && !mcpEmployeeCode/);
  assert.doesNotMatch(service, /discoverBackupDatasets|information_schema|pg_catalog/);
});

test('Issue #562 Part 2 compiles available curated queries, skips unavailable MCP domain, and builds readable XLSX', async () => {
  const actor = 'test:business-export';
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const customerId = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const customerCode = `KH_${suffix}`;
  const customerName = `Khách hàng kiểm thử ${suffix}`;

  await pool.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, config.installationId, `CN_${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, config.installationId, branchId, `KHO_${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,0,0,true,$5,$5)`,
    [customerId, config.installationId, customerCode, customerName, actor],
  );

  const artifact = await createBusinessDataExport(pool, {
    requestContext: {
      installationId: config.installationId,
      scopes: { branchIds: [], warehouseIds: [warehouseId], territoryIds: [] },
    },
    warehouseIds: [warehouseId],
    mcpEmployeeCode: `NV_${suffix}`,
    canReadPermission: () => true,
  });

  try {
    assert.equal(artifact.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(artifact.filename, /^So-lieu-doanh-nghiep-.*\.xlsx$/);
    assert.ok(artifact.size > 0);
    assert.equal(artifact.businessSheetCount, 1);
    assert.equal(artifact.sheetCount, 2);
    assert.deepEqual(artifact.sheets.map((sheet) => sheet.name), ['Khách hàng']);

    const workbook = await readFile(artifact.filePath);
    assert.equal(workbook.subarray(0, 2).toString('ascii'), 'PK');
    const visible = workbook.toString('utf8');
    assert.match(visible, /Tổng quan số liệu/);
    assert.match(visible, /Khách hàng/);
    assert.match(visible, new RegExp(customerCode));
    assert.match(visible, new RegExp(customerName));
    assert.ok(!visible.includes(customerId), 'raw customer UUID must not be exported');
  } finally {
    await artifact.cleanup();
  }
});
