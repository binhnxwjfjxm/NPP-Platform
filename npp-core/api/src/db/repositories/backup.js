export const ACTIVE_BACKUP_STATUSES = Object.freeze([
  'QUEUED',
  'SNAPSHOTTING',
  'DUMPING_DATABASE',
  'EXPORTING_DATASETS',
  'BUILDING_ARCHIVE',
  'HASHING',
  'UPLOADING_R2',
  'VERIFYING_R2',
]);

export async function findActiveBackupJob(client, { installationId }) {
  const result = await client.query(
    `SELECT * FROM shared.backup_jobs
      WHERE installation_id = $1
        AND status = ANY($2::text[])
      ORDER BY requested_at DESC
      LIMIT 1`,
    [installationId, ACTIVE_BACKUP_STATUSES],
  );
  return result.rows[0] ?? null;
}

export async function lockActiveBackupJob(client, { installationId }) {
  const result = await client.query(
    `SELECT * FROM shared.backup_jobs
      WHERE installation_id = $1
        AND status = ANY($2::text[])
      ORDER BY requested_at DESC
      LIMIT 1
      FOR UPDATE`,
    [installationId, ACTIVE_BACKUP_STATUSES],
  );
  return result.rows[0] ?? null;
}

export async function insertBackupJob(client, job) {
  const result = await client.query(
    `INSERT INTO shared.backup_jobs (
       id, installation_id, status, requested_by, source_app, request_id, include_xlsx
     ) VALUES ($1, $2, 'QUEUED', $3, $4, $5, $6)
     RETURNING *`,
    [job.id, job.installationId, job.requestedBy, job.sourceApp, job.requestId, job.includeXlsx],
  );
  return result.rows[0];
}

export async function claimQueuedBackupJob(client, { installationId, jobId, startedAt }) {
  const result = await client.query(
    `UPDATE shared.backup_jobs
        SET status = 'SNAPSHOTTING',
            started_at = COALESCE(started_at, $3::timestamptz),
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'QUEUED'
      RETURNING *`,
    [installationId, jobId, startedAt],
  );
  return result.rows[0] ?? null;
}

export async function getBackupJob(client, { installationId, jobId }) {
  const result = await client.query(
    `SELECT * FROM shared.backup_jobs WHERE installation_id = $1 AND id = $2`,
    [installationId, jobId],
  );
  return result.rows[0] ?? null;
}

export async function listBackupJobs(client, { installationId, limit = 20 }) {
  const result = await client.query(
    `SELECT * FROM shared.backup_jobs
      WHERE installation_id = $1
      ORDER BY requested_at DESC
      LIMIT $2`,
    [installationId, limit],
  );
  return result.rows;
}

