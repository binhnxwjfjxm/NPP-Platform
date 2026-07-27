import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocumentNumberSeries,
  documentNumberingInternals,
} from '../src/services/document-numbering.js';

function basePayload(overrides = {}) {
  return {
    code: 'SO-VALIDATION',
    documentType: 'SALES_ORDER',
    name: 'Đơn bán kiểm thử',
    prefix: 'SO-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    isActive: true,
    ...overrides,
  };
}

test('yearly reset requires a year token', async () => {
  const result = await createDocumentNumberSeries(null, {
    installationId: 'validation',
    payload: basePayload({ resetPolicy: 'YEARLY', numberTemplate: '{PREFIX}{SEQ}' }),
    createdBy: 'test:user',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RESET_TEMPLATE_MISMATCH');
});

test('monthly reset requires both year and month tokens', async () => {
  const missingMonth = await createDocumentNumberSeries(null, {
    installationId: 'validation',
    payload: basePayload({ resetPolicy: 'MONTHLY', numberTemplate: '{PREFIX}{YYYY}-{SEQ}' }),
    createdBy: 'test:user',
  });
  assert.equal(missingMonth.ok, false);
  assert.equal(missingMonth.code, 'RESET_TEMPLATE_MISMATCH');

  const missingYear = await createDocumentNumberSeries(null, {
    installationId: 'validation',
    payload: basePayload({ resetPolicy: 'MONTHLY', numberTemplate: '{PREFIX}{MM}-{SEQ}' }),
    createdBy: 'test:user',
  });
  assert.equal(missingYear.ok, false);
  assert.equal(missingYear.code, 'RESET_TEMPLATE_MISMATCH');
});

test('non-reset series may omit date tokens', () => {
  const result = documentNumberingInternals.validatePublicPayload(
    basePayload({ resetPolicy: 'NONE', numberTemplate: '{PREFIX}{SEQ}' }),
  );
  assert.equal(result, null);
});

test('isActive accepts booleans only', async () => {
  const result = await createDocumentNumberSeries(null, {
    installationId: 'validation',
    payload: basePayload({ isActive: 'false' }),
    createdBy: 'test:user',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_IS_ACTIVE');
});

test('start counter must leave room for the next counter value', async () => {
  const result = await createDocumentNumberSeries(null, {
    installationId: 'validation',
    payload: basePayload({
      sequenceWidth: 18,
      startCounter: '999999999999999999',
    }),
    createdBy: 'test:user',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_START_COUNTER');
});
