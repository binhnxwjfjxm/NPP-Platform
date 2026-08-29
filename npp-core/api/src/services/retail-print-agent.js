import { createHash, randomBytes, randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9._-]{32,160}$/;
const PAIRING_CODE_PATTERN = /^[A-Z0-9]{8}$/;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_TTL_MINUTES = 10;
const ONLINE_SECONDS = 45;
const CLAIM_LEASE_SECONDS = 90;
const MAX_PAYLOAD_BYTES = 128 * 1024;

function ok(data) {
  return Object.freeze({ ok: true, ...data });
}

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, maxLength) {
  const result = String(value ?? '').trim();
  return result && result.length <= maxLength ? result : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function randomPairingCode() {
  const bytes = randomBytes(8);
  let result = '';
  for (const byte of bytes) result += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return result;
}

function normalizePairingCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return PAIRING_CODE_PATTERN.test(code) ? code : '';
}

function normalizePairingStart(payload) {
  const deviceId = String(payload?.deviceId ?? '').trim();
  const deviceName = text(payload?.deviceName, 120);
  const protocolVersion = String(payload?.protocolVersion ?? '').trim();
  const credentialHash = String(payload?.credentialHash ?? '').trim().toLowerCase();
  const pairingProofHash = String(payload?.pairingProofHash ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(deviceId) || !deviceName || protocolVersion !== '1') return null;
  if (!HASH_PATTERN.test(credentialHash) || !HASH_PATTERN.test(pairingProofHash)) return null;
  return Object.freeze({ deviceId, deviceName, protocolVersion, credentialHash, pairingProofHash });
}

function normalizeJobPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const documentType = payload.documentType === 'SALES_ORDER' || payload.documentType === 'PRINTER_TEST'
    ? payload.documentType
    : '';
  const paper = payload.paper === '80mm' || payload.paper === '58mm' ? payload.paper : '';
  const copies = Number(payload.copies);
  if (!documentType || !paper || !Number.isInteger(copies) || copies < 1 || copies > 5) return null;
  const serialized = JSON.stringify(payload);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) return null;
  return payload;
}

function normalizeWaitSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(20, Math.trunc(parsed)));
}

function publicAgent(row) {
  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  const online = Boolean(seen && Date.now() - seen <= ONLINE_SECONDS * 1000);
  return Object.freeze({
    id: String(row.id),
    name: String(row.device_name),
    status: online ? 'ONLINE' : 'OFFLINE',
    lastSeenAt: row.last_seen_at ?? null,
    printerName: row.printer_name ?? null,
    paperWidthMm: row.paper_width_mm == null ? null : Number(row.paper_width_mm),
  });
}

function publicJob(row) {
  return Object.freeze({
    jobId: String(row.id),
    status: String(row.status).toUpperCase(),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at ?? null,
    completedAt: row.completed_at ?? null,
  });
}

export async function startPairing(client, { installationId, payload }) {
  const input = normalizePairingStart(payload);
  if (!input) return failure('INVALID_PAIRING_REQUEST', 'Thông tin Retail Print không hợp lệ');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pairingCode = randomPairingCode();
    try {
      await client.query('SAVEPOINT retail_print_pairing_code');
      const result = await client.query(
        `INSERT INTO shared.retail_print_agents (
           id, installation_id, device_id, device_name, protocol_version,
           credential_hash, pairing_code, pairing_proof_hash, pairing_expires_at,
           paired_at, paired_by, last_seen_at, is_active, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + interval '${PAIRING_TTL_MINUTES} minutes',NULL,NULL,now(),true,now(),now())
         ON CONFLICT (installation_id, device_id)
         DO UPDATE SET device_name=EXCLUDED.device_name,
                       protocol_version=EXCLUDED.protocol_version,
                       pairing_code=EXCLUDED.pairing_code,
                       pairing_proof_hash=EXCLUDED.pairing_proof_hash,
                       pairing_expires_at=EXCLUDED.pairing_expires_at,
                       paired_at=NULL,
                       paired_by=NULL,
                       last_seen_at=now(),
                       is_active=true,
                       updated_at=now()
         WHERE shared.retail_print_agents.credential_hash = EXCLUDED.credential_hash
         RETURNING id, device_name, pairing_code, pairing_expires_at`,
        [randomUUID(), installationId, input.deviceId, input.deviceName, input.protocolVersion,
          input.credentialHash, pairingCode, input.pairingProofHash],
      );
      await client.query('RELEASE SAVEPOINT retail_print_pairing_code');
      if (result.rows.length !== 1) return failure('PAIRING_DEVICE_CONFLICT', 'Thiết bị này đã có khóa kết nối khác');
      const row = result.rows[0];
      return ok({
        pairing: Object.freeze({
          agentId: String(row.id),
          pairingCode: String(row.pairing_code),
          expiresAt: row.pairing_expires_at,
          deviceName: String(row.device_name),
        }),
      });
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT retail_print_pairing_code').catch(() => {});
      if (error?.code !== '23505' || attempt === 4) throw error;
    }
  }
  return failure('PAIRING_CODE_UNAVAILABLE', 'Chưa thể tạo mã kết nối mới', true);
}

