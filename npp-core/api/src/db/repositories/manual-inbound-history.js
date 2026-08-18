export async function searchManualInboundDocuments(client, {
  installationId,
  warehouseIds,
  inboundType = null,
  referenceNumber = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT document.id,
            document.inbound_type,
            document.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            to_char(document.document_date, 'YYYY-MM-DD') AS document_date,
            document.reference_number,
            document.note,
            document.created_at,
            reversal.id AS reversal_movement_id,
            to_char(reversal.document_date, 'YYYY-MM-DD') AS reversal_document_date,
            reversal.reason_note AS reversal_reason_note
       FROM inventory.manual_inbound_documents document
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
       LEFT JOIN inventory.inventory_movements reversal
         ON reversal.installation_id = document.installation_id
        AND reversal.reversal_of_movement_id = document.movement_id
      WHERE document.installation_id = $1
        AND document.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR document.inbound_type = $3)
        AND ($4::text IS NULL OR document.reference_number ILIKE '%' || $4 || '%')
      ORDER BY document.document_date DESC, document.created_at DESC, document.id DESC
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, inboundType, referenceNumber, limit, offset],
  );
  return result.rows ?? [];
}

export async function getManualInboundHistoryDetail(client, {
  installationId,
  warehouseIds,
  documentId,
}) {
  const result = await client.query(
    `WITH target_document AS (
       SELECT document.id,
              document.warehouse_id,
              warehouse.code AS warehouse_code,
              warehouse.name AS warehouse_name,
              document.document_date,
              document.reference_number,
              document.movement_id,
              movement.posted_at
         FROM inventory.manual_inbound_documents document
         JOIN shared.warehouses warehouse
           ON warehouse.installation_id = document.installation_id
          AND warehouse.id = document.warehouse_id
         JOIN inventory.inventory_movements movement
           ON movement.installation_id = document.installation_id
          AND movement.id = document.movement_id
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND document.id = $3
     ), target_lines AS (
       SELECT line.base_variant_id,
              SUM(line.base_quantity_delta) AS quantity_delta
         FROM target_document target
         JOIN inventory.inventory_movement_lines line
           ON line.installation_id = $1
          AND line.movement_id = target.movement_id
          AND line.warehouse_id = target.warehouse_id
        GROUP BY line.base_variant_id
     ), prior_quantities AS (
       SELECT prior_line.base_variant_id,
              SUM(prior_line.base_quantity_delta) AS quantity_before
         FROM target_document target
         JOIN inventory.inventory_movements prior_movement
           ON prior_movement.installation_id = $1
          AND (
            prior_movement.posted_at < target.posted_at
            OR (prior_movement.posted_at = target.posted_at AND prior_movement.id < target.movement_id)
          )
         JOIN inventory.inventory_movement_lines prior_line
           ON prior_line.installation_id = prior_movement.installation_id
          AND prior_line.movement_id = prior_movement.id
          AND prior_line.warehouse_id = target.warehouse_id
         JOIN target_lines target_line
           ON target_line.base_variant_id = prior_line.base_variant_id
        GROUP BY prior_line.base_variant_id
     )
     SELECT target.id AS document_id,
            to_char(target.document_date, 'YYYY-MM-DD') AS document_date,
            target.reference_number,
            target.warehouse_code,
            target.warehouse_name,
            target_line.base_variant_id,
            base.sku,
            product.name AS product_name,
            base_unit.code AS base_unit_code,
            COALESCE(prior.quantity_before, 0)::text AS quantity_before,
            target_line.quantity_delta::text AS quantity_delta,
            (COALESCE(prior.quantity_before, 0) + target_line.quantity_delta)::text AS quantity_after
       FROM target_document target
       JOIN target_lines target_line ON true
       JOIN shared.product_variants base
         ON base.installation_id = $1
        AND base.id = target_line.base_variant_id
       JOIN shared.products product
         ON product.installation_id = base.installation_id
        AND product.id = base.product_id
       LEFT JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base.installation_id
        AND base_unit.id = base.unit_id
       LEFT JOIN prior_quantities prior
         ON prior.base_variant_id = target_line.base_variant_id
      ORDER BY product.name, base.sku`,
    [installationId, warehouseIds, documentId],
  );
  return result.rows ?? [];
}
