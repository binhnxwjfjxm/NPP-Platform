function validScopeIds(values) {
  return Array.isArray(values)
    ? [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    : [];
}

function employeeVisibility({ employeeId = null, actorId = null, allowAllEmployees = false }, params) {
  if (allowAllEmployees) return '';
  const employee = typeof employeeId === 'string' ? employeeId.trim() : '';
  const actor = typeof actorId === 'string' ? actorId.trim() : '';
  if (employee) {
    params.push(employee);
    const index = params.length;
    return ` AND (
      so.source_employee_id = $${index}::uuid
      OR EXISTS (
        SELECT 1
          FROM shared.users creator_user
         WHERE creator_user.installation_id = so.installation_id
           AND creator_user.employee_id = $${index}::uuid
           AND so.created_by = 'user:' || creator_user.id::text
      )
    )`;
  }
  if (actor) {
    params.push(actor);
    return ` AND so.created_by = $${params.length}`;
  }
  return ' AND false';
}

export async function getCustomerSalesSummary(client, {
  installationId,
  customerId,
  warehouseIds,
  employeeId = null,
  actorId = null,
  allowAllEmployees = false,
  sinceInstant = null,
}) {
  const scopedWarehouses = validScopeIds(warehouseIds);
  if (scopedWarehouses.length === 0) {
    return { revenue: '0', order_count: '0', last_purchase_at: null };
  }

  const params = [installationId, customerId, scopedWarehouses, sinceInstant];
  const visibility = employeeVisibility({ employeeId, actorId, allowAllEmployees }, params);
  const result = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE $4::timestamptz IS NULL OR so.confirmed_at >= $4::timestamptz
       )::text AS order_count,
       COALESCE(sum(current_version.total) FILTER (
         WHERE ($4::timestamptz IS NULL OR so.confirmed_at >= $4::timestamptz)
           AND current_version.currency_code = 'VND'
       ), 0)::numeric(20,6)::text AS revenue,
       max(so.confirmed_at) AS last_purchase_at
     FROM sales.sales_orders so
     JOIN LATERAL (
       SELECT version.total, version.currency_code
         FROM sales.sales_order_versions version
        WHERE version.installation_id = so.installation_id
          AND version.sales_order_id = so.id
          AND version.version_status IN ('confirmed', 'superseded')
        ORDER BY version.version_number DESC
        LIMIT 1
     ) current_version ON true
     WHERE so.installation_id = $1
       AND so.customer_id = $2::uuid
       AND so.warehouse_id = ANY($3::uuid[])
       AND so.status IN ('confirmed', 'closed')${visibility}`,
    params,
  );
  return result.rows[0] ?? { revenue: '0', order_count: '0', last_purchase_at: null };
}

export async function getCustomerPurchasedItems(client, {
  installationId,
  customerId,
  warehouseIds,
  employeeId = null,
  actorId = null,
  allowAllEmployees = false,
  sinceInstant = null,
  search = '',
  limit = 50,
  offset = 0,
}) {
  const scopedWarehouses = validScopeIds(warehouseIds);
  if (scopedWarehouses.length === 0) return [];

  const params = [installationId, customerId, scopedWarehouses, sinceInstant, search, limit, offset];
  const visibility = employeeVisibility({ employeeId, actorId, allowAllEmployees }, params);
  const result = await client.query(
    `WITH purchased_lines AS (
       SELECT
         so.id AS sales_order_id,
         version.version_number,
         version.confirmed_at,
         line.id AS line_id,
         line.variant_id,
         line.sku_snapshot,
         line.item_name_snapshot,
         line.unit_code_snapshot,
         line.ordered_quantity,
         line.line_total,
         line.unit_price
       FROM sales.sales_orders so
       JOIN sales.sales_order_versions version
         ON version.installation_id = so.installation_id
        AND version.sales_order_id = so.id
        AND version.version_number = so.current_version_number
       JOIN sales.sales_order_version_lines line
         ON line.installation_id = version.installation_id
        AND line.sales_order_version_id = version.id
      WHERE so.installation_id = $1
        AND so.customer_id = $2::uuid
        AND so.warehouse_id = ANY($3::uuid[])
        AND so.status IN ('confirmed', 'closed')
        AND version.version_status = 'confirmed'
        AND version.confirmed_at IS NOT NULL
        AND version.currency_code = 'VND'
        AND ($4::timestamptz IS NULL OR version.confirmed_at >= $4::timestamptz)${visibility}
     ), ranked AS (
       SELECT purchased_lines.*,
              row_number() OVER (
                PARTITION BY purchased_lines.variant_id
                ORDER BY purchased_lines.confirmed_at DESC,
                         purchased_lines.sales_order_id DESC,
                         purchased_lines.version_number DESC,
                         purchased_lines.line_id DESC
              ) AS recency_rank
         FROM purchased_lines
     ), aggregated AS (
       SELECT variant_id,
              sum(ordered_quantity)::numeric(20,6)::text AS total_quantity,
              sum(line_total)::numeric(20,6)::text AS revenue,
              count(*)::text AS purchase_count,
              max(confirmed_at) AS last_purchase_at
         FROM ranked
        GROUP BY variant_id
     ), combined AS (
       SELECT aggregated.variant_id,
              latest.sku_snapshot,
              latest.item_name_snapshot,
              latest.unit_code_snapshot,
              aggregated.total_quantity,
              aggregated.revenue,
              aggregated.purchase_count,
              latest.unit_price::numeric(20,6)::text AS last_unit_price,
              aggregated.last_purchase_at
         FROM aggregated
         JOIN ranked latest
           ON latest.variant_id = aggregated.variant_id
          AND latest.recency_rank = 1
        WHERE $5::text = ''
           OR latest.sku_snapshot ILIKE '%' || $5::text || '%'
           OR latest.item_name_snapshot ILIKE '%' || $5::text || '%'
     )
     SELECT combined.*,
            count(*) OVER()::text AS total_count
       FROM combined
      ORDER BY combined.last_purchase_at DESC NULLS LAST,
               combined.item_name_snapshot ASC,
               combined.sku_snapshot ASC
      LIMIT $6::integer OFFSET $7::integer`,
    params,
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

export async function getCustomerReceivableSummary(client, {
  installationId,
  customerId,
  warehouseIds,
}) {
  const scopedWarehouses = validScopeIds(warehouseIds);
  if (scopedWarehouses.length === 0) {
    return { balance: '0', open_amount: '0', open_document_count: '0', updated_at: null };
  }

  const result = await client.query(
    `WITH ledger AS (
       SELECT COALESCE(sum(entry.amount), 0)::numeric(20,6) AS balance,
              max(entry.occurred_at) AS updated_at
         FROM accounting.receivable_ledger_entries entry
         JOIN accounting.receivable_documents document
           ON document.installation_id = entry.installation_id
          AND document.id = entry.receivable_document_id
        WHERE document.installation_id = $1
          AND document.customer_id = $2::uuid
          AND document.warehouse_id = ANY($3::uuid[])
          AND document.currency_code = 'VND'
          AND entry.currency_code = 'VND'
     ), open_documents AS (
       SELECT COALESCE(sum(document.remaining_amount), 0)::numeric(20,6) AS open_amount,
              count(*)::text AS open_document_count
         FROM accounting.receivable_documents document
        WHERE document.installation_id = $1
          AND document.customer_id = $2::uuid
          AND document.warehouse_id = ANY($3::uuid[])
          AND document.currency_code = 'VND'
          AND document.status IN ('open', 'partially_allocated')
     )
     SELECT ledger.balance::text AS balance,
            open_documents.open_amount::text AS open_amount,
            open_documents.open_document_count,
            ledger.updated_at
       FROM ledger CROSS JOIN open_documents`,
    [installationId, customerId, scopedWarehouses],
  );
  return result.rows[0] ?? { balance: '0', open_amount: '0', open_document_count: '0', updated_at: null };
}
