import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FACE_MODEL_CODE,
  FACE_EMBEDDING_DIMENSIONS,
  aggregateFaceEmbeddings,
  chooseFaceMatch,
  cosineSimilarity,
  createFaceDeviceCredential,
  parseFaceDeviceCredential,
  faceDeviceCredentialHash,
} from '../src/services/workforce-face.js';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function unit(index) {
  const value = new Array(FACE_EMBEDDING_DIMENSIONS).fill(0);
  value[index] = 1;
  return value;
}

test('face enrollment aggregates multiple 128D samples into one normalized template', () => {
  const template = aggregateFaceEmbeddings([
    unit(0),
    unit(0),
    unit(0),
  ]);
  assert.equal(template.length, 128);
  assert.ok(Math.abs(template[0] - 1) < 1e-6);
  assert.ok(template.slice(1).every((value) => Math.abs(value) < 1e-6));
  assert.equal(aggregateFaceEmbeddings([unit(0), unit(0)]), null);
});

test('face matching rejects weak and ambiguous candidates and accepts a clear 1:N winner', () => {
  const clear = chooseFaceMatch([
    { id: 'a', score: 0.91 },
    { id: 'b', score: 0.70 },
  ], { threshold: 0.72, margin: 0.08 });
  assert.equal(clear.ok, true);
  assert.equal(clear.candidate.id, 'a');

  assert.deepEqual(
    chooseFaceMatch([{ id: 'a', score: 0.69 }], { threshold: 0.72, margin: 0.08 }),
    { ok: false, code: 'FACE_NOT_RECOGNIZED' },
  );
  assert.deepEqual(
    chooseFaceMatch([
      { id: 'a', score: 0.90 },
      { id: 'b', score: 0.86 },
    ], { threshold: 0.72, margin: 0.08 }),
    { ok: false, code: 'FACE_MATCH_AMBIGUOUS' },
  );
  assert.ok((cosineSimilarity(unit(0), unit(0)) ?? 0) > 0.999);
  assert.ok(Math.abs(cosineSimilarity(unit(0), unit(1)) ?? 1) < 1e-6);
});

test('face device credentials are random bearer secrets stored by hash contract', () => {
  const token = createFaceDeviceCredential('123e4567-e89b-42d3-a456-426614174000');
  const parsed = parseFaceDeviceCredential(token);
  assert.equal(parsed.deviceId, '123e4567-e89b-42d3-a456-426614174000');
  assert.match(faceDeviceCredentialHash(token), /^[0-9a-f]{64}$/);
  assert.equal(parseFaceDeviceCredential('invalid'), null);
});

test('migration 157 extends canonical attendance instead of creating a second attendance ledger', () => {
  const migration = source('../../database/migrations/shared/157_workforce_face_attendance.sql');
  assert.match(migration, /attendance_method IN \('QR', 'MANUAL', 'BOTH', 'FACE', 'QR_FACE', 'NONE'\)/);
  assert.match(migration, /source IN \('QR', 'FACE', 'MANUAL', 'ADJUSTMENT', 'SYSTEM'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.employee_face_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_face_devices/);
  assert.match(migration, /encrypted_embedding bytea NOT NULL/);
  assert.doesNotMatch(migration, /\b(raw_image|face_image|photo_blob|image_blob)\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*face_attendance_events/i);
  assert.doesNotMatch(migration, /^(?:BEGIN;|COMMIT;)$/m);

  const index = source('src/migrations/index.js');
  assert.match(index, /157_workforce_face_attendance/);
});

test('FACE attendance reuses the workforce state machine and canonical event types', () => {
  const workforce = source('src/services/workforce.js');
  assert.match(workforce, /recordFaceAttendance/);
  assert.match(workforce, /source: 'FACE'/);
  assert.match(workforce, /attendanceEventChoice\(attendance, payload\)/);
  for (const eventType of ['CHECK_IN', 'TEMP_EXIT', 'RETURN', 'CHECK_OUT']) {
    assert.match(workforce, new RegExp(eventType));
  }
  assert.match(workforce, /\['FACE', 'QR_FACE'\]/);
  assert.match(workforce, /\['QR', 'BOTH', 'QR_FACE'\]/);
});

test('FACE routes keep admin authorization, device authentication and idempotent mutations', () => {
  const route = source('src/routes/workforce-face.js');
  assert.match(route, /coreEmployeeRead/);
  assert.match(route, /coreEmployeeWrite/);
  assert.match(route, /coreAttendancePointManage/);
  assert.match(route, /x-npp-face-device-token/);
  assert.match(route, /Idempotency|idempotency-key/i);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /enroll-face-template/);
  assert.match(route, /provision-face-device/);
  assert.match(route, /source: 'FACE'/);

  const server = source('src/server.js');
  assert.match(server, /handleWorkforceFaceRoutes/);
  assert.match(server, /x-npp-face-device-token/);
});

test('FACE contract pins the embedding model and does not expose raw images', () => {
  assert.equal(FACE_MODEL_CODE, 'FACENET_128_V1');
  assert.equal(FACE_EMBEDDING_DIMENSIONS, 128);
  const service = source('src/services/workforce-face.js');
  assert.match(service, /aes-256-gcm/);
  assert.match(service, /FACE_TEMPLATE_ENCRYPTION_KEY/);
  assert.doesNotMatch(service, /writeFile|createWriteStream|R2|S3/);
});


test('migration 157 production operation requires backup, restore rehearsal and exact-main command', () => {
  const script = source('scripts/vps-production-migrate-workforce-157.sh');
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /rehearsal/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /PRODUCTION_VERIFY=PASS/);

  const workflow = source('../../../.github/workflows/vps-production-migration-157-manual.yml');
  assert.match(workflow, /\/migrate-vps-production-157/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /Fresh backup, restore rehearsal, migrate production and verify/);
});
