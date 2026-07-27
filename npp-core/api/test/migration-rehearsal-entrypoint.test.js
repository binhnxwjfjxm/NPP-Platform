import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRehearsalEnv,
  isSafeEphemeralCiTarget,
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
