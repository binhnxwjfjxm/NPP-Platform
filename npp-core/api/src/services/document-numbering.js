import * as repository from '../db/repositories/document-numbering.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const DOCUMENT_TYPE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const PREFIX_PATTERN = /^[A-Z0-9_/-]{0,32}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_LITERAL_PATTERN = /^[A-Z0-9._/-]*$/;
const SUPPORTED_TOKENS = new Set(['{PREFIX}', '{YYYY}', '{YY}', '{MM}', '{SEQ}']);
const RESET_POLICIES = new Set(['NONE', 'YEARLY', 'MONTHLY']);
const MAX_COUNTER = 999999999999999999n;

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function cleanText(value, maxLength, { required = false } = {}) {
  if (value === null || value === undefined) return required ? null : null;
  const normalized = String(value).trim();
  if (required && !normalized) return null;
  if (normalized.length > maxLength) return null;
  return normalized || null;
}

function normalizeCode(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeDocumentType(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return DOCUMENT_TYPE_PATTERN.test(normalized) ? normalized : null;
}

function normalizePrefix(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return PREFIX_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTemplate(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized.length < 5 || normalized.length > 128) return null;
  const tokens = normalized.match(/\{[^{}]+\}/g) ?? [];
  if (tokens.filter((token) => token === '{SEQ}').length !== 1) return null;
  if (tokens.some((token) => !SUPPORTED_TOKENS.has(token))) return null;
  const unmatchedBraces = normalized.replace(/\{(?:PREFIX|YYYY|YY|MM|SEQ)\}/g, '');
  if (unmatchedBraces.includes('{') || unmatchedBraces.includes('}')) return null;
  if (!SAFE_LITERAL_PATTERN.test(unmatchedBraces)) return null;
  return normalized;
}

function normalizeResetPolicy(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return RESET_POLICIES.has(normalized) ? normalized : null;
}

function normalizeInteger(value, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizeCounter(value) {
  try {
    const parsed = BigInt(String(value));
    return parsed >= 1n && parsed <= MAX_COUNTER ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeTimezone(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return null;
  }
}

function normalizeBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return Boolean(value);
}

function parseDocumentDate(value) {
  const normalized = String(value ?? '').trim();
  const match = DATE_PATTERN.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Object.freeze({ value: normalized, year: match[1], month: match[2], day: match[3] });
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length <= 16000 ? value : null;
  } catch {
    return null;
  }
}

function periodKeyFor(resetPolicy, date) {
  if (resetPolicy === 'NONE') return 'ALL';
  if (resetPolicy === 'YEARLY') return date.year;
  return `${date.year}-${date.month}`;
}

function renderNumber(series, date, counterValue) {
  const counter = BigInt(String(counterValue));
  const sequence = counter.toString();
  const width = Number(series.sequence_width);
  if (sequence.length > width) return failure('SEQUENCE_OVERFLOW', 'Counter no longer fits the configured sequence width');
  const rendered = String(series.number_template)
    .replaceAll('{PREFIX}', String(series.prefix))
    .replaceAll('{YYYY}', date.year)
    .replaceAll('{YY}', date.year.slice(-2))
    .replaceAll('{MM}', date.month)
    .replaceAll('{SEQ}', sequence.padStart(width, '0'));
  if (!rendered || rendered.length > 160) return failure('RENDERED_NUMBER_INVALID', 'Rendered document number is invalid');
  return Object.freeze({ ok: true, documentNumber: rendered });
}

function validateSeriesPayload(payload, existing = null) {
  const code = existing?.code ?? normalizeCode(payload.code);
  const documentType = existing?.document_type ?? normalizeDocumentType(payload.documentType);
  const name = cleanText(payload.name ?? existing?.name, 256, { required: true });
  const prefix = normalizePrefix(payload.prefix ?? existing?.prefix ?? '');
  const numberTemplate = normalizeTemplate(payload.numberTemplate ?? existing?.number_template ?? '{PREFIX}{YYYY}{MM}-{SEQ}');
  const resetPolicy = normalizeResetPolicy(payload.resetPolicy ?? existing?.reset_policy ?? 'YEARLY');
  const sequenceWidth = normalizeInteger(payload.sequenceWidth ?? existing?.sequence_width ?? 6, 1, 18);
  const startCounter = normalizeCounter(payload.startCounter ?? existing?.start_counter ?? 1);
  const timezoneName = normalizeTimezone(payload.timezoneName ?? existing?.timezone_name ?? 'Asia/Ho_Chi_Minh');
  const description = cleanText(payload.description ?? existing?.description, 2000);
  const isActive = normalizeBoolean(payload.isActive, existing?.is_active ?? true);
  if (!code) return failure('INVALID_CODE', 'Series code is invalid');
  if (!documentType) return failure('INVALID_DOCUMENT_TYPE', 'Document type is invalid');
  if (!name) return failure('INVALID_NAME', 'Series name is required');
  if (prefix === null) return failure('INVALID_PREFIX', 'Prefix is invalid');
  if (!numberTemplate) return failure('INVALID_TEMPLATE', 'Number template is invalid');
  if (!resetPolicy) return failure('INVALID_RESET_POLICY', 'Reset policy is invalid');
  if (sequenceWidth === null) return failure('INVALID_SEQUENCE_WIDTH', 'Sequence width must be between 1 and 18');
  if (!startCounter) return failure('INVALID_START_COUNTER', 'Start counter is invalid');
  if (!timezoneName) return failure('INVALID_TIMEZONE', 'Timezone name is invalid');
  return Object.freeze({
    ok: true,
    value: Object.freeze({ code, documentType, name, prefix, numberTemplate, resetPolicy,
      sequenceWidth, startCounter, timezoneName, description, isActive }),
  });
}

function formatChanged(existing, next) {
  return existing.prefix !== next.prefix
    || existing.number_template !== next.numberTemplate
    || existing.reset_policy !== next.resetPolicy
    || Number(existing.sequence_width) !== next.sequenceWidth
    || String(existing.start_counter) !== String(next.startCounter)
    || existing.timezone_name !== next.timezoneName;
}

export async function listDocumentNumberSeries(client, input) {
  const documentType = input.documentType ? normalizeDocumentType(input.documentType) : undefined;
  if (input.documentType && !documentType) return failure('INVALID_DOCUMENT_TYPE', 'Document type is invalid');
  const series = await repository.listDocumentNumberSeries(client, { ...input, documentType });
  return Object.freeze({ ok: true, series });
}

export async function getDocumentNumberSeries(client, { installationId, id }) {
  const series = await repository.getDocumentNumberSeriesById(client, { installationId, id });
  return series ? Object.freeze({ ok: true, series }) : failure('NOT_FOUND', 'Document number series not found');
}

export async function createDocumentNumberSeries(client, { installationId, payload, createdBy }) {
  const validation = validateSeriesPayload(payload ?? {});
  if (!validation.ok) return validation;
  const series = await repository.insertDocumentNumberSeries(client, {
    installationId,
    ...validation.value,
    createdBy,
  });
  if (series) return Object.freeze({ ok: true, series });
  const duplicate = await repository.getDocumentNumberSeriesByCode(client, { installationId, code: validation.value.code });
  return duplicate ? failure('DUPLICATE_CODE', 'Series code already exists') : failure('CONFLICT', 'Series could not be created', true);
}

export async function updateDocumentNumberSeries(client, { installationId, id, payload, updatedBy }) {
  const expectedUpdatedAt = cleanText(payload?.expectedUpdatedAt, 64, { required: true });
  if (!expectedUpdatedAt) return failure('EXPECTED_UPDATED_AT_REQUIRED', 'expectedUpdatedAt is required');
  const existing = await repository.getDocumentNumberSeriesById(client, { installationId, id, forUpdate: true });
  if (!existing) return failure('NOT_FOUND', 'Document number series not found');
  if (payload.code !== undefined && normalizeCode(payload.code) !== existing.code) return failure('IMMUTABLE_IDENTITY', 'Series code is immutable');
  if (payload.documentType !== undefined && normalizeDocumentType(payload.documentType) !== existing.document_type) return failure('IMMUTABLE_IDENTITY', 'Document type is immutable');
  const validation = validateSeriesPayload(payload ?? {}, existing);
  if (!validation.ok) return validation;
  if (existing.format_locked && formatChanged(existing, validation.value)) {
    return failure('FORMAT_LOCKED', 'Series format is locked after the first allocation; create a new series instead');
  }
  const series = await repository.updateDocumentNumberSeries(client, {
    installationId,
    id,
    ...validation.value,
    expectedUpdatedAt,
    updatedBy,
  });
  if (!series) return failure('CONFLICT', 'Series was changed by another request', true);
  return Object.freeze({ ok: true, series, beforeData: existing, action: 'update' });
}

export async function listDocumentNumberAllocations(client, input) {
  const series = await repository.getDocumentNumberSeriesById(client, { installationId: input.installationId, id: input.seriesId });
  if (!series) return failure('NOT_FOUND', 'Document number series not found');
  const allocations = await repository.listDocumentNumberAllocations(client, input);
  const counters = await repository.listCounters(client, { installationId: input.installationId, seriesId: input.seriesId });
  return Object.freeze({ ok: true, allocations, counters });
}

export async function allocateDocumentNumber(client, {
  installationId,
  seriesId,
  idempotencyKey,
  payload,
  actorId,
  requestId,
  sourceApp,
}) {
  const documentDate = parseDocumentDate(payload?.documentDate);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');
  const metadata = normalizeMetadata(payload?.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');

  const initialReplay = await repository.getAllocationByIdempotencyKey(client, { installationId, seriesId, idempotencyKey });
  if (initialReplay) return Object.freeze({ ok: true, allocation: initialReplay, replayed: true });

  const series = await repository.getDocumentNumberSeriesById(client, { installationId, id: seriesId, forUpdate: true });
  if (!series) return failure('NOT_FOUND', 'Document number series not found');
  const replay = await repository.getAllocationByIdempotencyKey(client, { installationId, seriesId, idempotencyKey });
  if (replay) return Object.freeze({ ok: true, allocation: replay, replayed: true });
  if (!series.is_active) return failure('SERIES_INACTIVE', 'Inactive series cannot allocate document numbers');

  const periodKey = periodKeyFor(series.reset_policy, documentDate);
  const counter = await repository.ensureAndLockCounter(client, {
    installationId,
    seriesId,
    periodKey,
    startCounter: String(series.start_counter),
  });
  if (!counter) return failure('COUNTER_UNAVAILABLE', 'Series counter is unavailable', true);

  const currentCounter = BigInt(String(counter.next_counter));
  const rendered = renderNumber(series, documentDate, currentCounter);
  if (!rendered.ok) return rendered;
  if (currentCounter >= MAX_COUNTER) return failure('SEQUENCE_OVERFLOW', 'Counter reached the maximum supported value');

  let allocation;
  try {
    allocation = await repository.insertAllocation(client, {
      installationId,
      seriesId,
      idempotencyKey,
      documentDate: documentDate.value,
      periodKey,
      counterValue: currentCounter.toString(),
      documentNumber: rendered.documentNumber,
      actorId,
      requestId,
      sourceApp,
      metadata,
    });
  } catch (error) {
    if (error?.code === '23505') {
      const concurrentReplay = await repository.getAllocationByIdempotencyKey(client, { installationId, seriesId, idempotencyKey });
      if (concurrentReplay) return Object.freeze({ ok: true, allocation: concurrentReplay, replayed: true });
      return failure('DOCUMENT_NUMBER_CONFLICT', 'Rendered document number conflicts with an existing allocation');
    }
    throw error;
  }
  if (!allocation) return failure('ALLOCATION_FAILED', 'Document number could not be allocated', true);
  await repository.updateCounter(client, {
    installationId,
    seriesId,
    periodKey,
    nextCounter: (currentCounter + 1n).toString(),
  });
  return Object.freeze({ ok: true, allocation, replayed: false });
}

export const documentNumberingInternals = Object.freeze({
  parseDocumentDate,
  periodKeyFor,
  renderNumber,
  normalizeTemplate,
});
