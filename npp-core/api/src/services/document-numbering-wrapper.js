import * as core from './document-numbering-core.js';
import * as repository from '../db/repositories/document-numbering.js';

function failure(code, message, retryable = false) {
  return Object.freeze({ ok: false, code, message, retryable });
}

function normalizeExpectedUpdatedAt(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function replayMatches(allocation, documentDate, metadata) {
  const allocatedDate = allocation?.document_date instanceof Date
    ? allocation.document_date.toISOString().slice(0, 10)
    : String(allocation?.document_date ?? '').slice(0, 10);
  return allocatedDate === documentDate
    && JSON.stringify(canonicalize(allocation?.metadata ?? {})) === JSON.stringify(canonicalize(metadata ?? {}));
}

export const listDocumentNumberSeries = core.listDocumentNumberSeries;
export const getDocumentNumberSeries = core.getDocumentNumberSeries;
export const createDocumentNumberSeries = core.createDocumentNumberSeries;
export const listDocumentNumberAllocations = core.listDocumentNumberAllocations;
export const documentNumberingInternals = core.documentNumberingInternals;

export function updateDocumentNumberSeries(client, input) {
  return core.updateDocumentNumberSeries(client, {
    ...input,
    payload: {
      ...(input.payload ?? {}),
      expectedUpdatedAt: normalizeExpectedUpdatedAt(input.payload?.expectedUpdatedAt),
    },
  });
}

export async function allocateDocumentNumber(client, input) {
  const documentDate = String(input.payload?.documentDate ?? '').trim();
  const metadata = input.payload?.metadata ?? {};
  const existing = await repository.getAllocationByIdempotencyKey(client, {
    installationId: input.installationId,
    seriesId: input.seriesId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing && !replayMatches(existing, documentDate, metadata)) {
    return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with a different allocation payload');
  }
  const result = await core.allocateDocumentNumber(client, input);
  if (result.ok && result.replayed && !replayMatches(result.allocation, documentDate, metadata)) {
    return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with a different allocation payload');
  }
  return result;
}
