import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoreManagementProposal,
  listCoreManagementProposals,
  readCoreManagementProposal,
  resubmitCoreManagementProposal,
} from './core-management-proposals.js';

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
const context = { requestId: 'req_management_proposal', principal: { employeeId } };

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

test('MCP proposal list forwards trusted employee identity and forces MCP source', async () => {
  let seen;
  await listCoreManagementProposals(context, config, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return response(200, { data: { proposals: [] } });
    },
  });
  assert.equal(seen.url, 'https://company.example.test/api/management-proposals?source=mcp');
  assert.equal(seen.init.headers.Authorization, `Bearer ${config.coreSales.apiToken}`);
  assert.equal(seen.init.headers['X-NPP-MCP-Employee-Id'], employeeId);
});

test('MCP proposal create forwards exact idempotency key and cannot spoof source/domain', async () => {
  let seen;
  const key = 'mcp-management-proposal-abc_123';
  await createCoreManagementProposal({ source: 'company', domain: 'commercial', title: 'A' }, context, config, {
    idempotencyKey: key,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return response(201, { data: { id: 'proposal_1' } });
    },
  });
  assert.equal(seen.url, 'https://company.example.test/api/management-proposals');
  assert.equal(seen.init.headers['Idempotency-Key'], key);
  assert.deepEqual(JSON.parse(seen.init.body), { source: 'mcp', domain: 'mcp', title: 'A' });
});

test('MCP proposal bridge fails closed without trusted employee or idempotency context', async () => {
  await assert.rejects(
    () => listCoreManagementProposals({ requestId: 'req_missing' }, config),
    (error) => error.code === 'core_management_proposal_employee_required' && error.statusCode === 400,
  );
  await assert.rejects(
    () => createCoreManagementProposal({}, context, config),
    (error) => error.code === 'management_proposal_idempotency_key_required' && error.statusCode === 400,
  );
  await assert.rejects(
    () => resubmitCoreManagementProposal('proposal_1', {}, context, config),
    (error) => error.code === 'management_proposal_idempotency_key_required' && error.statusCode === 400,
  );
});

test('MCP proposal detail validates identifier and maps upstream auth failure as integration failure', async () => {
  await assert.rejects(
    () => readCoreManagementProposal('../private', context, config),
    (error) => error.code === 'management_proposal_id_invalid' && error.statusCode === 400,
  );
  await assert.rejects(
    () => listCoreManagementProposals(context, config, {
      fetchImpl: async () => response(403, { error: { code: 'FORBIDDEN', message: 'service permission mismatch' } }),
    }),
    (error) => error.code === 'FORBIDDEN' && error.statusCode === 502,
  );
});
