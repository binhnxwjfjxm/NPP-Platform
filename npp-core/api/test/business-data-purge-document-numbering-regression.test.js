import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { executeDeletionIntent } from '../src/services/business-data-purge.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3096',
    INSTALLATION_ID: 'business-purge-document-numbering-regression',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

const config = loadConfig(testEnv());
const pool = getPool(config);
after(async () => { await closePool(); });

const PURGE_OWNED_SHARED_TABLES = Object.freeze([
  'customer_groups',
  'customers',
  'customer_addresses',
  'customer_media',
  'suppliers',
  'supplier_contacts',
  'supplier_addresses',
  'supplier_payment_terms',
  'product_categories',
  'product_brands',
  'products',
  'product_variants',
  'product_barcodes',
  'price_lists',
  'price_list_items',
  'document_number_counters',
  'document_number_allocations',
]);

function context(installationId, requestId = `purge_${randomUUID()}`) {
  return {
    installationId,
    actorId: 'test:owner',
    employeeId: null,
    sourceApp: 'NPP_OPERATIONS',
    requestId,
  };
}

async function insertVerifiedBackup(installationId, actor, now) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO shared.backup_jobs (
      id, installation_id, status, requested_by, source_app, request_id,
      include_xlsx, snapshot_at, dump_object_key, dump_size, dump_sha256,
      verified_at, completed_at
    ) VALUES ($1,$2,'VERIFIED',$3,'NPP_OPERATIONS',$4,false,$5,$6,128,$7,$5,$5)`,
    [
      id,
      installationId,
      actor,
      `backup_${randomUUID()}`,
      now.toISOString(),
      `backups/${installationId}/${id}/database.dump`,
      'a'.repeat(64),
    ],
  );
  return id;
}

async function insertAuthorizedIntent({ installationId, backupJobId, actor }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO shared.data_deletion_intents (
      id, installation_id, backup_job_id, status, requested_by, source_app, request_id,
      reason, challenge_code_hash, challenge_expires_at, challenge_sent_at,
      challenge_verified_at, owner_recipient_count, authorized_at, target_code
    ) VALUES ($1,$2,$3,'AUTHORIZED',$4,'NPP_OPERATIONS',$5,$6,$7,$8,$9,$9,1,$9,'OPERATIONS_ONLY')`,
    [
      id,
      installationId,
      backupJobId,
      actor,
      `intent_${randomUUID()}`,
      'Dọn dữ liệu kiểm thử trước bàn giao',
      'b'.repeat(64),
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      now,
    ],
  );
  return id;
}

