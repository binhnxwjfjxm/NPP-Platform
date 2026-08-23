import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import { resolveEmployeeMcpScope } from '../src/routes/reporting-employee-mcp.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('8.4 registers dedicated Employee + MCP reporting permission and bootstrap compatibility', () => {
  assert.equal(PERMISSIONS.coreReportingEmployeeMcpRead, 'core.reporting.employee-mcp.read');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingEmployeeMcpRead), true);
  const context = source('../src/request-context.js');
  assert.match(context, /PERMISSIONS\.coreReportingEmployeeMcpRead/);
});

test('8.4 field scope fails closed when branch or territory cannot be mapped canonically', async () => {
  let queryCount = 0;
  const adapter = { query: async () => { queryCount += 1; return { rows: [] }; } };
  const base = { installationId: 'installation', employeeId: null, scopes: { branchIds: [], warehouseIds: [], territoryIds: [] } };

  const branch = await resolveEmployeeMcpScope(adapter, { ...base, scopes: { ...base.scopes, branchIds: ['branch'] } });
  assert.equal(branch.ok, false);
  assert.equal(branch.code, 'EMPLOYEE_MCP_BRANCH_SCOPE_UNAVAILABLE');

  const territory = await resolveEmployeeMcpScope(adapter, { ...base, scopes: { ...base.scopes, territoryIds: ['territory'] } });
  assert.equal(territory.ok, false);
  assert.equal(territory.code, 'EMPLOYEE_MCP_TERRITORY_SCOPE_UNAVAILABLE');
  assert.equal(queryCount, 0);
});

test('8.4 employee scope resolves only a canonical employee code', async () => {
  const employeeId = '0e7c2d35-4c53-4eef-9b74-5b697df9b608';
  const calls = [];
  const adapter = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: employeeId, code: 'NV_MCP_01' }] };
    },
  };
  const scope = await resolveEmployeeMcpScope(adapter, {
    installationId: 'installation',
    employeeId,
    scopes: { branchIds: [], warehouseIds: [], territoryIds: [] },
  });
  assert.deepEqual(scope, { ok: true, employeeCode: 'NV_MCP_01', employeeId, basis: 'EMPLOYEE_CODE' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM shared\.employees/);
  assert.match(calls[0].sql, /installation_id = \$1/);
  assert.match(calls[0].sql, /id = \$2::uuid/);
});

test('8.4 report derives field performance from MCP child facts and exact conversion lineage', () => {
  const report = source('../src/routes/reporting-employee-mcp.js');
  assert.match(report, /mcp\.mcp_route_sessions/);
  assert.match(report, /mcp\.mcp_session_customers/);
  assert.match(report, /mcp\.mcp_visits/);
  assert.match(report, /mcp\.orders/);
  assert.match(report, /customer_onboarding_submitted_at/);
  assert.match(report, /customer_onboarding_status IN \('approved', 'linked_existing'\)/);
  assert.match(report, /core_sales_order_id IS NOT NULL/);
  assert.match(report, /employee\.code = NULLIF\(btrim\(session\.sales\), ''\)/);
  assert.match(report, /UNMAPPED_EMPLOYEE_CODE/);
  assert.match(report, /SESSION_COUNTER_MISMATCH/);
  assert.match(report, /a field outlet is not a Core customer/);
  assert.doesNotMatch(report, /employee\.full_name\s*=|lower\(employee\.full_name\)/i);
  assert.doesNotMatch(report, /session\.area\s*=\s*ANY|session\.area\s*=\s*\$\d+/i);
  assert.doesNotMatch(report, /parseFloat\(|parseInt\(|Number\(/);
});

test('8.4 employee and MCP supervision routes share fail-closed permission and canonical field scope', () => {
  const route = source('../src/routes/reporting-sales-purchasing.js');
  assert.match(route, /\/api\/reporting\/employee-mcp/);
  assert.match(route, /\/api\/reporting\/mcp-supervision/);
  assert.match(route, /coreReportingEmployeeMcpRead/);
  assert.match(route, /warehouseScoped = family !== 'employee-mcp'/);
  assert.match(route, /family !== 'mcp-supervision'/);
  assert.match(route, /isMcpFamily\(family\)/);
  assert.match(route, /EMPLOYEE_MCP_SCOPE_DENIED/);
  assert.match(route, /EMPLOYEE_MCP_WAREHOUSE_FILTER_UNSUPPORTED/);
  assert.match(route, /requiresCanonicalEmployeeMcpScope/);
  assert.match(route, /resolveReportingMcpScope/);
  assert.match(route, /family === 'mcp-supervision'/);
  const handler = route.slice(route.indexOf('export async function handleReportingRoutes'));
  assert.ok(handler.indexOf('authenticateAndAuthorize') >= 0);
  assert.ok(handler.indexOf('EMPLOYEE_MCP_SCOPE_DENIED') >= 0);
  assert.ok(handler.indexOf('EMPLOYEE_MCP_WAREHOUSE_FILTER_UNSUPPORTED') >= 0);
  assert.ok(handler.indexOf('authenticateAndAuthorize') < handler.indexOf('EMPLOYEE_MCP_SCOPE_DENIED'));
  assert.ok(handler.indexOf('authenticateAndAuthorize') < handler.indexOf('EMPLOYEE_MCP_WAREHOUSE_FILTER_UNSUPPORTED'));
});

test('8.4 permission migration 067 is metadata-only and follows 066', () => {
  const migration = source('../../../database/migrations/shared/067_reporting_employee_mcp_permission_catalog.sql');
  const manifest = source('../src/migrations/index.js');
  assert.match(migration, /core\.reporting\.employee-mcp\.read/);
  assert.match(migration, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.doesNotMatch(migration, /role_permissions|INSERT INTO shared\.role/i);
  assert.doesNotMatch(migration, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  assert.ok(manifest.indexOf('066_reporting_aging_gross_margin_permission_catalog') < manifest.indexOf('067_reporting_employee_mcp_permission_catalog'));
});
