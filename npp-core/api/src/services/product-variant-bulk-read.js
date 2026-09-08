import * as variantRepo from '../db/repositories/product-variants.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRODUCT_IDS = 500;

function invalid(code, message) {
  return { ok: false, code, message, retryable: false };
}

export async function listProductVariantsForProducts(client, { installationId, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.productIds)) {
    return invalid('INVALID_PRODUCT_VARIANT_QUERY', 'Danh sách sản phẩm cần đọc SKU không hợp lệ');
  }
  if (payload.productIds.length > MAX_PRODUCT_IDS) {
    return invalid('PRODUCT_VARIANT_QUERY_TOO_LARGE', `Mỗi lần chỉ đọc tối đa ${MAX_PRODUCT_IDS} sản phẩm`);
  }

  const productIds = [];
  const seen = new Set();
  for (const value of payload.productIds) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!UUID_PATTERN.test(id)) return invalid('INVALID_PRODUCT_ID', 'Mã sản phẩm không hợp lệ');
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    productIds.push(id);
  }

  if (!productIds.length) return { ok: true, variants: [] };
  const variants = await variantRepo.listProductVariantsForProducts(client, { installationId, productIds });
  return { ok: true, variants };
}

export const productVariantBulkReadInternals = Object.freeze({ MAX_PRODUCT_IDS });
