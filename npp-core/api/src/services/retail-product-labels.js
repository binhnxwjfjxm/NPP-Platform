const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VARIANTS = 100;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function normalizeVariantIds(payload) {
  if (!Array.isArray(payload?.variantIds)) return null;
  const ids = [...new Set(payload.variantIds.map((value) => String(value ?? '').trim()))];
  if (ids.length < 1 || ids.length > MAX_VARIANTS || ids.some((id) => !UUID_PATTERN.test(id))) return null;
  return ids;
}

export async function getRetailProductLabels(client, {
  requestContext,
  payload,
}) {
  const variantIds = normalizeVariantIds(payload);
  if (!variantIds) {
    return failure(
      'INVALID_VARIANT_IDS',
      `Danh sách sản phẩm phải có từ 1 đến ${MAX_VARIANTS} mã hợp lệ`,
    );
  }

  const result = await client.query(
    `SELECT variant.id AS variant_id,
            variant.sku,
            variant.name AS variant_name,
            product.code AS product_code,
            product.name AS product_name,
            unit.code AS unit_code
       FROM shared.product_variants variant
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
       LEFT JOIN shared.units_of_measure unit
         ON unit.installation_id = variant.installation_id
        AND unit.id = variant.unit_id
      WHERE variant.installation_id = $1
        AND variant.id = ANY($2::uuid[])`,
    [requestContext.installationId, variantIds],
  );

  const byVariantId = new Map((result.rows ?? []).map((row) => [String(row.variant_id), row]));
  const labels = variantIds.flatMap((variantId) => {
    const row = byVariantId.get(variantId);
    if (!row) return [];
    return [Object.freeze({
      variantId,
      sku: row.sku,
      variantName: row.variant_name ?? null,
      productCode: row.product_code,
      productName: row.product_name,
      unitCode: row.unit_code ?? null,
    })];
  });

  return Object.freeze({ ok: true, labels: Object.freeze(labels) });
}

export const retailProductLabelsInternals = Object.freeze({
  normalizeVariantIds,
  MAX_VARIANTS,
});
