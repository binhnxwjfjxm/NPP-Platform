import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import * as faceRepo from '../db/repositories/workforce-face.js';

export const FACE_MODEL_CODE = 'FACENET_128_V1';
export const FACE_EMBEDDING_DIMENSIONS = 128;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TOKEN_PATTERN = /^nppface\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,128})$/i;
const DEVICE_NAME_MAX_LENGTH = 128;
const ENROLLMENT_MIN_SAMPLES = 3;
const ENROLLMENT_MAX_SAMPLES = 8;
const DEFAULT_MATCH_THRESHOLD = 0.72;
const DEFAULT_MATCH_MARGIN = 0.08;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(code, message, statusCode = 400, retryable = false) {
  return { ok: false, code, message, statusCode, retryable };
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function runtime(env = process.env) {
  const raw = text(env.FACE_TEMPLATE_ENCRYPTION_KEY);
  let key = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9_-]{43,44}$/.test(raw)) {
    try {
      key = Buffer.from(raw, 'base64url');
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    return { ok: false, code: 'FACE_TEMPLATE_KEY_NOT_CONFIGURED' };
  }
  return {
    ok: true,
    key,
    keyId: text(env.FACE_TEMPLATE_KEY_ID) || 'v1',
    matchThreshold: boundedNumber(env.FACE_MATCH_THRESHOLD, DEFAULT_MATCH_THRESHOLD, 0.5, 0.99),
    matchMargin: boundedNumber(env.FACE_MATCH_MARGIN, DEFAULT_MATCH_MARGIN, 0.01, 0.5),
  };
}

function normalizeVector(value) {
  if (!Array.isArray(value) || value.length !== FACE_EMBEDDING_DIMENSIONS) return null;
  const vector = value.map(Number);
  if (vector.some((item) => !Number.isFinite(item) || Math.abs(item) > 1000)) return null;
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  return vector.map((item) => item / norm);
}

export function aggregateFaceEmbeddings(samples) {
  if (!Array.isArray(samples) || samples.length < ENROLLMENT_MIN_SAMPLES || samples.length > ENROLLMENT_MAX_SAMPLES) {
    return null;
  }
  const normalized = samples.map(normalizeVector);
  if (normalized.some((item) => item === null)) return null;
  const mean = new Array(FACE_EMBEDDING_DIMENSIONS).fill(0);
  for (const vector of normalized) {
    for (let index = 0; index < FACE_EMBEDDING_DIMENSIONS; index += 1) {
      mean[index] += vector[index];
    }
  }
  for (let index = 0; index < FACE_EMBEDDING_DIMENSIONS; index += 1) {
    mean[index] /= normalized.length;
  }
  return normalizeVector(mean);
}

function vectorToBuffer(vector) {
  const buffer = Buffer.alloc(FACE_EMBEDDING_DIMENSIONS * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function bufferToVector(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== FACE_EMBEDDING_DIMENSIONS * 4) {
    throw new Error('FACE_TEMPLATE_PAYLOAD_INVALID');
  }
  const vector = [];
  for (let index = 0; index < FACE_EMBEDDING_DIMENSIONS; index += 1) {
    vector.push(buffer.readFloatLE(index * 4));
  }
  const normalized = normalizeVector(vector);
  if (!normalized) throw new Error('FACE_TEMPLATE_PAYLOAD_INVALID');
  return normalized;
}

function encryptEmbedding(vector, faceRuntime) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', faceRuntime.key, iv);
  const ciphertext = Buffer.concat([cipher.update(vectorToBuffer(vector)), cipher.final()]);
  return {
    encryptedEmbedding: ciphertext,
    encryptionIv: iv,
    encryptionTag: cipher.getAuthTag(),
    keyId: faceRuntime.keyId,
  };
}

function decryptEmbedding(row, faceRuntime) {
  if (row.key_id !== faceRuntime.keyId) throw new Error('FACE_TEMPLATE_KEY_VERSION_MISMATCH');
  const decipher = createDecipheriv('aes-256-gcm', faceRuntime.key, row.encryption_iv);
  decipher.setAuthTag(row.encryption_tag);
  const plaintext = Buffer.concat([
    decipher.update(row.encrypted_embedding),
    decipher.final(),
  ]);
  return bufferToVector(plaintext);
}

export function cosineSimilarity(left, right) {
  const a = normalizeVector(left);
  const b = normalizeVector(right);
  if (!a || !b) return null;
  return a.reduce((sum, item, index) => sum + item * b[index], 0);
}

