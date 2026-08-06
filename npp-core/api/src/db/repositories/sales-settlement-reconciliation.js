function addFilter(filters, values, expression, value) {
  values.push(value);
  filters.push(expression.replaceAll('?', `$${values.length}`));
}

function addSearch(filters, values, columns, search) {
  if (!search || !columns?.length) return;
  values.push(`%${search}%`);
  const parameter = `$${values.length}`;
  filters.push(`(${columns.map((column) => `${column} ILIKE ${parameter}`).join(' OR ')})`);
}

function scopedWhere({ installationId, warehouseIds, from, to, search, status }, options = {}) {
  const values = [installationId, warehouseIds];
  const filters = [`${options.installationColumn ?? 'installation_id'} = $1`, `${options.warehouseColumn ?? 'warehouse_id'} = ANY($2::uuid[])`];
  if (from && options.dateColumn) addFilter(filters, values, `${options.dateColumn} >= ?::date`, from);
  if (to && options.dateColumn) addFilter(filters, values, `${options.dateColumn} <= ?::date`, to);
  addSearch(filters, values, options.searchColumns, search);
  if (status && status !== 'all' && options.statusColumn !== false) {
    addFilter(filters, values, `${options.statusColumn ?? 'reconciliation_status'} = ?`, status);
  }
  return { values, sql: filters.join(' AND ') };
}

function customerDocumentWhere(input, { includeStatus = true } = {}) {
  return scopedWhere(input, {
    dateColumn: 'source_document_date',
    searchColumns: ['customer_code_snapshot', 'customer_name_snapshot', 'source_document_number', 'warehouse_code_snapshot'],
    statusColumn: includeStatus ? 'reconciliation_status' : false,
  });
}

export async function getSummary(adapter, input) {
  const documents = customerDocumentWhere(input);
  const anomalies = scopedWhere(input, {
    searchColumns: ['source_number', 'anomaly_type'],
    statusColumn: 'reconciliation_status',
  });
  const collections = scopedWhere(input, {
    dateColumn: 'collected_at::date',
    searchColumns: ['customer_code', 'customer_name', 'delivery_order_number', 'trip_number', 'driver_code', 'driver_name'],
    statusColumn: false,
  });
  const handovers = scopedWhere(input, {
    dateColumn: 'handed_over_at::date',
    searchColumns: ['trip_number', 'driver_code', 'driver_name', 'warehouse_code'],
    statusColumn: false,
  });
  if (input.status && input.status !== 'all') {
    collections.values.push(input.status === 'matched');
    collections.sql += ` AND lifecycle_matches = $${collections.values.length}`;
    handovers.values.push(input.status === 'matched');
    handovers.sql += ` AND lifecycle_matches = $${handovers.values.length}`;
  }
  const [documentResult, anomalyResult, collectionResult, handoverResult] = await Promise.all([
    adapter.query(`
      SELECT count(DISTINCT (customer_id, warehouse_id, currency_code))::bigint AS customer_group_count,
             COALESCE(sum(CASE WHEN direction = 'DEBIT' AND document_status <> 'reversed' THEN projected_remaining_amount ELSE 0 END), 0::numeric) AS debit_outstanding_amount,
             COALESCE(sum(CASE WHEN direction = 'CREDIT' AND document_status <> 'reversed' THEN projected_remaining_amount ELSE 0 END), 0::numeric) AS unapplied_credit_amount,
             COALESCE(sum(ledger_amount), 0::numeric) AS ledger_balance,
             count(*) FILTER (WHERE reconciliation_status = 'mismatch')::bigint AS document_mismatch_count
        FROM reporting.phase6f_document_reconciliation
       WHERE ${documents.sql}
    `, documents.values),
    adapter.query(`
      SELECT count(*)::bigint AS anomaly_count
        FROM reporting.phase6f_closeout_anomalies
       WHERE ${anomalies.sql}
    `, anomalies.values),
    adapter.query(`
      SELECT COALESCE(sum(custody_remaining_amount), 0::numeric) AS cod_custody_amount,
             count(*) FILTER (WHERE NOT lifecycle_matches)::bigint AS collection_mismatch_count
        FROM reporting.phase6f_cod_collection_reconciliation
       WHERE ${collections.sql}
    `, collections.values),
    adapter.query(`
      SELECT COALESCE(sum(pending_acceptance_amount), 0::numeric) AS cod_pending_acceptance_amount,
             COALESCE(sum(accepted_amount), 0::numeric) AS cod_accepted_amount,
             COALESCE(sum(variance_amount), 0::numeric) AS cod_variance_amount,
             count(*) FILTER (WHERE NOT lifecycle_matches)::bigint AS handover_mismatch_count
        FROM reporting.phase6f_cod_handover_reconciliation
       WHERE ${handovers.sql}
    `, handovers.values),
  ]);
  return {
    ...documentResult.rows[0],
    ...anomalyResult.rows[0],
    ...collectionResult.rows[0],
    ...handoverResult.rows[0],
  };
}

