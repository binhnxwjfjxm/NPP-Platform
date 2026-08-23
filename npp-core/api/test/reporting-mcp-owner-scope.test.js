import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasInstallationWideMcpAccess,
  requiresCanonicalEmployeeMcpScope,
  resolveReportingMcpScope,
} from '../src/routes/reporting-mcp-scope-policy.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const ownerRoles = [
  'system:security-owner',
  'system:implementation-owner',
  'bootstrap',
];

test('Owner MCP reporting scope is installation-wide without employee binding', async () => {
  for (const role of ownerRoles) {
    const context = {
      installationId: 'installation',
      roles: [role],
      employeeId: null,
      scopes: {
        branchIds: ['0e7c2d35-4c53-4eef-9b74-5b697df9b608'],
        warehouseIds: ['1e7c2d35-4c53-4eef-9b74-5b697df9b608'],
        territoryIds: ['2e7c2d35-4c53-4eef-9b74-5b697df9b608'],
      },
    };
    let queryCount = 0;
    const adapter = { query: async () => { queryCount += 1; return { rows: [] }; } };

    assert.equal(hasInstallationWideMcpAccess(context), true);
    assert.equal(requiresCanonicalEmployeeMcpScope(context), false);
    assert.deepEqual(await resolveReportingMcpScope(adapter, context), {
      ok: true,
      employeeCode: null,
      employeeId: null,
      basis: 'INSTALLATION',
    });
    assert.equal(queryCount, 0);
  }
});

test('ordinary accounts without employee binding remain fail-closed', () => {
  const context = { roles: ['manager'], employeeId: null };
  assert.equal(hasInstallationWideMcpAccess(context), false);
  assert.equal(requiresCanonicalEmployeeMcpScope(context), true);
});

test('MCP report routes and Control Tower use the shared Owner scope policy', () => {
  const reportingRoutes = source('../src/routes/reporting-sales-purchasing.js');
  const operations = source('../src/routes/reporting-operations.js');

  assert.match(reportingRoutes, /requiresCanonicalEmployeeMcpScope\(requestContext\)/);
  assert.match(reportingRoutes, /resolveReportingMcpScope\(options\.getPool\(\), requestContext\)/);
  assert.doesNotMatch(reportingRoutes, /!requestContext\.roles\?\.includes\('bootstrap'\)/);

  assert.match(operations, /requiresCanonicalEmployeeMcpScope\(requestContext\)/);
  assert.match(operations, /resolveReportingMcpScope\(adapter, requestContext\)/);
  assert.doesNotMatch(operations, /requestContext\.roles\?\.includes\('bootstrap'\) === true/);
});
