import { randomUUID } from 'node:crypto';

const MAX_COUNTER = 999999999999999999n;

const SERIES_COLUMNS = `dns.id, dns.installation_id, dns.code, dns.document_type, dns.name,
  dns.prefix, dns.number_template, dns.reset_policy, dns.sequence_width, dns.start_counter,
  dns.timezone_name, dns.description, dns.is_active, dns.created_at, dns.updated_at,
  dns.created_by, dns.updated_by,
  EXISTS (
    SELECT 1 FROM shared.document_number_allocations dna
    WHERE dna.installation_id = dns.installation_id AND dna.series_id = dns.id
  ) AS format_locked,
  (
    SELECT count(*)::int FROM shared.document_number_allocations dna
    WHERE dna.installation_id = dns.installation_id AND dna.series_id = dns.id
  ) AS allocation_count`;

const ALLOCATION_COLUMNS = `dna.id, dna.installation_id, dna.series_id, dna.idempotency_key,
  dna.document_date, dna.period_key, dna.counter_value, dna.document_number,
  dna.allocated_at, dna.actor_id, dna.request_id, dna.source_app, dna.metadata,
  dns.code AS series_code, dns.document_type, dns.name AS series_name`;

function nowMilliseconds() {
  return new Date().toISOString();
}

function allocationConflictError() {
  const error = new Error('document_number_allocation_conflict');
  error.code = '23505';
  return error;
}

