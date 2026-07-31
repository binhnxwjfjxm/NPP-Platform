import { randomUUID } from 'node:crypto';

const PRICE_COLUMNS = `spp.id, spp.installation_id, spp.supplier_id,
  supplier.code AS supplier_code, supplier.name AS supplier_name,
  spp.variant_id, variant.sku, variant.name AS variant_name,
  product.code AS product_code, product.name AS product_name,
  spp.unit_id, unit.code AS unit_code, unit.name AS unit_name,
  spp.currency_code, spp.unit_price, spp.min_quantity,
  spp.effective_from, spp.effective_to, spp.supplier_sku,
  spp.source_reference, spp.note, spp.is_active, spp.revision,
  spp.created_at, spp.updated_at, spp.created_by, spp.updated_by`;

const PRICE_JOINS = `
  JOIN shared.suppliers supplier
    ON supplier.installation_id = spp.installation_id AND supplier.id = spp.supplier_id
  JOIN shared.product_variants variant
    ON variant.installation_id = spp.installation_id AND variant.id = spp.variant_id
  JOIN shared.products product
    ON product.installation_id = variant.installation_id AND product.id = variant.product_id
  JOIN shared.units_of_measure unit
    ON unit.installation_id = spp.installation_id AND unit.id = spp.unit_id`;

export async function listSupplierPurchasePrices(client, {
  installationId,
  supplierId = null,
  variantId = null,
  active,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let query = `SELECT ${PRICE_COLUMNS}
    FROM purchasing.supplier_purchase_prices spp
    ${PRICE_JOINS}
    WHERE spp.installation_id = $1`;
  if (supplierId) {
    params.push(supplierId);
    query += ` AND spp.supplier_id = $${params.length}`;
  }
  if (variantId) {
    params.push(variantId);
    query += ` AND spp.variant_id = $${params.length}`;
  }
  if (typeof active === 'boolean') {
    params.push(active);
    query += ` AND spp.is_active = $${params.length}`;
  }
  params.push(limit, offset);
  query += ` ORDER BY supplier.code ASC, product.code ASC, variant.sku ASC,
    spp.min_quantity DESC, spp.effective_from DESC, spp.id ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getSupplierPurchasePriceById(client, {
  installationId,
  id,
  forUpdate = false,
}) {
  let query = `SELECT ${PRICE_COLUMNS}
    FROM purchasing.supplier_purchase_prices spp
    ${PRICE_JOINS}
    WHERE spp.installation_id = $1 AND spp.id = $2`;
  if (forUpdate) query += ' FOR UPDATE OF spp';
  return (await client.query(query, [installationId, id])).rows[0] ?? null;
}

export async function getPurchasePriceReferences(client, {
  installationId,
  supplierId,
  variantId,
  unitId,
}) {
  return (await client.query(
    `SELECT
       supplier.id AS supplier_id,
       supplier.is_active AS supplier_is_active,
       variant.id AS variant_id,
       variant.is_active AS variant_is_active,
       variant.is_purchasable,
       variant.unit_id AS variant_unit_id,
       variant.conversion_to_base,
       product.id AS product_id,
       product.is_active AS product_is_active,
       product.is_orderable AS product_is_orderable,
       unit.id AS unit_id,
       unit.is_active AS unit_is_active
     FROM shared.suppliers supplier
     JOIN shared.product_variants variant
       ON variant.installation_id = supplier.installation_id AND variant.id = $3
     JOIN shared.products product
       ON product.installation_id = variant.installation_id AND product.id = variant.product_id
     JOIN shared.units_of_measure unit
       ON unit.installation_id = supplier.installation_id AND unit.id = $4
     WHERE supplier.installation_id = $1 AND supplier.id = $2`,
    [installationId, supplierId, variantId, unitId],
  )).rows[0] ?? null;
}

export async function insertSupplierPurchasePrice(client, data) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO purchasing.supplier_purchase_prices
      (id, installation_id, supplier_id, variant_id, unit_id,
       currency_code, unit_price, min_quantity, effective_from, effective_to,
       supplier_sku, source_reference, note, is_active, revision,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$15,$16,$16)`,
    [
      id, data.installationId, data.supplierId, data.variantId, data.unitId,
      data.currencyCode, data.unitPrice, data.minQuantity, data.effectiveFrom,
      data.effectiveTo, data.supplierSku, data.sourceReference, data.note,
      data.isActive, now, data.actorId,
    ],
  );
  return getSupplierPurchasePriceById(client, { installationId: data.installationId, id });
}

export async function updateSupplierPurchasePrice(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_purchase_prices
     SET supplier_id = $1,
         variant_id = $2,
         unit_id = $3,
         currency_code = $4,
         unit_price = $5,
         min_quantity = $6,
         effective_from = $7,
         effective_to = $8,
         supplier_sku = $9,
         source_reference = $10,
         note = $11,
         is_active = $12,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $13
     WHERE installation_id = $14 AND id = $15 AND revision = $16
     RETURNING id`,
    [
      data.supplierId, data.variantId, data.unitId, data.currencyCode,
      data.unitPrice, data.minQuantity, data.effectiveFrom, data.effectiveTo,
      data.supplierSku, data.sourceReference, data.note, data.isActive,
      data.actorId, data.installationId, data.id, data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  return getSupplierPurchasePriceById(client, { installationId: data.installationId, id: data.id });
}

export async function resolveSupplierPurchasePrice(client, {
  installationId,
  supplierId,
  variantId,
  unitId,
  currencyCode,
  quantity,
  orderDate,
}) {
  return (await client.query(
    `SELECT ${PRICE_COLUMNS}
     FROM purchasing.supplier_purchase_prices spp
     ${PRICE_JOINS}
     WHERE spp.installation_id = $1
       AND spp.supplier_id = $2
       AND spp.variant_id = $3
       AND spp.unit_id = $4
       AND spp.currency_code = $5
       AND spp.is_active = true
       AND spp.effective_from <= $6::date
       AND (spp.effective_to IS NULL OR spp.effective_to >= $6::date)
       AND spp.min_quantity <= $7::numeric
     ORDER BY spp.min_quantity DESC, spp.effective_from DESC, spp.id ASC
     LIMIT 1`,
    [installationId, supplierId, variantId, unitId, currencyCode, orderDate, quantity],
  )).rows[0] ?? null;
}

export async function setPurchaseOrderLinePriceProvenance(client, {
  installationId,
  purchaseOrderId,
  variantId,
  purchasePriceId,
  source,
  supplierSkuSnapshot,
  overrideReason,
  actorId,
}) {
  const result = await client.query(
    `UPDATE purchasing.purchase_order_lines
     SET purchase_price_id = $1,
         purchase_price_source = $2,
         purchase_price_resolved_at = clock_timestamp(),
         supplier_sku_snapshot = $3,
         purchase_price_override_reason = $4,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $5
     WHERE installation_id = $6
       AND purchase_order_id = $7
       AND variant_id = $8
     RETURNING id`,
    [
      purchasePriceId, source, supplierSkuSnapshot, overrideReason, actorId,
      installationId, purchaseOrderId, variantId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function getPurchaseOrderPriceProvenance(client, {
  installationId,
  purchaseOrderId,
}) {
  return (await client.query(
    `SELECT variant_id, purchase_price_id, purchase_price_source,
            purchase_price_resolved_at, supplier_sku_snapshot,
            purchase_price_override_reason
     FROM purchasing.purchase_order_lines
     WHERE installation_id = $1 AND purchase_order_id = $2`,
    [installationId, purchaseOrderId],
  )).rows;
}
