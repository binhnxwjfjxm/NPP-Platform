const VIETNAMESE_SEARCH_CHARACTERS = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const ASCII_SEARCH_CHARACTERS = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

const SKU_OPTION_COLUMNS = `pv.id, pv.product_id, pv.sku, pv.name,
  pv.is_active AS variant_is_active, pv.is_sellable,
  pv.unit_id, pv.conversion_to_base,
  p.code AS product_code, p.name AS product_name,
  p.is_active AS product_is_active, p.is_orderable AS product_is_orderable,
  u.code AS unit_code, u.name AS unit_name,
  u.allows_fractional, u.is_active AS unit_is_active,
  primary_barcode.barcode`;

function normalizedSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedSql(expression) {
  return `translate(lower(${expression}), '${VIETNAMESE_SEARCH_CHARACTERS}', '${ASCII_SEARCH_CHARACTERS}')`;
}

function poolSnapshot(client) {
  const count = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
  return {
    poolTotal: count(client?.totalCount),
    poolIdle: count(client?.idleCount),
    poolWaiting: count(client?.waitingCount),
  };
}

export async function searchSalesOrderSkuOptions(client, {
  installationId,
  search,
  categoryId = null,
  limit = 20,
  offset = 0,
}) {
  const term = String(search ?? '').trim();
  const normalizedExact = term.toUpperCase();
  const normalizedSearch = normalizedSearchText(term);
  const searchTokens = normalizedSearch ? normalizedSearch.split(' ').filter(Boolean) : [];
  const params = [installationId, normalizedExact, normalizedSearch, categoryId];
  const tokenClauses = searchTokens.map((token) => {
    params.push(`%${token}%`);
    const patternIndex = params.length;
    return `(
         ${normalizedSql('pv.sku')} LIKE $${patternIndex}
         OR ${normalizedSql('pv.name')} LIKE $${patternIndex}
         OR ${normalizedSql('p.code')} LIKE $${patternIndex}
         OR ${normalizedSql('p.name')} LIKE $${patternIndex}
         OR EXISTS (
           SELECT 1
           FROM shared.product_barcodes matching_barcode
           WHERE matching_barcode.installation_id = pv.installation_id
             AND matching_barcode.variant_id = pv.id
             AND matching_barcode.is_active = true
             AND lower(matching_barcode.normalized_barcode) LIKE $${patternIndex}
         )
       )`;
  });
  params.push(limit, offset);
  const limitIndex = params.length - 1;
  const offsetIndex = params.length;
  const startedAt = Date.now();
  const result = await client.query(
    `SELECT ${SKU_OPTION_COLUMNS}
     FROM shared.product_variants pv
     JOIN shared.products p
       ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     LEFT JOIN shared.units_of_measure u
       ON u.installation_id = pv.installation_id AND u.id = pv.unit_id
     LEFT JOIN LATERAL (
       SELECT pb.barcode
       FROM shared.product_barcodes pb
       WHERE pb.installation_id = pv.installation_id
         AND pb.variant_id = pv.id
         AND pb.is_active = true
       ORDER BY pb.is_primary DESC, pb.created_at ASC, pb.id ASC
       LIMIT 1
     ) primary_barcode ON true
     WHERE pv.installation_id = $1
       AND p.is_active = true
       AND p.is_orderable = true
       AND pv.is_active = true
       AND pv.is_sellable = true
       AND pv.unit_id IS NOT NULL
       AND u.is_active = true
       AND pv.conversion_to_base IS NOT NULL
       AND pv.conversion_to_base > 0
       AND ($4::uuid IS NULL OR p.category_id = $4::uuid)
       AND (${tokenClauses.length > 0 ? tokenClauses.join('\n       AND ') : 'true'})
     ORDER BY
       CASE
         WHEN upper(pv.sku) = $2 THEN 0
         WHEN upper(p.code) = $2 THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM shared.product_barcodes exact_barcode
           WHERE exact_barcode.installation_id = pv.installation_id
             AND exact_barcode.variant_id = pv.id
             AND exact_barcode.is_active = true
             AND exact_barcode.normalized_barcode = $2
         ) THEN 2
         WHEN $3 <> '' AND ${normalizedSql('p.name')} = $3 THEN 3
         WHEN $3 <> '' AND ${normalizedSql('pv.name')} = $3 THEN 4
         WHEN $3 <> '' AND ${normalizedSql('p.name')} LIKE $3 || '%' THEN 5
         WHEN $3 <> '' AND ${normalizedSql('pv.name')} LIKE $3 || '%' THEN 6
         ELSE 7
       END,
       p.code ASC,
       pv.sku ASC,
       pv.id ASC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );
  console.info(JSON.stringify({
    event: 'sales_order_sku_search_db',
    durationMs: Date.now() - startedAt,
    termLength: term.length,
    tokenCount: searchTokens.length,
    resultCount: result.rows.length,
    ...poolSnapshot(client),
  }));
  return result.rows;
}

export const salesOrderSkuSearchInternals = Object.freeze({
  normalizedSearchText,
  normalizedSql,
});
