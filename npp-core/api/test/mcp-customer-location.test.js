import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mcpCustomerLocationInternals } from '../src/routes/mcp-customer-location.js';

const routeSource = readFileSync(new URL('../src/routes/mcp-customer-location.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/customer-location-sync.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('MCP customer location route is narrow, service-owned and idempotent', () => {
  assert.equal(mcpCustomerLocationInternals.PATH, '/api/internal/mcp/customer-address-location');
  assert.equal(mcpCustomerLocationInternals.MCP_SALES_ROLE, 'mcp-sales-order-service');
  assert.equal(mcpCustomerLocationInternals.mcpSalesPrincipal({
    sourceApp: 'mcp-plan-backend',
    roles: ['mcp-sales-order-service'],
  }), true);
  assert.equal(mcpCustomerLocationInternals.mcpSalesPrincipal({
    sourceApp: 'core-web',
    roles: ['mcp-sales-order-service'],
  }), false);
  assert.match(routeSource, /executeRequestWithIdempotency/);
  assert.match(routeSource, /withAuditOutboxTransaction/);
  assert.match(routeSource, /customer\.address\.location\.update_from_mcp/);
  assert.match(routeSource, /shared\.customer_address\.location_updated/);
  assert.match(serverSource, /handleMcpCustomerLocationRoutes[\s\S]*handleCustomerRoutes/);
});

test('MCP customer location service reuses canonical customer address validation and only writes the existing address record', () => {
  assert.match(serviceSource, /validateCustomerAddressInput/);
  assert.match(serviceSource, /getCustomerAddressForUpdate/);
  assert.match(serviceSource, /getCustomerByIdForInstallation/);
  assert.match(serviceSource, /updateCustomerAddress/);
  assert.match(serviceSource, /locationUrl/);
  assert.doesNotMatch(serviceSource, /INSERT INTO/);
  assert.doesNotMatch(serviceSource, /ALTER TABLE|CREATE TABLE/);
});
