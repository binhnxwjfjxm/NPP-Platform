import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpawnEnv, cryptoHash } from '../scripts/rehearse-migrations.js';

test('buildSpawnEnv removes credentials and returns a clean URL', () => {
  const { env, cleanUrl } = buildSpawnEnv('postgresql://user:secret@localhost:5432/testdb');

  assert.equal(env.PGUSER, 'user');
  assert.equal(env.PGPASSWORD, 'secret');
  assert.equal(env.PGHOST, 'localhost');
  assert.equal(env.PGPORT, '5432');
  assert.equal(env.PGDATABASE, 'testdb');
  assert.equal(cleanUrl, 'postgresql://localhost:5432/testdb');
});

test('cryptoHash is stable and distinguishes different values', () => {
  const first = cryptoHash('hello');
  const second = cryptoHash('hello');
  const third = cryptoHash('world');

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.match(first, /^[0-9a-f]{64}$/);
});
