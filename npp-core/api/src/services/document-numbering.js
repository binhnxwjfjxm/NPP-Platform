import * as core from './document-numbering-core.js';

const MAX_ALLOCATABLE_COUNTER = 999999999999999998n;

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function normalizeExpectedUpdatedAt(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeResetPolicy(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['NONE', 'YEARLY', 'MONTHLY'].includes(normalized) ? normalized : null;
}

function normalizeTemplate(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
}

function validateResetTemplate(resetPolicy, numberTemplate) {
  if (!resetPolicy || !numberTemplate) return null;
  const hasYear = numberTemplate.includes('{YYYY}') || numberTemplate.includes('{YY}');
  const hasMonth = numberTemplate.includes('{MM}');
  if (resetPolicy === 'YEARLY' && !hasYear) {
    return failure('RESET_TEMPLATE_MISMATCH', 'Yearly reset requires {YYYY} or {YY} in the number template');
  }
  if (resetPolicy === 'MONTHLY' && (!hasYear || !hasMonth)) {
    return failure('RESET_TEMPLATE_MISMATCH', 'Monthly reset requires a year token and {MM} in the number template');
  }
  return null;
}

function validateBooleanField(payload, fieldName) {
  if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) return null;
  return typeof payload[fieldName] === 'boolean'
    ? null
    : failure('INVALID_IS_ACTIVE', 'isActive must be a boolean');
}

function validateStartCounter(value) {
  if (value === undefined || value === null) return null;
  try {
    const parsed = BigInt(String(value));
    if (parsed < 1n || parsed > MAX_ALLOCATABLE_COUNTER) {
      return failure('INVALID_START_COUNTER', 'Start counter must leave room for the next counter value');
    }
    return null;
  } catch {
    return failure('INVALID_START_COUNTER', 'Start counter is invalid');
  }
}

function validatePublicPayload(payload, existing = null) {
  const normalizedPayload = payload ?? {};
  const booleanError = validateBooleanField(normalizedPayload, 'isActive');
  if (booleanError) return booleanError;

  const counterError = validateStartCounter(
    Object.prototype.hasOwnProperty.call(normalizedPayload, 'startCounter')
      ? normalizedPayload.startCounter
      : existing?.start_counter,
  );
  if (counterError) return counterError;

  const resetPolicy = normalizeResetPolicy(
    Object.prototype.hasOwnProperty.call(normalizedPayload, 'resetPolicy')
      ? normalizedPayload.resetPolicy
      : existing?.reset_policy ?? 'YEARLY',
  );
  const numberTemplate = normalizeTemplate(
    Object.prototype.hasOwnProperty.call(normalizedPayload, 'numberTemplate')
      ? normalizedPayload.numberTemplate
      : existing?.number_template ?? '{PREFIX}{YYYY}{MM}-{SEQ}',
  );
  return validateResetTemplate(resetPolicy, numberTemplate);
}

export const listDocumentNumberSeries = core.listDocumentNumberSeries;
export const getDocumentNumberSeries = core.getDocumentNumberSeries;
export const listDocumentNumberAllocations = core.listDocumentNumberAllocations;
export const allocateDocumentNumber = core.allocateDocumentNumber;
export const documentNumberingInternals = Object.freeze({
  ...core.documentNumberingInternals,
  validateResetTemplate,
  validatePublicPayload,
});

export function createDocumentNumberSeries(client, input) {
  const validation = validatePublicPayload(input.payload);
  if (validation) return Promise.resolve(validation);
  return core.createDocumentNumberSeries(client, input);
}

export async function updateDocumentNumberSeries(client, input) {
  const existing = await core.getDocumentNumberSeries(client, {
    installationId: input.installationId,
    id: input.id,
  });
  if (!existing.ok) return existing;

  const payload = {
    ...(input.payload ?? {}),
    expectedUpdatedAt: normalizeExpectedUpdatedAt(input.payload?.expectedUpdatedAt),
  };
  const validation = validatePublicPayload(payload, existing.series);
  if (validation) return validation;

  return core.updateDocumentNumberSeries(client, {
    ...input,
    payload,
  });
}