export function chooseFaceMatch(scoredCandidates, {
  threshold = DEFAULT_MATCH_THRESHOLD,
  margin = DEFAULT_MATCH_MARGIN,
} = {}) {
  const sorted = [...scoredCandidates]
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score);
  const best = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  if (!best || best.score < threshold) {
    return { ok: false, code: 'FACE_NOT_RECOGNIZED' };
  }
  if (second && (best.score - second.score) < margin) {
    return { ok: false, code: 'FACE_MATCH_AMBIGUOUS' };
  }
  return { ok: true, candidate: best };
}

export function faceDeviceCredentialHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createFaceDeviceCredential(deviceId = randomUUID()) {
  if (!UUID_PATTERN.test(deviceId)) throw new Error('FACE_DEVICE_ID_INVALID');
  return `nppface.${deviceId.toLowerCase()}.${randomBytes(32).toString('base64url')}`;
}

export function parseFaceDeviceCredential(value) {
  const token = text(value);
  const match = DEVICE_TOKEN_PATTERN.exec(token);
  if (!match || !UUID_PATTERN.test(match[1])) return null;
  return { token, deviceId: match[1].toLowerCase() };
}

export async function authenticateFaceDevice(client, {
  installationId,
  credential,
}) {
  const parsed = parseFaceDeviceCredential(credential);
  if (!parsed) return fail('FACE_DEVICE_UNAUTHORIZED', 'Thiết bị chưa được xác thực', 401);
  const device = await faceRepo.findActiveFaceDeviceByCredentialHash(client, {
    installationId,
    credentialHash: faceDeviceCredentialHash(parsed.token),
  });
  if (!device || String(device.id).toLowerCase() !== parsed.deviceId) {
    return fail('FACE_DEVICE_UNAUTHORIZED', 'Thiết bị chưa được xác thực', 401);
  }
  await faceRepo.touchFaceDevice(client, { installationId, id: device.id });
  return { ok: true, device };
}

export async function provisionFaceDevice(client, {
  installationId,
  payload,
  actorId,
  branchIds = null,
  companyScope = false,
}) {
  const name = text(payload?.name);
  const attendancePointId = text(payload?.attendancePointId);
  if (!name || name.length > DEVICE_NAME_MAX_LENGTH) {
    return fail('FACE_DEVICE_NAME_INVALID', 'Tên thiết bị phải từ 1 đến 128 ký tự');
  }
  if (!UUID_PATTERN.test(attendancePointId)) {
    return fail('ATTENDANCE_POINT_NOT_FOUND', 'Không tìm thấy nơi chấm công', 404);
  }
  const point = await faceRepo.getAttendancePointForFace(client, { installationId, attendancePointId });
  if (!point || !point.is_active || !point.branch_active) {
    return fail('ATTENDANCE_POINT_NOT_FOUND', 'Không tìm thấy nơi chấm công đang hoạt động', 404);
  }
  if (!companyScope && !new Set(branchIds ?? []).has(String(point.branch_id))) {
    return fail('SCOPE_FORBIDDEN', 'Bạn không có quyền thiết lập thiết bị cho nơi làm việc này', 403);
  }

  const deviceId = randomUUID();
  const credential = createFaceDeviceCredential(deviceId);
  const device = await faceRepo.createFaceDevice(client, {
    installationId,
    name,
    branchId: point.branch_id,
    attendancePointId: point.id,
    credentialHash: faceDeviceCredentialHash(credential),
    actorId,
  });
  if (!device) return fail('FACE_DEVICE_CREATE_FAILED', 'Không thiết lập được thiết bị chấm công', 500, true);
  return { ok: true, device, credential };
}

export async function listFaceTemplateStatus(client, {
  installationId,
  employeeId = null,
  branchIds = null,
  companyScope = false,
}) {
  if (employeeId && !UUID_PATTERN.test(employeeId)) {
    return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự', 404);
  }
  const templates = await faceRepo.listFaceTemplateMetadata(client, {
    installationId,
    employeeId: employeeId || null,
    branchIds: companyScope ? null : branchIds,
  });
  return {
    ok: true,
    templates: templates.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      employeeName: row.employee_name,
      branchId: row.branch_id,
      branchName: row.branch_name ?? null,
      version: Number(row.version),
      modelCode: row.model_code,
      dimensions: Number(row.dimensions),
      registeredAt: row.created_at,
    })),
  };
}

