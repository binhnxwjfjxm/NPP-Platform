import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRehearsalEnv,
  isSafeEphemeralCiTarget,
  postgresClientMajor,
  shouldInstallPostgres17Client,
} from '../scripts/run-migration-rehearsal.js';

const safeEnv = {
  CI: 'true',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/rehearsal_npp_core',
};

test('safe ephemeral CI rehearsal target receives explicit confirmation', () => {
  assert.equal(isSafeEphemeralCiTarget(safeEnv), true);
  const result = buildRehearsalEnv(safeEnv);
  assert.equal(result.MIGRATION_REHEARSAL_CONFIRM, 'temporary-database');
});

test('provider-like or production targets never receive implicit confirmation', () => {
  for (const env of [
    { ...safeEnv, CI: 'false' },
    { ...safeEnv, NODE_ENV: 'production' },
    { ...safeEnv, DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/rehearsal_npp_core' },
    { ...safeEnv, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/production' },
  ]) {
    assert.equal(isSafeEphemeralCiTarget(env), false);
    assert.equal(buildRehearsalEnv(env).MIGRATION_REHEARSAL_CONFIRM, undefined);
    assert.equal(shouldInstallPostgres17Client(env, 'pg_dump (PostgreSQL) 16.9'), false);
  }
});

test('explicit confirmation is preserved for documented local rehearsals', () => {
  const env = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/local_rehearsal',
    MIGRATION_REHEARSAL_CONFIRM: 'temporary-database',
  };
  assert.equal(buildRehearsalEnv(env).MIGRATION_REHEARSAL_CONFIRM, 'temporary-database');
});

test('PostgreSQL client major detection is deterministic', () => {
  assert.equal(postgresClientMajor('pg_dump (PostgreSQL) 17.5'), 17);
  assert.equal(postgresClientMajor('pg_dump (PostgreSQL) 16.9 (Ubuntu 16.9-0ubuntu0.24.04.1)'), 16);
  assert.equal(postgresClientMajor('not available'), null);
});

test('only the whitelisted CI rehearsal target may install PostgreSQL client 17', () => {
  assert.equal(shouldInstallPostgres17Client(safeEnv, 'pg_dump (PostgreSQL) 16.9'), true);
  assert.equal(shouldInstallPostgres17Client(safeEnv, 'pg_dump (PostgreSQL) 17.5'), false);
  assert.equal(shouldInstallPostgres17Client({ ...safeEnv, CI: 'false' }, 'pg_dump (PostgreSQL) 16.9'), false);
});
