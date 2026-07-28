function toLocalDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 10);
}

function presentInventoryLot(row) {
  if (!row) return row;
  return {
    ...row,
    manufactured_date: toLocalDateOnly(row.manufactured_date),
    expiry_date: toLocalDateOnly(row.expiry_date),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function resolveInventoryBaseVariant(client, { installationId, baseVariantId }) {
  const result = await client.query(
    `SELECT variant.id AS base_variant_id,
            variant.installation_id,
            variant.product_id,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_inventory_base,
            variant.is_active AS base_variant_active,
            product.code AS product_code,
            product.name AS product_name
       FROM shared.product_variants variant
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE variant.installation_id = $1
        AND variant.id = $2
      LIMIT 1`,
    [installationId, baseVariantId],
  );
  return result.rows?.[0] ?? null;
}

export async function getTrackingPolicyByBaseVariant(client, { installationId, baseVariantId }) {
  const result = await client.query(
    `SELECT policy.*,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_active AS base_variant_active,
            variant.is_inventory_base,
            product.code AS product_code,
            product.name AS product_name
       FROM inventory.product_tracking_policies policy
       JOIN shared.product_variants variant
         ON variant.installation_id = policy.installation_id
        AND variant.id = policy.base_variant_id
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE policy.installation_id = $1
        AND policy.base_variant_id = $2
      LIMIT 1`,
    [installationId, baseVariantId],
  );
  return result.rows?.[0] ?? null;
}

export async function listTrackingPolicies(client, {
  installationId,
  search = null,
  active = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT policy.*,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_active AS base_variant_active,
            variant.is_inventory_base,
            product.code AS product_code,
            product.name AS product_name
       FROM inventory.product_tracking_policies policy
       JOIN shared.product_variants variant
         ON variant.installation_id = policy.installation_id
        AND variant.id = policy.base_variant_id
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE policy.installation_id = $1
        AND ($2::boolean IS NULL OR variant.is_active = $2)
        AND (
          $3::text IS NULL OR
          variant.sku ILIKE $3 OR
          variant.name ILIKE $3 OR
          product.code ILIKE $3 OR
          product.name ILIKE $3
        )
      ORDER BY variant.sku ASC
      LIMIT $4 OFFSET $5`,
    [
      installationId,
      active,
      search ? `%${String(search).trim()}%` : null,
      limit,
      offset,
    ],
  );
  return result.rows ?? [];
}

export async function insertTrackingPolicy(client, policy) {
  const result = await client.query(
    `INSERT INTO inventory.product_tracking_policies (
       installation_id,
       base_variant_id,
       lot_tracking_mode,
       expiry_tracking_mode,
       location_required,
       version,
       created_at,
       created_by,
       updated_at,
       updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
     )
     RETURNING *`,
    [
      policy.installationId,
      policy.baseVariantId,
      policy.lotTrackingMode,
      policy.expiryTrackingMode,
      policy.locationRequired,
      policy.version,
      policy.createdAt,
      policy.createdBy,
      policy.updatedAt,
      policy.updatedBy,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function updateTrackingPolicy(client, policy) {
  const result = await client.query(
    `UPDATE inventory.product_tracking_policies
        SET lot_tracking_mode = $3,
            expiry_tracking_mode = $4,
            location_required = $5,
            version = $6,
            updated_at = $7,
            updated_by = $8
      WHERE installation_id = $1
        AND base_variant_id = $2
        AND version = $9
      RETURNING *`,
    [
      policy.installationId,
      policy.baseVariantId,
      policy.lotTrackingMode,
      policy.expiryTrackingMode,
      policy.locationRequired,
      policy.nextVersion,
      policy.updatedAt,
      policy.updatedBy,
      policy.expectedVersion,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function countLotUsage(client, { installationId, baseVariantId }) {
  const result = await client.query(
    `SELECT
       COALESCE((SELECT count(*) FROM inventory.inventory_lots lot
                  WHERE lot.installation_id = $1
                    AND lot.base_variant_id = $2), 0)::bigint AS lot_rows,
       COALESCE((SELECT count(*) FROM inventory.inventory_movement_lines line
                  WHERE line.installation_id = $1
                    AND line.base_variant_id = $2
                    AND line.lot_id IS NOT NULL), 0)::bigint AS movement_rows,
       COALESCE((SELECT count(*) FROM inventory.inventory_reservations reservation
                  WHERE reservation.installation_id = $1
                    AND reservation.base_variant_id = $2
                    AND reservation.lot_id IS NOT NULL), 0)::bigint AS reservation_rows,
       COALESCE((SELECT count(*) FROM inventory.inventory_lots lot
                  WHERE lot.installation_id = $1
                    AND lot.base_variant_id = $2
                    AND lot.expiry_date IS NOT NULL), 0)::bigint AS expiring_lot_rows
     `,
    [installationId, baseVariantId],
  );
  return result.rows?.[0] ?? { lot_rows: 0n, movement_rows: 0n, reservation_rows: 0n, expiring_lot_rows: 0n };
}

export async function getInventoryLotById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT lot.*,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_active AS base_variant_active,
            product.code AS product_code,
            product.name AS product_name
       FROM inventory.inventory_lots lot
       JOIN shared.product_variants variant
         ON variant.installation_id = lot.installation_id
        AND variant.id = lot.base_variant_id
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE lot.installation_id = $1
        AND lot.id = $2
      LIMIT 1`,
    [installationId, id],
  );
  return presentInventoryLot(result.rows?.[0] ?? null);
}

export async function getInventoryLotByIdentity(client, { installationId, baseVariantId, normalizedLotCode }) {
  const result = await client.query(
    `SELECT lot.*,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_active AS base_variant_active,
            product.code AS product_code,
            product.name AS product_name
       FROM inventory.inventory_lots lot
       JOIN shared.product_variants variant
         ON variant.installation_id = lot.installation_id
        AND variant.id = lot.base_variant_id
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE lot.installation_id = $1
        AND lot.base_variant_id = $2
        AND lot.normalized_lot_code = $3
      LIMIT 1`,
    [installationId, baseVariantId, normalizedLotCode],
  );
  return presentInventoryLot(result.rows?.[0] ?? null);
}

export async function listInventoryLots(client, {
  installationId,
  search = null,
  baseVariantId = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT lot.*,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_active AS base_variant_active,
            variant.is_inventory_base,
            product.code AS product_code,
            product.name AS product_name
       FROM inventory.inventory_lots lot
       JOIN shared.product_variants variant
         ON variant.installation_id = lot.installation_id
        AND variant.id = lot.base_variant_id
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE lot.installation_id = $1
        AND ($2::uuid IS NULL OR lot.base_variant_id = $2)
        AND (
          $3::text IS NULL OR
          lot.lot_code ILIKE $3 OR
          lot.normalized_lot_code ILIKE $3 OR
          variant.sku ILIKE $3 OR
          product.code ILIKE $3
        )
      ORDER BY lot.normalized_lot_code ASC, lot.id ASC
      LIMIT $4 OFFSET $5`,
    [installationId, baseVariantId, search ? `%${String(search).trim()}%` : null, limit, offset],
  );
  return (result.rows ?? []).map(presentInventoryLot);
}

export async function insertInventoryLot(client, lot) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_lots (
       id,
       installation_id,
       base_variant_id,
       lot_code,
       normalized_lot_code,
       manufactured_date,
       expiry_date,
       supplier_lot_reference,
       metadata,
       created_at,
       created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
     )
     ON CONFLICT (installation_id, base_variant_id, normalized_lot_code) DO NOTHING
     RETURNING *`,
    [
      lot.id,
      lot.installationId,
      lot.baseVariantId,
      lot.lotCode,
      lot.normalizedLotCode,
      lot.manufacturedDate ?? null,
      lot.expiryDate ?? null,
      lot.supplierLotReference ?? null,
      lot.metadata ?? {},
      lot.createdAt,
      lot.createdBy,
    ],
  );
  return presentInventoryLot(result.rows?.[0] ?? null);
}
