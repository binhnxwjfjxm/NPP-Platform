import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_HTTP_STATUS, CORE_ROLE_GROUPS } from '../index.js';

test('exports core http status constants', () => {
  assert.equal(CORE_HTTP_STATUS.OK, 200);
  assert.equal(CORE_HTTP_STATUS.UNAUTHORIZED, 401);
});

test('exports core role groups', () => {
  assert.equal(CORE_ROLE_GROUPS.ADMIN, 'admin');
  assert.equal(CORE_ROLE_GROUPS.VIEWER, 'viewer');
});
