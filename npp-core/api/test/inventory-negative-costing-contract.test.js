import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = readFileSync(
  new URL('../../../docs/operations/issue-791-negative-stock-costing-contract.md', import.meta.url),
  'utf8',
);

test('issue 791 negative stock costing contract keeps the feature closed at the policy gate', () => {
  assert.match(contract, /chưa mở quyền xuất âm/i);
  assert.match(contract, /SERVER_POLICY/);
  assert.match(contract, /COST_NEGATIVE_STOCK_PENDING/);
  assert.match(contract, /không.*mở DB guard/i);
});