export async function updateBackupStatus(client, {
  installationId,
  jobId,
  status,
  snapshotAt = undefined,
  startedAt = undefined,
  completedAt = undefined,
  schemaVersion = undefined,
}) {
  const result = await client.query(
    `UPDATE shared.backup_jobs
        SET status = $3,
            snapshot_at = CASE WHEN $4::timestamptz IS NULL THEN snapshot_at ELSE $4::timestamptz END,
            started_at = CASE WHEN $5::timestamptz IS NULL THEN started_at ELSE $5::timestamptz END,
            completed_at = CASE WHEN $6::timestamptz IS NULL THEN completed_at ELSE $6::timestamptz END,
            schema_version = CASE WHEN $7::text IS NULL THEN schema_version ELSE $7::text END,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [installationId, jobId, status, snapshotAt ?? null, startedAt ?? null, completedAt ?? null, schemaVersion ?? null],
  );
  return result.rows[0] ?? null;
}

export async function replaceBackupDatasets(client, { jobId, datasets }) {
  await client.query('DELETE FROM shared.backup_job_datasets WHERE backup_job_id = $1', [jobId]);
  for (const dataset of datasets) {
    await client.query(
      `INSERT INTO shared.backup_job_datasets (
        backup_job_id, dataset_key, row_count, checksum_sha256, exported_at
      ) VALUES ($1, $2, $3, $4, $5)`,
      [jobId, dataset.key, dataset.rowCount, dataset.sha256, dataset.exportedAt],
    );
  }
}

export async function finalizeBackupJob(client, {
  installationId,
  jobId,
  dump,
  csv,
  xlsx,
  manifest,
  datasetCount,
  totalRowCount,
  verifiedAt,
}) {
  const result = await client.query(
    `UPDATE shared.backup_jobs
        SET status = 'VERIFIED',
            dump_object_key = $3,
            dump_size = $4,
            dump_sha256 = $5,
            csv_object_key = $6,
            csv_size = $7,
            csv_sha256 = $8,
            xlsx_object_key = $9,
            xlsx_size = $10,
            xlsx_sha256 = $11,
            manifest_object_key = $12,
            manifest_sha256 = $13,
            dataset_count = $14,
            total_row_count = $15,
            verified_at = $16,
            completed_at = $16,
            failure_code = NULL,
            failure_message_safe = NULL,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [
      installationId,
      jobId,
      dump.key,
      dump.size,
      dump.sha256,
      csv.key,
      csv.size,
      csv.sha256,
      xlsx?.key ?? null,
      xlsx?.size ?? null,
      xlsx?.sha256 ?? null,
      manifest.key,
      manifest.sha256,
      datasetCount,
      totalRowCount,
      verifiedAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function failBackupJob(client, {
  installationId,
  jobId,
  failureCode,
  safeMessage,
}) {
  const result = await client.query(
    `UPDATE shared.backup_jobs
        SET status = 'FAILED',
            failure_code = $3,
            failure_message_safe = $4,
            completed_at = now(),
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status <> 'VERIFIED'
      RETURNING *`,
    [installationId, jobId, failureCode, safeMessage],
  );
  return result.rows[0] ?? null;
}

export async function insertDeletionIntent(client, intent) {
  const result = await client.query(
    `INSERT INTO shared.data_deletion_intents (
      id, installation_id, backup_job_id, status, requested_by, source_app, request_id,
      reason, challenge_code_hash, challenge_expires_at, owner_recipient_count
    ) VALUES ($1,$2,$3,'CHALLENGE_PENDING',$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    [
      intent.id,
      intent.installationId,
      intent.backupJobId,
      intent.requestedBy,
      intent.sourceApp,
      intent.requestId,
      intent.reason,
      intent.challengeCodeHash,
      intent.challengeExpiresAt,
      intent.ownerRecipientCount,
    ],
  );
  return result.rows[0];
}

export async function markDeletionChallengeSent(client, { installationId, intentId }) {
  const result = await client.query(
    `UPDATE shared.data_deletion_intents
        SET challenge_sent_at = now(), updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, intentId],
  );
  return result.rows[0] ?? null;
}

export async function failDeletionIntent(client, { installationId, intentId, failureCode }) {
  const result = await client.query(
    `UPDATE shared.data_deletion_intents
        SET status = 'FAILED', failure_code = $3, updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status <> 'AUTHORIZED'
      RETURNING *`,
    [installationId, intentId, failureCode],
  );
  return result.rows[0] ?? null;
}

export async function lockDeletionIntent(client, { installationId, intentId }) {
  const result = await client.query(
    `SELECT * FROM shared.data_deletion_intents
      WHERE installation_id = $1 AND id = $2
      FOR UPDATE`,
    [installationId, intentId],
  );
  return result.rows[0] ?? null;
}

export async function incrementDeletionChallengeFailure(client, { installationId, intentId, maxAttempts }) {
  const result = await client.query(
    `UPDATE shared.data_deletion_intents
        SET challenge_failed_attempts = challenge_failed_attempts + 1,
            status = CASE WHEN challenge_failed_attempts + 1 >= $3 THEN 'FAILED' ELSE status END,
            failure_code = CASE WHEN challenge_failed_attempts + 1 >= $3 THEN 'DATA_DELETION_CODE_ATTEMPTS_EXCEEDED' ELSE failure_code END,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, intentId, maxAttempts],
  );
  return result.rows[0] ?? null;
}

export async function authorizeDeletionIntent(client, { installationId, intentId, verifiedAt }) {
  const result = await client.query(
    `UPDATE shared.data_deletion_intents
        SET status = 'AUTHORIZED',
            challenge_verified_at = $3,
            authorized_at = $3,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'CHALLENGE_PENDING'
      RETURNING *`,
    [installationId, intentId, verifiedAt],
  );
  return result.rows[0] ?? null;
}