async function insertDocumentNumberFixture(installationId, actor) {
  const seriesId = randomUUID();
  const allocationId = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const seriesCode = `PURGE_${suffix}`;
  const documentNumber = `PX${suffix}`;

  await pool.query(
    `INSERT INTO shared.document_number_series (
      id, installation_id, code, document_type, name, prefix,
      number_template, reset_policy, sequence_width, start_counter,
      timezone_name, is_active, created_by, updated_by
    ) VALUES ($1,$2,$3,'SALES_ORDER',$4,'PX','{PREFIX}{YYYY}-{SEQ}','YEARLY',6,1,'Asia/Ho_Chi_Minh',true,$5,$5)`,
    [seriesId, installationId, seriesCode, `Số chứng từ ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.document_number_counters (
      installation_id, series_id, period_key, next_counter
    ) VALUES ($1,$2,'2026',2)`,
    [installationId, seriesId],
  );
  await pool.query(
    `INSERT INTO shared.document_number_allocations (
      id, installation_id, series_id, idempotency_key, document_date,
      period_key, counter_value, document_number, actor_id, request_id, source_app
    ) VALUES ($1,$2,$3,$4,CURRENT_DATE,'2026',1,$5,$6,$7,'NPP_OPERATIONS')`,
    [
      allocationId,
      installationId,
      seriesId,
      `purge-doc-${suffix}`,
      documentNumber,
      actor,
      `document_${randomUUID()}`,
    ],
  );

  return { seriesId, allocationId };
}

test('migration 106 registers the authorised purge path for document-number allocations', async () => {
  const migration = CORE_API_MIGRATIONS.find((item) => item.id === '106_business_purge_document_number_allocations');
  assert.ok(migration, 'migration 106 must be registered');
  assert.match(migration.sql, /prevent_document_number_allocation_mutation/);
  assert.match(migration.sql, /business_purge_delete_allowed/);
  assert.doesNotMatch(migration.sql, /DISABLE\s+TRIGGER|session_replication_role|TRUNCATE|DROP\s+SCHEMA/i);

  const rows = await pool.query(
    `SELECT ns.nspname AS schema_name,
            rel.relname AS table_name,
            trg.tgname AS trigger_name,
            pg_get_triggerdef(trg.oid, true) AS trigger_definition,
            pg_get_functiondef(proc.oid) AS function_definition
       FROM pg_trigger trg
       JOIN pg_class rel ON rel.oid = trg.tgrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       JOIN pg_proc proc ON proc.oid = trg.tgfoid
      WHERE NOT trg.tgisinternal
        AND (trg.tgtype & 2) = 2
        AND (trg.tgtype & 8) = 8
        AND ns.nspname = 'shared'
        AND rel.relname = ANY($1::text[])
      ORDER BY rel.relname, trg.tgname`,
    [PURGE_OWNED_SHARED_TABLES],
  );

  const unsafe = rows.rows.filter((row) => {
    const contract = `${row.trigger_definition}\n${row.function_definition}`;
    return !/business_purge_delete_allowed|guard_business_purge_delete/i.test(contract);
  });
  assert.deepEqual(
    unsafe.map((row) => `shared.${row.table_name}.${row.trigger_name}`),
    [],
    'all BEFORE DELETE guards on purge-owned shared tables must recognise the authorised purge context',
  );
});

test('OPERATIONS_ONLY purges allocated document numbers while preserving series configuration', async () => {
  const installationId = `purge-doc-${randomUUID()}`;
  const actor = 'test:owner';
  const fixedNow = new Date();
  const fixture = await insertDocumentNumberFixture(installationId, actor);

  await assert.rejects(
    pool.query(
      'DELETE FROM shared.document_number_allocations WHERE installation_id=$1 AND id=$2',
      [installationId, fixture.allocationId],
    ),
    (error) => error?.code === 'P0001' && /document_number_allocations_are_append_only/.test(String(error?.message ?? '')),
  );

  const backupJobId = await insertVerifiedBackup(installationId, actor, new Date(fixedNow.getTime() - 60_000));
  const intentId = await insertAuthorizedIntent({ installationId, backupJobId, actor });
  const result = await executeDeletionIntent(pool, {
    requestContext: context(installationId),
    intentId,
    now: () => fixedNow,
  });

  assert.equal(result.ok, true);
  assert.equal(result.intent.status, 'PURGED');
  assert.equal(result.intent.targetCode, 'OPERATIONS_ONLY');
  assert.equal(
    Number((await pool.query(
      'SELECT count(*)::int AS count FROM shared.document_number_allocations WHERE installation_id=$1 AND id=$2',
      [installationId, fixture.allocationId],
    )).rows[0].count),
    0,
  );
  assert.equal(
    Number((await pool.query(
      'SELECT count(*)::int AS count FROM shared.document_number_counters WHERE installation_id=$1 AND series_id=$2',
      [installationId, fixture.seriesId],
    )).rows[0].count),
    0,
  );
  assert.equal(
    Number((await pool.query(
      'SELECT count(*)::int AS count FROM shared.document_number_series WHERE installation_id=$1 AND id=$2',
      [installationId, fixture.seriesId],
    )).rows[0].count),
    1,
  );
});
