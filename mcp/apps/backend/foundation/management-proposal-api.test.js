import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleManagementProposalApi } from './management-proposal-api.js';

const employeeId = '77777777-7777-4777-8777-777777777777';
const config = {
  coreSales: {
    configured: true,
    baseUrl: 'https://company.example.test',
    apiToken: 'company-service-token-0123456789',
    defaultWarehouseId: '11111111-1111-4111-8111-111111111111',
    timeoutMs: 5000,
  },
};

function context(overrides = {}) {
  return {
    requestId: 'req_management_api',
    idempotencyKey: 'mcp-management-proposal-abc_123',
    auth: { authenticated: true },
    principal: {
      id: `user:${employeeId}`,
      employeeId,
      permissions: ['mcp.report.write'],
      scopes: [],
      ...overrides,
    },
  };
}

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  return req;
}

function upstream(status, data, seen) {
  return async (url, init) => {
    seen.push({ url, init });
    return { ok: status >= 200 && status < 300, status, async json() { return data; } };
  };
}

test('MCP proposal API denies callers without report permission', async () => {
  await assert.rejects(
    () => handleManagementProposalApi(request('GET'), new URL('https://mcp.test/api/management-proposals'), context({ permissions: [] }), config),
    (error) => error.code === 'permission_denied' && error.statusCode === 403,
  );
});

test('MCP proposal API forwards one canonical idempotency key for create', async () => {
  const seen = [];
  const result = await handleManagementProposalApi(
    request('POST', { title: 'Đề xuất A', content: 'Nội dung' }),
    new URL('https://mcp.test/api/management-proposals'),
    context(),
    config,
    { fetchImpl: upstream(201, { data: { id: 'proposal_1' } }, seen) },
  );
  assert.equal(result.statusCode, 201);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.headers['Idempotency-Key'], 'mcp-management-proposal-abc_123');
  assert.equal(seen[0].init.headers['X-NPP-MCP-Employee-Id'], employeeId);
});
