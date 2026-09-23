import { randomUUID } from 'node:crypto';

const DEVICE_COLUMNS = `d.id, d.installation_id, d.name, d.branch_id, d.attendance_point_id,
  d.is_active, d.last_seen_at, d.created_at, d.updated_at, d.created_by, d.updated_by,
  p.code AS point_code, p.name AS point_name, p.is_active AS point_active,
  b.code AS branch_code, b.name AS branch_name, b.is_active AS branch_active`;

export async function getEmployeeForFace(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT e.id, e.code, e.full_name, e.branch_id, e.is_active,
            b.code AS branch_code, b.name AS branch_name
       FROM shared.employees e
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE e.installation_id = $1 AND e.id = $2`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function getAttendancePointForFace(client, { installationId, attendancePointId }) {
  const result = await client.query(
    `SELECT p.id, p.installation_id, p.code, p.name, p.branch_id, p.is_active,
            b.code AS branch_code, b.name AS branch_name, b.is_active AS branch_active
       FROM shared.attendance_points p
       JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1 AND p.id = $2`,
    [installationId, attendancePointId],
  );
  return result.rows?.[0] ?? null;
}

export async function listFaceTemplateMetadata(client, {
  installationId,
  branchIds = null,
  employeeId = null,
}) {
  const params = [installationId];
  let query = `SELECT t.id, t.employee_id, t.version, t.model_code, t.dimensions,
                      t.key_id, t.created_at,
                      e.code AS employee_code, e.full_name AS employee_name, e.branch_id,
                      b.code AS branch_code, b.name AS branch_name
                 FROM shared.employee_face_templates t
                 JOIN shared.employees e
                   ON e.installation_id = t.installation_id AND e.id = t.employee_id
                 LEFT JOIN shared.branches b
                   ON b.installation_id = e.installation_id AND b.id = e.branch_id
                WHERE t.installation_id = $1
                  AND t.is_active = true
                  AND e.is_active = true`;
  if (Array.isArray(branchIds)) {
    params.push(branchIds);
    query += ` AND e.branch_id = ANY($${params.length}::uuid[])`;
  }
  if (employeeId) {
    params.push(employeeId);
    query += ` AND e.id = $${params.length}`;
  }
  query += ' ORDER BY e.code ASC';
  const result = await client.query(query, params);
  return result.rows ?? [];
}

export async function listActiveFaceTemplatesForBranch(client, {
  installationId,
  branchId,
  modelCode,
}) {
  const result = await client.query(
    `SELECT t.id, t.employee_id, t.version, t.model_code, t.dimensions,
            t.encrypted_embedding, t.encryption_iv, t.encryption_tag, t.key_id,
            e.code AS employee_code, e.full_name AS employee_name, e.branch_id
       FROM shared.employee_face_templates t
       JOIN shared.employees e
         ON e.installation_id = t.installation_id AND e.id = t.employee_id
      WHERE t.installation_id = $1
        AND t.is_active = true
        AND t.model_code = $2
        AND e.is_active = true
        AND e.branch_id = $3
      ORDER BY e.code ASC
      LIMIT 5000`,
    [installationId, modelCode, branchId],
  );
  return result.rows ?? [];
}

export async function replaceEmployeeFaceTemplate(client, {
  installationId,
  employeeId,
  modelCode,
  dimensions,
  encryptedEmbedding,
  encryptionIv,
  encryptionTag,
  keyId,
  actorId,
}) {
  const current = await client.query(
    `SELECT id, version, model_code, dimensions, key_id, created_at
       FROM shared.employee_face_templates
      WHERE installation_id = $1 AND employee_id = $2 AND is_active = true
      FOR UPDATE`,
    [installationId, employeeId],
  );
  const before = current.rows?.[0] ?? null;
  const nextVersionResult = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM shared.employee_face_templates
      WHERE installation_id = $1 AND employee_id = $2`,
    [installationId, employeeId],
  );
  const version = Number(nextVersionResult.rows?.[0]?.next_version ?? 1);

  if (before) {
    await client.query(
      `UPDATE shared.employee_face_templates
          SET is_active = false, revoked_at = now(), revoked_by = $3
        WHERE installation_id = $1 AND id = $2`,
      [installationId, before.id, actorId],
    );
  }

  const id = randomUUID();
  const inserted = await client.query(
    `INSERT INTO shared.employee_face_templates (
       id, installation_id, employee_id, version, model_code, dimensions,
       encrypted_embedding, encryption_iv, encryption_tag, key_id,
       is_active, created_at, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,now(),$11)
     RETURNING id, employee_id, version, model_code, dimensions, key_id, created_at`,
    [
      id, installationId, employeeId, version, modelCode, dimensions,
      encryptedEmbedding, encryptionIv, encryptionTag, keyId, actorId,
    ],
  );
  return { before, template: inserted.rows?.[0] ?? null };
}

export async function createFaceDevice(client, {
  id,
  installationId,
  name,
  branchId,
  attendancePointId,
  credentialHash,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO shared.attendance_face_devices (
       id, installation_id, name, branch_id, attendance_point_id, credential_hash,
       is_active, created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,true,now(),now(),$7,$7)
     RETURNING id`,
    [id, installationId, name, branchId, attendancePointId, credentialHash, actorId],
  );
  if (!result.rows?.[0]) return null;
  return getFaceDeviceById(client, { installationId, id });
}

export async function getFaceDeviceById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${DEVICE_COLUMNS}
       FROM shared.attendance_face_devices d
       JOIN shared.attendance_points p
         ON p.installation_id = d.installation_id AND p.id = d.attendance_point_id
       JOIN shared.branches b
         ON b.installation_id = d.installation_id AND b.id = d.branch_id
      WHERE d.installation_id = $1 AND d.id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function findActiveFaceDeviceByCredentialHash(client, {
  installationId,
  credentialHash,
}) {
  const result = await client.query(
    `SELECT ${DEVICE_COLUMNS}
       FROM shared.attendance_face_devices d
       JOIN shared.attendance_points p
         ON p.installation_id = d.installation_id AND p.id = d.attendance_point_id
       JOIN shared.branches b
         ON b.installation_id = d.installation_id AND b.id = d.branch_id
      WHERE d.installation_id = $1
        AND d.credential_hash = $2
        AND d.is_active = true
        AND p.is_active = true
        AND b.is_active = true`,
    [installationId, credentialHash],
  );
  return result.rows?.[0] ?? null;
}

export async function touchFaceDevice(client, { installationId, id }) {
  await client.query(
    `UPDATE shared.attendance_face_devices
        SET last_seen_at = now(),
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
      WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  );
}
