import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import { logisticsProofOfDeliveryInternals } from '../src/services/logistics-proof-of-delivery.js';

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/052_logistics_optional_proof_of_delivery.sql', import.meta.url),
  'utf8',
);
const decisionSource = readFileSync(
  new URL('../../../docs/operations/phase-6e6-optional-pod-decisions.md', import.meta.url),
  'utf8',
);
const attemptServiceSource = readFileSync(
  new URL('../src/services/logistics-driver-delivery.js', import.meta.url),
  'utf8',
);
const deliveryUiSource = readFileSync(
  new URL('../../../delivery/web/app/trips/[tripId]/proof-of-delivery-panel.tsx', import.meta.url),
  'utf8',
);
const nppUiSource = readFileSync(
  new URL('../../../npp-core/web/app/logistics/delivery-attempts/delivery-attempt-workspace.tsx', import.meta.url),
  'utf8',
);

test('migration 052 registers immutable optional POD without changing attempt completion', () => {
  const migrations = CORE_API_MIGRATIONS.filter(
    (entry) => entry.id === '052_logistics_optional_proof_of_delivery',
  );
  assert.equal(migrations.length, 1);
  assert.match(migrations[0].sql, /CREATE TABLE IF NOT EXISTS logistics\.delivery_attempt_proofs/);
  assert.match(migrationSource, /delivery_attempt_proofs_are_immutable/);
  assert.match(migrationSource, /proof_of_delivery_service/);
  assert.match(migrationSource, /'POD_ATTACHED'/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE logistics\.delivery_attempts\s+ADD COLUMN.*pod/is);
  assert.doesNotMatch(attemptServiceSource, /POD_REQUIRED|proof.*required/i);
});

test('POD permissions are canonical and deny-by-default registry knows them', () => {
  assert.equal(PERMISSIONS.corePodRead, 'core.pod.read');
  assert.equal(PERMISSIONS.corePodAttach, 'core.pod.attach');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.corePodRead), true);
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.corePodAttach), true);
});

test('manual POD works without a file and photo validates trusted metadata', () => {
  const now = new Date('2026-08-05T02:00:00.000Z');
  const manual = logisticsProofOfDeliveryInternals.normalizeProofPayload({
    podType: 'manual_confirm',
    capturedAt: now.toISOString(),
    receiverName: 'Chị Lan',
    note: 'Đã giao tại kho khách.',
  }, { maxObjectBytes: 5_242_880, now });
  assert.equal(manual.ok, true);
  assert.equal(manual.normalized.file, null);

  const photoBytes = Buffer.from('optional-pod-photo');
  const photo = logisticsProofOfDeliveryInternals.normalizeProofPayload({
    podType: 'photo',
    capturedAt: now.toISOString(),
    fileName: 'giao-hang.jpg',
    contentType: 'image/jpeg',
    contentBase64: photoBytes.toString('base64'),
  }, { maxObjectBytes: 5_242_880, now });
  assert.equal(photo.ok, true);
  assert.equal(photo.normalized.file.byteSize, photoBytes.length);
  assert.match(photo.normalized.file.checksumSha256, /^[0-9a-f]{64}$/);

  const invalidType = logisticsProofOfDeliveryInternals.normalizeProofPayload({
    podType: 'photo',
    capturedAt: now.toISOString(),
    fileName: 'proof.svg',
    contentType: 'image/svg+xml',
    contentBase64: Buffer.from('<svg/>').toString('base64'),
  }, { maxObjectBytes: 5_242_880, now });
  assert.equal(invalidType.ok, false);
  assert.equal(invalidType.code, 'INVALID_POD_PHOTO');
});

test('signature, OTP and manual confirmation require only their own reference shape', () => {
  const now = new Date('2026-08-05T02:00:00.000Z');
  const signature = logisticsProofOfDeliveryInternals.normalizeProofPayload({
    podType: 'signature',
    capturedAt: now.toISOString(),
    receiverName: 'Anh Minh',
  }, { maxObjectBytes: 5_242_880, now });
  assert.equal(signature.ok, true);

  const otpMissing = logisticsProofOfDeliveryInternals.normalizeProofPayload({
    podType: 'otp',
    capturedAt: now.toISOString(),
  }, { maxObjectBytes: 5_242_880, now });
  assert.equal(otpMissing.ok, false);
  assert.equal(otpMissing.code, 'POD_OTP_REFERENCE_REQUIRED');

  const manualMissing = logisticsProofOfDeliveryInternals.normalizeProofPayload({
    podType: 'manual_confirm',
    capturedAt: now.toISOString(),
  }, { maxObjectBytes: 5_242_880, now });
  assert.equal(manualMissing.ok, false);
  assert.equal(manualMissing.code, 'POD_MANUAL_CONFIRMATION_REQUIRED');
});

test('product copy keeps POD explicitly optional in Delivery and NPP Operations', () => {
  assert.match(decisionSource, /POD là \*\*tùy chọn\*\*/);
  assert.match(decisionSource, /Không có ảnh, chữ ký hoặc OTP vẫn ghi được kết quả giao/);
  assert.match(deliveryUiSource, /Bằng chứng giao hàng \(không bắt buộc\)/);
  assert.match(deliveryUiSource, /Có thể bỏ qua/);
  assert.match(nppUiSource, /Không có bằng chứng đính kèm; kết quả giao vẫn hợp lệ/);
});