export async function listDocumentNumberSeries(client, {
  installationId,
  search,
  active,
  documentType,
  limit = 200,
  offset = 0,
}) {
  const params = [installationId];
  let query = `SELECT ${SERIES_COLUMNS}
    FROM shared.document_number_series dns
    WHERE dns.installation_id = $1`;
  if (active !== undefined) {
    params.push(Boolean(active));
    query += ` AND dns.is_active = $${params.length}`;
  }
  if (documentType) {
    params.push(documentType);
    query += ` AND dns.document_type = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (dns.code ILIKE $${params.length} OR dns.name ILIKE $${params.length} OR dns.document_type ILIKE $${params.length})`;
  }
  params.push(limit, offset);
  query += ` ORDER BY dns.document_type, dns.code LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getDocumentNumberSeriesById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${SERIES_COLUMNS}
     FROM shared.document_number_series dns
     WHERE dns.installation_id = $1 AND dns.id = $2${forUpdate ? ' FOR UPDATE OF dns' : ''}`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getDocumentNumberSeriesByCode(client, { installationId, code, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${SERIES_COLUMNS}
     FROM shared.document_number_series dns
     WHERE dns.installation_id = $1 AND dns.code = $2${forUpdate ? ' FOR UPDATE OF dns' : ''}`,
    [installationId, code],
  );
  return result.rows[0] ?? null;
}

export async function insertDocumentNumberSeries(client, data) {
  const id = randomUUID();
  const now = nowMilliseconds();
  const result = await client.query(
    `INSERT INTO shared.document_number_series
      (id, installation_id, code, document_type, name, prefix, number_template,
       reset_policy, sequence_width, start_counter, timezone_name, description,
       is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$15)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [id, data.installationId, data.code, data.documentType, data.name, data.prefix,
      data.numberTemplate, data.resetPolicy, data.sequenceWidth, data.startCounter,
      data.timezoneName, data.description, data.isActive, now, data.createdBy],
  );
  return result.rows[0]
    ? getDocumentNumberSeriesById(client, { installationId: data.installationId, id })
    : null;
}

export async function updateDocumentNumberSeries(client, data) {
  const result = await client.query(
    `UPDATE shared.document_number_series
     SET name = $1, prefix = $2, number_template = $3, reset_policy = $4,
         sequence_width = $5, start_counter = $6, timezone_name = $7,
         description = $8, is_active = $9,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $10
     WHERE installation_id = $11 AND id = $12
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $13::timestamptz)
     RETURNING id`,
    [data.name, data.prefix, data.numberTemplate, data.resetPolicy, data.sequenceWidth,
      data.startCounter, data.timezoneName, data.description, data.isActive,
      data.updatedBy, data.installationId, data.id, data.expectedUpdatedAt],
  );
  return result.rows[0]
    ? getDocumentNumberSeriesById(client, { installationId: data.installationId, id: data.id })
    : null;
}

export async function listDocumentNumberAllocations(client, {
  installationId,
  seriesId,
  periodKey,
  limit = 200,
  offset = 0,
}) {
  const params = [installationId, seriesId];
  let query = `SELECT ${ALLOCATION_COLUMNS}
    FROM shared.document_number_allocations dna
    JOIN shared.document_number_series dns
      ON dns.installation_id = dna.installation_id AND dns.id = dna.series_id
    WHERE dna.installation_id = $1 AND dna.series_id = $2`;
  if (periodKey) {
    params.push(periodKey);
    query += ` AND dna.period_key = $${params.length}`;
  }
  params.push(limit, offset);
  query += ` ORDER BY dna.document_date DESC, dna.allocated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getAllocationByIdempotencyKey(client, { installationId, seriesId, idempotencyKey }) {
  const result = await client.query(
    `SELECT ${ALLOCATION_COLUMNS}
     FROM shared.document_number_allocations dna
     JOIN shared.document_number_series dns
       ON dns.installation_id = dna.installation_id AND dns.id = dna.series_id
     WHERE dna.installation_id = $1 AND dna.series_id = $2 AND dna.idempotency_key = $3`,
    [installationId, seriesId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function ensureAndLockCounter(client, { installationId, seriesId, periodKey, startCounter }) {
  await client.query(
    `INSERT INTO shared.document_number_counters
      (installation_id, series_id, period_key, next_counter, created_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (installation_id, series_id, period_key) DO NOTHING`,
    [installationId, seriesId, periodKey, startCounter],
  );
  const result = await client.query(
    `SELECT installation_id, series_id, period_key, next_counter, created_at, updated_at
     FROM shared.document_number_counters
     WHERE installation_id = $1 AND series_id = $2 AND period_key = $3
     FOR UPDATE`,
    [installationId, seriesId, periodKey],
  );
  const counter = result.rows[0] ?? null;
  if (!counter) return null;

  const history = await client.query(
    `SELECT max(counter_value) AS max_counter
     FROM shared.document_number_allocations
     WHERE installation_id = $1 AND series_id = $2 AND period_key = $3`,
    [installationId, seriesId, periodKey],
  );
  const maxCounter = history.rows[0]?.max_counter;
  if (maxCounter === null || maxCounter === undefined) return counter;

  const allocatedMax = BigInt(String(maxCounter));
  const historyNextCounter = allocatedMax >= MAX_COUNTER ? MAX_COUNTER : allocatedMax + 1n;
  if (historyNextCounter <= BigInt(String(counter.next_counter))) return counter;

  return updateCounter(client, {
    installationId,
    seriesId,
    periodKey,
    nextCounter: historyNextCounter.toString(),
  });
}

export async function updateCounter(client, { installationId, seriesId, periodKey, nextCounter }) {
  const result = await client.query(
    `UPDATE shared.document_number_counters
     SET next_counter = $1, updated_at = clock_timestamp()
     WHERE installation_id = $2 AND series_id = $3 AND period_key = $4
     RETURNING installation_id, series_id, period_key, next_counter, created_at, updated_at`,
    [nextCounter, installationId, seriesId, periodKey],
  );
  return result.rows[0] ?? null;
}

export async function insertAllocation(client, data) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.document_number_allocations
      (id, installation_id, series_id, idempotency_key, document_date, period_key,
       counter_value, document_number, allocated_at, actor_id, request_id, source_app, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [id, data.installationId, data.seriesId, data.idempotencyKey, data.documentDate,
      data.periodKey, data.counterValue, data.documentNumber, data.actorId,
      data.requestId, data.sourceApp, data.metadata ?? {}],
  );
  if (!result.rows[0]) throw allocationConflictError();
  const allocation = await client.query(
    `SELECT ${ALLOCATION_COLUMNS}
     FROM shared.document_number_allocations dna
     JOIN shared.document_number_series dns
       ON dns.installation_id = dna.installation_id AND dns.id = dna.series_id
     WHERE dna.installation_id = $1 AND dna.id = $2`,
    [data.installationId, id],
  );
  return allocation.rows[0] ?? null;
}

export async function listCounters(client, { installationId, seriesId }) {
  return (await client.query(
    `SELECT installation_id, series_id, period_key, next_counter, created_at, updated_at
     FROM shared.document_number_counters
     WHERE installation_id = $1 AND series_id = $2
     ORDER BY period_key DESC`,
    [installationId, seriesId],
  )).rows;
}
