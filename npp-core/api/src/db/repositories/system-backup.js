export async function revokeTechnicalBackupAccess(client, { installationId, requestedBy }) {
  await client.query(
    `UPDATE shared.technical_backup_access_challenges
        SET status = 'REVOKED', updated_at = now()
      WHERE installation_id = $1
        AND requested_by = $2
        AND status IN ('CHALLENGE_PENDING','UNLOCKED')`,
    [installationId, requestedBy],
  );
}

export async function insertTechnicalBackupChallenge(client, challenge) {
  const result = await client.query(
    `INSERT INTO shared.technical_backup_access_challenges (
       id, installation_id, requested_by, source_app, request_id, status,
       recipient_email, challenge_code_hash, challenge_expires_at
     ) VALUES ($1,$2,$3,$4,$5,'CHALLENGE_PENDING',$6,$7,$8)
     RETURNING *`,
    [challenge.id, challenge.installationId, challenge.requestedBy, challenge.sourceApp, challenge.requestId,
      challenge.recipientEmail, challenge.challengeCodeHash, challenge.challengeExpiresAt],
  );
  return result.rows[0];
}

export async function markTechnicalBackupChallengeSent(client, { installationId, challengeId }) {
  const result = await client.query(
    `UPDATE shared.technical_backup_access_challenges
        SET challenge_sent_at = now(), updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, challengeId],
  );
  return result.rows[0] ?? null;
}

export async function failTechnicalBackupChallenge(client, { installationId, challengeId, failureCode, status = 'FAILED' }) {
  const result = await client.query(
    `UPDATE shared.technical_backup_access_challenges
        SET status = $3, failure_code = $4, updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, challengeId, status, failureCode],
  );
  return result.rows[0] ?? null;
}

export async function lockTechnicalBackupChallenge(client, { installationId, challengeId, requestedBy }) {
  const result = await client.query(
    `SELECT * FROM shared.technical_backup_access_challenges
      WHERE installation_id = $1 AND id = $2 AND requested_by = $3
      FOR UPDATE`,
    [installationId, challengeId, requestedBy],
  );
  return result.rows[0] ?? null;
}

export async function incrementTechnicalBackupChallengeFailure(client, { installationId, challengeId, maxAttempts }) {
  const result = await client.query(
    `UPDATE shared.technical_backup_access_challenges
        SET challenge_failed_attempts = challenge_failed_attempts + 1,
            status = CASE WHEN challenge_failed_attempts + 1 >= $3 THEN 'FAILED' ELSE status END,
            failure_code = CASE WHEN challenge_failed_attempts + 1 >= $3 THEN 'TECHNICAL_BACKUP_CODE_ATTEMPTS_EXCEEDED' ELSE failure_code END,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, challengeId, maxAttempts],
  );
  return result.rows[0] ?? null;
}

export async function unlockTechnicalBackupAccess(client, { installationId, challengeId, verifiedAt, unlockTokenHash, unlockExpiresAt }) {
  const result = await client.query(
    `UPDATE shared.technical_backup_access_challenges
        SET status = 'UNLOCKED', challenge_verified_at = $3, unlock_token_hash = $4,
            unlock_expires_at = $5, failure_code = NULL, updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, challengeId, verifiedAt, unlockTokenHash, unlockExpiresAt],
  );
  return result.rows[0] ?? null;
}

export async function getTechnicalBackupAccess(client, { installationId, challengeId, requestedBy }) {
  const result = await client.query(
    `SELECT * FROM shared.technical_backup_access_challenges
      WHERE installation_id = $1 AND id = $2 AND requested_by = $3`,
    [installationId, challengeId, requestedBy],
  );
  return result.rows[0] ?? null;
}

export async function finalizeSystemBackupJob(client, { installationId, jobId, dump, verifiedAt }) {
  const result = await client.query(
    `UPDATE shared.backup_jobs
        SET status = 'VERIFIED', include_xlsx = false,
            dump_object_key = $3, dump_size = $4, dump_sha256 = $5,
            csv_object_key = NULL, csv_size = NULL, csv_sha256 = NULL,
            xlsx_object_key = NULL, xlsx_size = NULL, xlsx_sha256 = NULL,
            manifest_object_key = NULL, manifest_sha256 = NULL,
            dataset_count = 0, total_row_count = 0,
            verified_at = $6, completed_at = $6,
            failure_code = NULL, failure_message_safe = NULL, updated_at = now()
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [installationId, jobId, dump.key, dump.size, dump.sha256, verifiedAt],
  );
  return result.rows[0] ?? null;
}