export async function pairAgent(client, { installationId, actorId, pairingCode }) {
  const code = normalizePairingCode(pairingCode);
  if (!code) return failure('INVALID_PAIRING_CODE', 'Mã kết nối phải gồm 8 ký tự');
  const result = await client.query(
    `UPDATE shared.retail_print_agents
        SET paired_at=now(), paired_by=$3, pairing_code=NULL, pairing_proof_hash=NULL,
            pairing_expires_at=NULL, updated_at=now()
      WHERE installation_id=$1 AND pairing_code=$2 AND is_active=true
        AND pairing_expires_at > now()
      RETURNING *`,
    [installationId, code, actorId],
  );
  if (result.rows.length !== 1) return failure('PAIRING_CODE_NOT_FOUND', 'Mã kết nối không đúng hoặc đã hết hạn');
  return ok({ agent: publicAgent(result.rows[0]) });
}

export async function listAgents(client, { installationId }) {
  const result = await client.query(
    `SELECT * FROM shared.retail_print_agents
      WHERE installation_id=$1 AND is_active=true AND paired_at IS NOT NULL
      ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`,
    [installationId],
  );
  return ok({ agents: Object.freeze(result.rows.map(publicAgent)) });
}

export async function queueJob(client, { installationId, actorId, agentId, idempotencyKey, payload }) {
  if (!UUID_PATTERN.test(String(agentId ?? ''))) return failure('INVALID_PRINT_AGENT_ID', 'Mã Retail Print không hợp lệ');
  const normalizedPayload = normalizeJobPayload(payload);
  if (!normalizedPayload) return failure('INVALID_PRINT_PAYLOAD', 'Nội dung in không hợp lệ');

  const agent = await client.query(
    `SELECT * FROM shared.retail_print_agents
      WHERE installation_id=$1 AND id=$2 AND is_active=true AND paired_at IS NOT NULL
      LIMIT 1`,
    [installationId, agentId],
  );
  if (agent.rows.length !== 1) return failure('PRINT_AGENT_NOT_FOUND', 'Retail Print chưa được kết nối');
  const status = publicAgent(agent.rows[0]);
  if (status.status !== 'ONLINE') return failure('PRINT_AGENT_OFFLINE', 'Retail Print trên Windows đang ngoại tuyến', true);

  const result = await client.query(
    `INSERT INTO shared.retail_print_jobs (
       id, installation_id, agent_id, idempotency_key, payload, status, queued_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5::jsonb,'queued',$6,now(),now())
     ON CONFLICT (installation_id, agent_id, queued_by, idempotency_key)
     DO UPDATE SET updated_at=shared.retail_print_jobs.updated_at
     RETURNING *`,
    [randomUUID(), installationId, agentId, idempotencyKey, JSON.stringify(normalizedPayload), actorId],
  );
  return ok({ job: publicJob(result.rows[0]) });
}

export async function getJob(client, { installationId, actorId, jobId }) {
  if (!UUID_PATTERN.test(String(jobId ?? ''))) return failure('INVALID_PRINT_JOB_ID', 'Mã lệnh in không hợp lệ');
  const result = await client.query(
    `SELECT * FROM shared.retail_print_jobs
      WHERE installation_id=$1 AND id=$2 AND queued_by=$3
      LIMIT 1`,
    [installationId, jobId, actorId],
  );
  if (result.rows.length !== 1) return failure('PRINT_JOB_NOT_FOUND', 'Không tìm thấy lệnh in');
  return ok({ job: publicJob(result.rows[0]) });
}

