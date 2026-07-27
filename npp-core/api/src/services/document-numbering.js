import * as core from './document-numbering-core.js';

function normalizeExpectedUpdatedAt(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const listDocumentNumberSeries = core.listDocumentNumberSeries;
export const getDocumentNumberSeries = core.getDocumentNumberSeries;
export const createDocumentNumberSeries = core.createDocumentNumberSeries;
export const listDocumentNumberAllocations = core.listDocumentNumberAllocations;
export const allocateDocumentNumber = core.allocateDocumentNumber;
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
