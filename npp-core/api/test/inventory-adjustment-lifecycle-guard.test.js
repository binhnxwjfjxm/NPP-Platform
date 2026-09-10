import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryAdjustmentInternals } from '../src/services/inventory-adjustment.js';

const serviceSource = readFileSync(new URL('../src/services/inventory-adjustment.js', import.meta.url), 'utf8');

function functionBody(name, nextName) {
  const start = serviceSource.indexOf(`export async function ${name}`);
  const end = serviceSource.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return serviceSource.slice(start, end);
}

test('duyệt phiếu chỉ kiểm tra quyền và revision, không chặn theo watermark tồn kho', () => {
  const approveBody = functionBody('approveAdjustment', 'postAdjustment');
  assert.doesNotMatch(approveBody, /verifySnapshotWatermarks/);
  assert.doesNotMatch(approveBody, /currentScopeVersions/);
  assert.match(approveBody, /canApproveOwnAdjustment/);
});

test('điều chỉnh thủ công không bị chặn lặp theo watermark khi cập nhật tồn', () => {
  assert.equal(inventoryAdjustmentInternals.shouldVerifySnapshotAtPost('MANUAL_ADJUSTMENT'), false);
  assert.equal(inventoryAdjustmentInternals.shouldVerifySnapshotAtPost('SCRAP'), true);
  assert.equal(inventoryAdjustmentInternals.shouldVerifySnapshotAtPost('QUARANTINE_TRANSFER'), true);
  assert.equal(inventoryAdjustmentInternals.shouldVerifySnapshotAtPost('DAMAGED_TRANSFER'), true);

  const postBody = functionBody('postAdjustment', 'cancelAdjustment');
  assert.match(postBody, /shouldVerifySnapshotAtPost/);
  assert.match(postBody, /loadCurrentScopeState/);
  assert.match(postBody, /verifySnapshotWatermarks/);
});