export async function authenticateAgent(client, { installationId, deviceId, credential }) {
  const normalizedDeviceId = String(deviceId ?? '').trim();
  const secret = String(credential ?? '').trim();
  if (!UUID_PATTERN.test(normalizedDeviceId) || !SECRET_PATTERN.test(secret)) return failure('PRINT_AGENT_UNAUTHORIZED', 'Retail Print chưa được xác thực');
  const result = await client.query(
    `SELECT * FROM shared.retail_print_agents
      WHERE installation_id=$1 AND device_id=$2 AND credential_hash=$3
        AND is_active=true AND paired_at IS NOT NULL
      LIMIT 1`,
    [installationId, normalizedDeviceId, sha256(secret)],
  );
  if (result.rows.length !== 1) return failure('PRINT_AGENT_UNAUTHORIZED', 'Retail Print chưa được xác thực');
  return ok({ row: result.rows[0] });
}

export async function heartbeat(client, { installationId, agentId, printerName, paperWidthMm }) {
  const cleanPrinter = printerName == null ? null : text(printerName, 120);
  const width = Number(paperWidthMm);
  if (printerName != null && !cleanPrinter) return failure('INVALID_PRINTER_NAME', 'Tên máy in không hợp lệ');
  if (![58, 80].includes(width)) return failure('INVALID_PAPER_WIDTH', 'Khổ giấy phải là 58 mm hoặc 80 mm');
  const result = await client.query(
    `UPDATE shared.retail_print_agents
        SET last_seen_at=now(), printer_name=$3, paper_width_mm=$4, updated_at=now()
      WHERE installation_id=$1 AND id=$2 AND is_active=true
      RETURNING *`,
    [installationId, agentId, cleanPrinter, width],
  );
  if (result.rows.length !== 1) return failure('PRINT_AGENT_NOT_FOUND', 'Retail Print chưa được kết nối');
  return ok({ agent: publicAgent(result.rows[0]) });
}

export async function claimJob(client, { installationId, agentId }) {
  await client.query(
    `UPDATE shared.retail_print_jobs
        SET status='queued', claimed_at=NULL, updated_at=now()
      WHERE installation_id=$1 AND agent_id=$2
        AND status='claimed' AND claimed_at < now() - interval '${CLAIM_LEASE_SECONDS} seconds'`,
    [installationId, agentId],
  );
  const result = await client.query(
    `WITH candidate AS (
       SELECT id FROM shared.retail_print_jobs
        WHERE installation_id=$1 AND agent_id=$2 AND status='queued'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE shared.retail_print_jobs job
        SET status='claimed', claimed_at=now(), delivery_attempts=delivery_attempts + 1, updated_at=now()
       FROM candidate
      WHERE job.id=candidate.id
      RETURNING job.*`,
    [installationId, agentId],
  );
  if (result.rows.length === 0) return ok({ job: null });
  const row = result.rows[0];
  return ok({ job: Object.freeze({ jobId: String(row.id), payload: row.payload, deliveryAttempt: Number(row.delivery_attempts), createdAt: row.created_at }) });
}

export async function completeJob(client, { installationId, agentId, jobId, success, errorCode, errorMessage }) {
  if (!UUID_PATTERN.test(String(jobId ?? ''))) return failure('INVALID_PRINT_JOB_ID', 'Mã lệnh in không hợp lệ');
  const status = success === true ? 'completed' : 'failed';
  const code = status === 'failed' ? text(errorCode, 80) || 'PRINTER_SEND_FAILED' : null;
  const message = status === 'failed' ? text(errorMessage, 240) || 'Không thể in chứng từ' : null;
  const result = await client.query(
    `UPDATE shared.retail_print_jobs
        SET status=$4, completed_at=now(), error_code=$5, error_message=$6, updated_at=now()
      WHERE installation_id=$1 AND agent_id=$2 AND id=$3 AND status='claimed'
      RETURNING *`,
    [installationId, agentId, jobId, status, code, message],
  );
  if (result.rows.length !== 1) return failure('PRINT_JOB_NOT_CLAIMED', 'Lệnh in không còn ở trạng thái chờ xác nhận');
  return ok({ job: publicJob(result.rows[0]) });
}

export const retailPrintAgentInternals = Object.freeze({
  normalizePairingStart,
  normalizePairingCode,
  normalizeJobPayload,
  normalizeWaitSeconds,
  randomPairingCode,
  CLAIM_LEASE_SECONDS,
});
