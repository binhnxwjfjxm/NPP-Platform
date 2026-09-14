const EPOCH_SQL = `'epoch'::timestamptz`;

export async function readSalesOrderLocalCatalogChanges(client, {
  installationId,
  since = null,
}) {
  const result = await client.query(
    `WITH barcode_state AS (
       SELECT
         pb.variant_id,
         max(pb.updated_at) AS barcode_updated_at,
         array_agg(pb.barcode ORDER BY pb.is_primary DESC, pb.created_at ASC, pb.id ASC)
           FILTER (WHERE pb.is_active = true) AS active_barcodes
       FROM shared.product_barcodes pb
       WHERE pb.installation_id = $1
       GROUP BY pb.variant_id
     ),
     catalog_rows AS (
       SELECT
         pv.id,
         pv.product_id,
         pv.sku,
         pv.name AS variant_name,
         pv.unit_id,
         pv.conversion_to_base,
         p.code AS product_code,
         p.name AS product_name,
         u.code AS unit_code,
         u.name AS unit_name,
         u.allows_fractional,
         COALESCE(barcode_state.active_barcodes, ARRAY[]::text[]) AS barcodes,
         GREATEST(
           pv.updated_at,
           p.updated_at,
           COALESCE(u.updated_at, ${EPOCH_SQL}),
           COALESCE(barcode_state.barcode_updated_at, ${EPOCH_SQL})
         ) AS changed_at,
         (
           p.is_active = true
           AND p.is_orderable = true
           AND pv.is_active = true
           AND pv.is_sellable = true
           AND pv.unit_id IS NOT NULL
           AND u.is_active = true
           AND pv.conversion_to_base IS NOT NULL
           AND pv.conversion_to_base > 0
         ) AS eligible
       FROM shared.product_variants pv
       JOIN shared.products p
         ON p.installation_id = pv.installation_id
        AND p.id = pv.product_id
       LEFT JOIN shared.units_of_measure u
         ON u.installation_id = pv.installation_id
        AND u.id = pv.unit_id
       LEFT JOIN barcode_state
         ON barcode_state.variant_id = pv.id
       WHERE pv.installation_id = $1
     ),
     boundary AS (
       SELECT COALESCE(max(changed_at), ${EPOCH_SQL}) AS cursor
       FROM catalog_rows
     ),
     changes AS (
       SELECT catalog_rows.*
       FROM catalog_rows
       CROSS JOIN boundary
       WHERE catalog_rows.changed_at <= boundary.cursor
         AND (
           $2::timestamptz IS NULL
           OR catalog_rows.changed_at >= $2::timestamptz - interval '1 second'
         )
         AND ($2::timestamptz IS NOT NULL OR catalog_rows.eligible = true)
     )
     SELECT
       boundary.cursor,
       COALESCE(
         jsonb_agg(to_jsonb(changes) ORDER BY changes.changed_at, changes.id)
           FILTER (WHERE changes.id IS NOT NULL),
         '[]'::jsonb
       ) AS rows
     FROM boundary
     LEFT JOIN changes ON true
     GROUP BY boundary.cursor`,
    [installationId, since],
  );
  return {
    cursor: result.rows[0]?.cursor ?? new Date(0).toISOString(),
    rows: Array.isArray(result.rows[0]?.rows) ? result.rows[0].rows : [],
  };
}
