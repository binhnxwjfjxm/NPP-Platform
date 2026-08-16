import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSystemSalesChannel } from '../src/db/repositories/system-sales-channel.js';

function fakeClient(steps) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = steps.shift();
      assert.ok(next, `Unexpected query: ${sql}`);
      if (next.match) assert.match(sql, next.match);
      return next.result;
    },
  };
}

const args = {
  installationId: 'installation-test',
  code: 'MCP',
  name: 'MCP',
  description: 'Kênh hệ thống nhận đơn từ ứng dụng MCP.',
  actorId: 'service:mcp-test',
};

test('system MCP sales channel is created once when the installation has none', async () => {
  const client = fakeClient([
    { match: /FROM shared\.sales_channels/, result: { rows: [] } },
    {
      match: /INSERT INTO shared\.sales_channels/,
      result: { rows: [{ id: 'channel-mcp', code: 'MCP', name: 'MCP', is_active: true }] },
    },
  ]);

  const channel = await ensureSystemSalesChannel(client, args);

  assert.equal(channel.id, 'channel-mcp');
  assert.equal(channel.is_active, true);
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[1].sql, /ON CONFLICT \(installation_id, code\) DO NOTHING/);
  assert.equal(client.calls[1].params[1], args.installationId);
  assert.equal(client.calls[1].params[2], 'MCP');
  assert.equal(client.calls[1].params[5], args.actorId);
});

test('system MCP sales channel respects an explicit inactive state', async () => {
  const client = fakeClient([
    {
      match: /FROM shared\.sales_channels/,
      result: { rows: [{ id: 'channel-mcp', code: 'MCP', name: 'MCP', is_active: false }] },
    },
  ]);

  const channel = await ensureSystemSalesChannel(client, args);

  assert.equal(channel.id, 'channel-mcp');
  assert.equal(channel.is_active, false);
  assert.equal(client.calls.length, 1, 'inactive channels must not be recreated or reactivated');
});

test('system MCP sales channel resolves the winner of a first-request race', async () => {
  const client = fakeClient([
    { match: /FROM shared\.sales_channels/, result: { rows: [] } },
    { match: /INSERT INTO shared\.sales_channels/, result: { rows: [] } },
    {
      match: /FROM shared\.sales_channels/,
      result: { rows: [{ id: 'channel-race-winner', code: 'MCP', name: 'MCP', is_active: true }] },
    },
  ]);

  const channel = await ensureSystemSalesChannel(client, args);

  assert.equal(channel.id, 'channel-race-winner');
  assert.equal(channel.is_active, true);
  assert.equal(client.calls.length, 3);
});
