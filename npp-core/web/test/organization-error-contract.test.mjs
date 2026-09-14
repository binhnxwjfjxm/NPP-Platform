import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/organization-error-contract.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const context = { module: { exports: {} }, exports: {} };
context.exports = context.module.exports;
vm.runInNewContext(compiled, context);
const { resolveOrganizationErrorCode } = context.module.exports;

test('organization gateway promotes production stale-version conflict into the effective error code', () => {
  const productionError = {
    code: 'CONFLICT',
    message: 'Dữ liệu đã được thay đổi ở nơi khác. Bấm Làm mới rồi thực hiện lại thao tác.',
    retryable: false,
    details: {
      conflictCode: 'STALE_VERSION',
      conflictType: 'stale_version',
      reason: 'EXPECTED_UPDATED_AT_MISMATCH',
      action: 'refresh_and_retry',
      managementPath: '/organization/warehouses',
    },
  };

  assert.equal(resolveOrganizationErrorCode(productionError), 'STALE_VERSION');
});

test('organization gateway keeps unrelated conflicts generic', () => {
  assert.equal(resolveOrganizationErrorCode({
    code: 'CONFLICT',
    details: { conflictCode: 'ACTIVE_DEPENDENTS' },
  }), 'CONFLICT');
  assert.equal(resolveOrganizationErrorCode({ code: 'NOT_FOUND', details: {} }), 'NOT_FOUND');
});