export async function listCustomers(adapter, input) {
  const where = customerDocumentWhere(input, { includeStatus: false });
  const values = [...where.values];
  let having = '';
  if (input.status && input.status !== 'all') {
    values.push(input.status === 'mismatch');
    having = `HAVING ((count(*) FILTER (WHERE reconciliation_status = 'mismatch') > 0) OR (COALESCE(sum(ledger_amount), 0::numeric) <> COALESCE(sum(CASE WHEN document_status = 'reversed' THEN 0 WHEN direction = 'DEBIT' THEN projected_remaining_amount ELSE -projected_remaining_amount END), 0::numeric))) = $${values.length}`;
  }
  values.push(input.limit);
  return (await adapter.query(`
    SELECT customer_id,
           min(customer_code_snapshot) AS customer_code,
           min(customer_name_snapshot) AS customer_name,
           warehouse_id,
           min(warehouse_code_snapshot) AS warehouse_code,
           min(warehouse_name_snapshot) AS warehouse_name,
           currency_code,
           COALESCE(sum(CASE WHEN direction = 'DEBIT' AND document_status <> 'reversed' THEN original_amount ELSE 0 END), 0::numeric) AS debit_posted_amount,
           COALESCE(sum(CASE WHEN direction = 'CREDIT' AND document_status <> 'reversed' THEN original_amount ELSE 0 END), 0::numeric) AS credit_posted_amount,
           COALESCE(sum(CASE WHEN direction = 'DEBIT' AND document_status <> 'reversed' THEN projected_remaining_amount ELSE 0 END), 0::numeric) AS debit_outstanding_amount,
           COALESCE(sum(CASE WHEN direction = 'CREDIT' AND document_status <> 'reversed' THEN projected_remaining_amount ELSE 0 END), 0::numeric) AS unapplied_credit_amount,
           COALESCE(sum(CASE WHEN document_status = 'reversed' THEN 0 WHEN direction = 'DEBIT' THEN projected_remaining_amount ELSE -projected_remaining_amount END), 0::numeric) AS calculated_open_balance,
           COALESCE(sum(ledger_amount), 0::numeric) AS ledger_balance,
           count(*) FILTER (WHERE reconciliation_status = 'mismatch')::bigint AS document_mismatch_count,
           max(source_document_date) AS latest_document_date,
           CASE
             WHEN count(*) FILTER (WHERE reconciliation_status = 'mismatch') = 0
              AND COALESCE(sum(ledger_amount), 0::numeric) = COALESCE(sum(CASE WHEN document_status = 'reversed' THEN 0 WHEN direction = 'DEBIT' THEN projected_remaining_amount ELSE -projected_remaining_amount END), 0::numeric)
             THEN 'matched' ELSE 'mismatch'
           END AS reconciliation_status
      FROM reporting.phase6f_document_reconciliation
     WHERE ${where.sql}
     GROUP BY customer_id, warehouse_id, currency_code
     ${having}
     ORDER BY CASE WHEN count(*) FILTER (WHERE reconciliation_status = 'mismatch') > 0 THEN 0 ELSE 1 END,
              abs(COALESCE(sum(CASE WHEN document_status = 'reversed' THEN 0 WHEN direction = 'DEBIT' THEN projected_remaining_amount ELSE -projected_remaining_amount END), 0::numeric)) DESC,
              min(customer_code_snapshot), min(warehouse_code_snapshot)
     LIMIT $${values.length}
  `, values)).rows;
}

