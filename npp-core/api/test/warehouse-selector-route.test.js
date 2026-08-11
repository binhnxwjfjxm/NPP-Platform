import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScopedWarehouseOptions } from '../src/routes/warehouse-selectors.js';

test('warehouse selector uses canonical master rows then filters by request warehouse scope', () => {
  const rows = [
    { id: 'w-2', code: 'WH-B', name: 'Kho B' },
    { id: 'w-1', code: 'WH-A', name: 'Kho A' },
    { id: 'w-3', code: 'WH-C', name: 'Kho C' },
  ];
  const result = selectScopedWarehouseOptions(rows, ['w-2', 'w-1']);
  assert.deepEqual(result, [
    { id: 'w-1', code: 'WH-A', name: 'Kho A' },
    { id: 'w-2', code: 'WH-B', name: 'Kho B' },
  ]);
});

test('warehouse selector does not infer warehouse existence from operational activity', () => {
  const result = selectScopedWarehouseOptions(
    [{ id: 'w-new', code: 'WH-NEW', name: 'Kho mới' }],
    ['w-new'],
  );
  assert.deepEqual(result, [{ id: 'w-new', code: 'WH-NEW', name: 'Kho mới' }]);
});