export async function enrollFaceTemplate(client, {
  installationId,
  payload,
  actorId,
  branchIds = null,
  companyScope = false,
  env = process.env,
}) {
  const employeeId = text(payload?.employeeId);
  if (!UUID_PATTERN.test(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự', 404);
  if (text(payload?.modelCode) !== FACE_MODEL_CODE) {
    return fail('FACE_MODEL_UNSUPPORTED', 'Mẫu nhận diện không tương thích với thiết bị');
  }
  const employee = await faceRepo.getEmployeeForFace(client, { installationId, employeeId });
  if (!employee || !employee.is_active) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự đang hoạt động', 404);
  if (!employee.branch_id) return fail('EMPLOYEE_WORKPLACE_REQUIRED', 'Hồ sơ nhân sự chưa có nơi làm việc');
  if (!companyScope && !new Set(branchIds ?? []).has(String(employee.branch_id))) {
    return fail('SCOPE_FORBIDDEN', 'Bạn không có quyền đăng ký nhân sự ngoài phạm vi được cấp', 403);
  }

  const embedding = aggregateFaceEmbeddings(payload?.embeddings);
  if (!embedding) {
    return fail('FACE_TEMPLATE_INVALID', 'Dữ liệu khuôn mặt chưa đủ chất lượng để đăng ký');
  }
  const faceRuntime = runtime(env);
  if (!faceRuntime.ok) {
    return fail('FACE_SERVICE_NOT_CONFIGURED', 'Dịch vụ nhận diện khuôn mặt chưa sẵn sàng', 503, false);
  }
  const encrypted = encryptEmbedding(embedding, faceRuntime);
  const saved = await faceRepo.replaceEmployeeFaceTemplate(client, {
    installationId,
    employeeId,
    modelCode: FACE_MODEL_CODE,
    dimensions: FACE_EMBEDDING_DIMENSIONS,
    ...encrypted,
    actorId,
  });
  if (!saved.template) return fail('FACE_TEMPLATE_SAVE_FAILED', 'Không lưu được mẫu khuôn mặt', 500, true);
  return {
    ok: true,
    before: saved.before,
    template: {
      id: saved.template.id,
      employeeId,
      employeeCode: employee.code,
      employeeName: employee.full_name,
      branchId: employee.branch_id,
      branchName: employee.branch_name ?? null,
      version: Number(saved.template.version),
      modelCode: saved.template.model_code,
      dimensions: Number(saved.template.dimensions),
      registeredAt: saved.template.created_at,
    },
  };
}

export async function recognizeFace(client, {
  installationId,
  device,
  embedding,
  modelCode,
  env = process.env,
}) {
  if (text(modelCode) !== FACE_MODEL_CODE) {
    return fail('FACE_MODEL_UNSUPPORTED', 'Mẫu nhận diện không tương thích với thiết bị', 422);
  }
  const query = normalizeVector(embedding);
  if (!query) return fail('FACE_TEMPLATE_INVALID', 'Dữ liệu khuôn mặt chưa đủ chất lượng để nhận diện', 422);
  const faceRuntime = runtime(env);
  if (!faceRuntime.ok) {
    return fail('FACE_SERVICE_NOT_CONFIGURED', 'Dịch vụ nhận diện khuôn mặt chưa sẵn sàng', 503, false);
  }
  const rows = await faceRepo.listActiveFaceTemplatesForBranch(client, {
    installationId,
    branchId: device.branch_id,
    modelCode: FACE_MODEL_CODE,
  });
  if (!rows.length) return fail('FACE_NOT_RECOGNIZED', 'Không nhận diện được nhân sự', 422);

  let scored;
  try {
    scored = rows.map((row) => ({
      row,
      score: cosineSimilarity(query, decryptEmbedding(row, faceRuntime)),
    }));
  } catch {
    return fail('FACE_TEMPLATE_UNAVAILABLE', 'Mẫu khuôn mặt tạm thời chưa sẵn sàng', 503, true);
  }
  const match = chooseFaceMatch(scored, {
    threshold: faceRuntime.matchThreshold,
    margin: faceRuntime.matchMargin,
  });
  if (!match.ok) {
    return fail(
      match.code,
      match.code === 'FACE_MATCH_AMBIGUOUS'
        ? 'Chưa xác định chắc chắn nhân sự; vui lòng thử lại'
        : 'Không nhận diện được nhân sự',
      422,
    );
  }
  const row = match.candidate.row;
  return {
    ok: true,
    match: {
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      employeeName: row.employee_name,
      branchId: row.branch_id,
      modelCode: row.model_code,
    },
  };
}