export async function listDocuments(adapter, input) {
  const where = customerDocumentWhere(input);
  const values = [...where.values, input.limit];
  return (await adapter.query(`
    SELECT *
      FROM reporting.phase6f_document_reconciliation
     WHERE ${where.sql}
     ORDER BY CASE WHEN reconciliation_status = 'mismatch' THEN 0 ELSE 1 END,
              source_document_date DESC,
              source_document_number,
              id
     LIMIT $${values.length}
  `, values)).rows;
}

export async function listOrders(adapter, input) {
  const where = scopedWhere(input, {
    dateColumn: 'updated_at::date',
    searchColumns: ['order_number', 'customer_code', 'customer_name', 'warehouse_code'],
  });
  const values = [...where.values, input.limit];
  return (await adapter.query(`
    SELECT *
      FROM reporting.phase6f_order_status_projection
     WHERE ${where.sql}
     ORDER BY CASE WHEN reconciliation_status = 'mismatch' THEN 0 ELSE 1 END,
              updated_at DESC,
              order_number NULLS LAST,
              sales_order_id
     LIMIT $${values.length}
  `, values)).rows;
}

export async function listCodCollections(adapter, input) {
  const where = scopedWhere(input, {
    dateColumn: 'collected_at::date',
    searchColumns: ['customer_code', 'customer_name', 'delivery_order_number', 'trip_number', 'driver_code', 'driver_name'],
    statusColumn: false,
  });
  if (input.status && input.status !== 'all') {
    where.values.push(input.status === 'matched');
    where.sql += ` AND lifecycle_matches = $${where.values.length}`;
  }
  const values = [...where.values, input.limit];
  return (await adapter.query(`
    SELECT *
      FROM reporting.phase6f_cod_collection_reconciliation
     WHERE ${where.sql}
     ORDER BY CASE WHEN lifecycle_matches THEN 1 ELSE 0 END,
              collected_at DESC,
              collection_id
     LIMIT $${values.length}
  `, values)).rows;
}

export async function listCodHandovers(adapter, input) {
  const where = scopedWhere(input, {
    dateColumn: 'handed_over_at::date',
    searchColumns: ['trip_number', 'driver_code', 'driver_name', 'warehouse_code'],
    statusColumn: false,
  });
  if (input.status && input.status !== 'all') {
    where.values.push(input.status === 'matched');
    where.sql += ` AND lifecycle_matches = $${where.values.length}`;
  }
  const values = [...where.values, input.limit];
  return (await adapter.query(`
    SELECT *
      FROM reporting.phase6f_cod_handover_reconciliation
     WHERE ${where.sql}
     ORDER BY CASE WHEN lifecycle_matches THEN 1 ELSE 0 END,
              handed_over_at DESC,
              handover_id
     LIMIT $${values.length}
  `, values)).rows;
}

export async function listAnomalies(adapter, input) {
  const where = scopedWhere(input, {
    searchColumns: ['source_number', 'anomaly_type'],
  });
  const values = [...where.values, input.limit];
  return (await adapter.query(`
    SELECT anomaly_type, source_id, source_number, reconciliation_status, details, warehouse_id
      FROM reporting.phase6f_closeout_anomalies
     WHERE ${where.sql}
     ORDER BY anomaly_type, source_number, source_id
     LIMIT $${values.length}
  `, values)).rows;
}
