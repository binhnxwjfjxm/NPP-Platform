import * as base from './product-onboarding-file.js';

export const PRODUCT_ONBOARDING_FILE_COLUMNS = Object.freeze(
  base.PRODUCT_ONBOARDING_FILE_COLUMNS.filter((column) => column !== 'locationRequired'),
);

function withoutLocationPolicy(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const { locationRequired: _deprecated, ...rest } = row;
  return Object.freeze(rest);
}

function legacyCompatiblePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) return payload;
  return Object.freeze({
    ...payload,
    rows: Object.freeze(payload.rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const { locationRequired: _ignored, ...rest } = row;
      return Object.freeze({ ...rest, locationRequired: false });
    })),
  });
}

export async function exportProductOnboardingRows(client, args) {
  const result = await base.exportProductOnboardingRows(client, args);
  if (!result?.ok) return result;
  return Object.freeze({
    ...result,
    columns: PRODUCT_ONBOARDING_FILE_COLUMNS,
    rows: Object.freeze((result.rows ?? []).map(withoutLocationPolicy)),
  });
}

export function normalizeProductOnboardingRows(payload) {
  return base.normalizeProductOnboardingRows(legacyCompatiblePayload(payload));
}

export async function importProductOnboardingRows(client, args) {
  return base.importProductOnboardingRows(client, {
    ...args,
    payload: legacyCompatiblePayload(args?.payload),
  });
}
