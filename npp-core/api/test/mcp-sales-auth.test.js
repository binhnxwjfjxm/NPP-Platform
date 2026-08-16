import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import {
  authenticateRequest,
  createMcpSalesPrincipal,
  PERMISSIONS,
  requirePermission,
} from '../src/request-context.js';

const WAREHOUSE_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3004',
    INSTALLATION_ID: 'installation-a',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'bootstrap-token-0123456789',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    MCP_ONBOARDING_API_TOKEN: 'mcp-onboarding-token-0123456789',
    MCP_ONBOARDING_ACTOR_ID: 'service:mcp-customer-onboarding',
    MCP_SALES_API_TOKEN: 'mcp-sales-token-0123456789012345',
    MCP_SALES_ACTOR_ID: 'service:mcp-sales-order',
    MCP_SALES_WAREHOUSE_IDS: WAREHOUSE_ID,
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

test('dedicated MCP Sales token can read canonical products and BASE prices and create/read draft orders only', () => {
  const appConfig = config();
  const principal = createMcpSalesPrincipal(appConfig, EMPLOYEE_ID);
  assert.equal(principal.actorId, 'service:mcp-sales-order');
  assert.equal(principal.employeeId, EMPLOYEE_ID);
  assert.deepEqual(principal.scopes.warehouseIds, [WAREHOUSE_ID]);
  assert.deepEqual([...principal.permissions].sort(), [
    PERMISSIONS.coreProductRead,
    PERMISSIONS.corePriceRead,
    PERMISSIONS.coreSalesOrderRead,
    PERMISSIONS.coreSalesOrderCreate,
  ].sort());
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreProductRead).ok, true);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreProductWrite).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.corePriceRead).ok, true);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.corePriceWrite).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreSalesOrderRead).ok, true);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreSalesOrderCreate).ok, true);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreSalesOrderConfirm).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreSalesOrderAmend).ok, false);
  assert.equal(requirePermission({ permissions: principal.permissions }, PERMISSIONS.coreSalesOrderCancel).ok, false);
});

test('MCP Sales token authenticates separately with trusted employee context and incomplete/reused config fails closed', () => {
  const appConfig = config();
  const result = authenticateRequest({
    headers: {
      authorization: `Bearer ${appConfig.mcpSalesApiToken}`,
      'x-npp-mcp-employee-id': EMPLOYEE_ID,
    },
  }, appConfig);
  assert.equal(result.ok, true);
  assert.equal(result.principal.sourceApp, 'mcp-plan-backend');
  assert.equal(result.principal.employeeId, EMPLOYEE_ID);
  assert.equal(result.principal.roles.includes('mcp-sales-order-service'), true);
  assert.equal(result.principal.permissions.includes(PERMISSIONS.coreCustomerWrite), false);

  assert.deepEqual(
    authenticateRequest({ headers: { authorization: `Bearer ${appConfig.mcpSalesApiToken}` } }, appConfig),
    { ok: false, code: 'UNAUTHORIZED', statusCode: 401 },
  );
  assert.deepEqual(
    authenticateRequest({
      headers: {
        authorization: `Bearer ${appConfig.mcpSalesApiToken}`,
        'x-npp-mcp-employee-id': 'route-customer-1',
      },
    }, appConfig),
    { ok: false, code: 'UNAUTHORIZED', statusCode: 401 },
  );

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3004', INSTALLATION_ID: 'installation-a',
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform', DATABASE_SSL_MODE: 'disable',
      BACKEND_API_TOKEN: 'bootstrap-token-0123456789', CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
      MCP_SALES_API_TOKEN: 'mcp-sales-token-0123456789012345', CORS_ORIGINS: 'http://127.0.0.1:3003',
    }),
    (error) => error.code === 'incomplete_mcp_sales_config'
  );

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3004', INSTALLATION_ID: 'installation-a',
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform', DATABASE_SSL_MODE: 'disable',
      BACKEND_API_TOKEN: 'same-sales-token-0123456789', CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
      MCP_SALES_API_TOKEN: 'same-sales-token-0123456789', MCP_SALES_WAREHOUSE_IDS: WAREHOUSE_ID,
      CORS_ORIGINS: 'http://127.0.0.1:3003',
    }),
    (error) => error.code === 'mcp_sales_token_reuse_forbidden'
  );
});