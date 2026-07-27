import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

function databaseUrl() {
  return process.env.TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || 'postgresql://user:password@127.0.0.1:5432/npp_platform';
}

function insertSeries(client, overrides = {}) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const values = {
    id: randomUUID(),
    installationId: `numbering-constraint-${suffix}`,
    code: `SO-${suffix}`,
    documentType: 'SALES_ORDER',
    name: `Đơn bán ${suffix}`,
    prefix: 'SO-',
    numberTemplate: '{PREFIX}{YYYY}-{SEQ}',
    resetPolicy: 'YEARLY',
    sequenceWidth: 18,
    startCounter: '1',
    actorId: 'test:constraint',
    ...overrides,
  };
  return client.query(
    `INSERT INTO shared.document_number_series (
      id, installation_id, code, document_type, name, prefix, number_template,
      reset_policy, sequence_width, start_counter, created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      values.id,
      values.installationId,
      values.code,
      values.documentType,
      values.name,
      values.prefix,
      values.numberTemplate,
      values.resetPolicy,
      values.sequenceWidth,
      values.startCounter,
      values.actorId,
    ],
  );
}

test('database rejects reset policies whose templates cannot remain unique across periods', async () => {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await assert.rejects(
      insertSeries(client, {
        numberTemplate: '{PREFIX}{SEQ}',
        resetPolicy: 'YEARLY',
      }),
      /document_number_series_reset_template_check/,
    );
    await assert.rejects(
      insertSeries(client, {
        numberTemplate: '{PREFIX}{YYYY}-{SEQ}',
        resetPolicy: 'MONTHLY',
      }),
      /document_number_series_reset_template_check/,
    );
  } finally {
    await client.end();
  }
});

test('database rejects a start counter that cannot advance after allocation', async () => {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await assert.rejects(
      insertSeries(client, { startCounter: '999999999999999999' }),
      /document_number_series_start_counter_check/,
    );
  } finally {
    await client.end();
  }
});
