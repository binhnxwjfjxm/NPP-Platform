import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, getSanitizedConfig } from '../src/config.js';

test('loadConfig returns expected defaults', () => {
  const config = loadConfig();
  assert.equal(config.port, 3004);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.databaseSslMode, 'disable');
});

test('getSanitizedConfig omits secrets', () => {
  const config = loadConfig();
  const sanitized = getSanitizedConfig(config);
  assert.equal(sanitized.databaseSslMode, 'disable');
  assert.ok(!('databaseUrl' in sanitized));
  assert.ok(!('backendApiToken' in sanitized));
});
