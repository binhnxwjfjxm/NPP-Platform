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
         WHERE $4::timestamptz IS NULL OR so.confirmed_at >= $4::timestamptz
       ), 0)::numeric(20,6)::text AS revenue,
       max(so.confirmed_at) AS last_purchase_at
     FROM sales.sales_orders so
     JOIN LATERAL (
       SELECT version.total
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
     ), open_documents AS (
       SELECT COALESCE(sum(document.remaining_amount), 0)::numeric(20,6) AS open_amount,
              count(*)::text AS open_document_count
         FROM accounting.receivable_documents document
        WHERE document.installation_id = $1
          AND document.customer_id = $2::uuid
          AND document.warehouse_id = ANY($3::uuid[])
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
