import { BUSINESS_TIMEZONE, mapRow, mapRows, reportingInternals } from './reporting-common.js';

function currentBusinessDate(receivedAt) {
  return reportingInternals.businessDateNow(new Date(receivedAt));
}

export async function agingReport(adapter, requestContext, filters, warehouseIds) {
  const currentDate = currentBusinessDate(requestContext.receivedAt);
  const params = [requestContext.installationId, warehouseIds, filters.warehouseId, currentDate];
  const arBucket = `CASE
    WHEN ($4::date - document.source_document_date) <= 30 THEN 'AGE_0_30'
    WHEN ($4::date - document.source_document_date) <= 60 THEN 'AGE_31_60'
    WHEN ($4::date - document.source_document_date) <= 90 THEN 'AGE_61_90'
    ELSE 'AGE_91_PLUS'
  END`;
  const apBucket = `CASE
    WHEN document.due_date >= $4::date THEN 'NOT_DUE'
    WHEN ($4::date - document.due_date) <= 30 THEN 'OVERDUE_1_30'
    WHEN ($4::date - document.due_date) <= 60 THEN 'OVERDUE_31_60'
    WHEN ($4::date - document.due_date) <= 90 THEN 'OVERDUE_61_90'
    ELSE 'OVERDUE_91_PLUS'
  END`;

  const [scopeWarehouses, arSummary, arCustomers, arDocuments, apSummary, apSuppliers, apDocuments] = await Promise.all([
    adapter.query(
      `SELECT warehouse.id AS warehouse_id,
              warehouse.code AS warehouse_code,
              warehouse.name AS warehouse_name
         FROM shared.warehouses warehouse
        WHERE warehouse.installation_id = $1
          AND warehouse.id = ANY($2::uuid[])
        ORDER BY warehouse.code, warehouse.id`,
      params,
    ),
    adapter.query(
      `SELECT document.currency_code, ${arBucket} AS age_bucket,
              count(*)::text AS document_count,
              sum(document.remaining_amount)::text AS remaining_amount
         FROM accounting.receivable_documents document
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR document.warehouse_id = $3::uuid)
          AND document.direction = 'DEBIT'
          AND document.document_type IN ('SALE_DELIVERY','SALE_PICKUP')
          AND document.status IN ('open','partially_allocated')
          AND document.remaining_amount > 0
          AND document.source_document_date <= $4::date
        GROUP BY document.currency_code, ${arBucket}
        ORDER BY document.currency_code, min(document.source_document_date)`,
      params,
    ),
    adapter.query(
      `SELECT document.customer_id,
              max(document.customer_code_snapshot) AS customer_code,
              max(document.customer_name_snapshot) AS customer_name,
              document.currency_code,
              count(*)::text AS document_count,
              sum(document.remaining_amount)::text AS remaining_amount,
              min(document.source_document_date)::text AS oldest_document_date,
              max(($4::date - document.source_document_date))::text AS oldest_age_days
         FROM accounting.receivable_documents document
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR document.warehouse_id = $3::uuid)
          AND document.direction = 'DEBIT'
          AND document.document_type IN ('SALE_DELIVERY','SALE_PICKUP')
          AND document.status IN ('open','partially_allocated')
          AND document.remaining_amount > 0
          AND document.source_document_date <= $4::date
        GROUP BY document.customer_id, document.currency_code
        ORDER BY sum(document.remaining_amount) DESC, max(document.customer_code_snapshot)
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `SELECT document.id AS receivable_document_id,
              document.customer_id,
              document.customer_code_snapshot AS customer_code,
              document.customer_name_snapshot AS customer_name,
              document.warehouse_id,
              document.warehouse_code_snapshot AS warehouse_code,
              document.source_document_type,
              document.source_document_id,
              document.source_document_number,
              document.source_document_date::text,
              document.collection_policy,
              document.currency_code,
              document.original_amount::text,
              document.allocated_amount::text,
              document.remaining_amount::text,
              ($4::date - document.source_document_date)::text AS age_days,
              ${arBucket} AS age_bucket
         FROM accounting.receivable_documents document
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR document.warehouse_id = $3::uuid)
          AND document.direction = 'DEBIT'
          AND document.document_type IN ('SALE_DELIVERY','SALE_PICKUP')
          AND document.status IN ('open','partially_allocated')
          AND document.remaining_amount > 0
          AND document.source_document_date <= $4::date
        ORDER BY document.source_document_date, document.source_document_number, document.id
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `SELECT document.currency_code, ${apBucket} AS age_bucket,
              count(*)::text AS document_count,
              sum(document.remaining_amount)::text AS remaining_amount
         FROM accounting.payable_documents document
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR document.warehouse_id = $3::uuid)
          AND document.direction = 'DEBIT'
          AND document.document_type = 'GOODS_RECEIPT'
          AND document.status IN ('open','partially_allocated')
          AND document.remaining_amount > 0
        GROUP BY document.currency_code, ${apBucket}
        ORDER BY document.currency_code, min(document.due_date)`,
      params,
    ),
    adapter.query(
      `SELECT document.supplier_id,
              supplier.code AS supplier_code,
              supplier.name AS supplier_name,
              document.currency_code,
              count(*)::text AS document_count,
              sum(document.remaining_amount)::text AS remaining_amount,
              min(document.due_date)::text AS earliest_due_date,
              greatest(max($4::date - document.due_date), 0)::text AS max_overdue_days
         FROM accounting.payable_documents document
         JOIN shared.suppliers supplier
           ON supplier.installation_id = document.installation_id
          AND supplier.id = document.supplier_id
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR document.warehouse_id = $3::uuid)
          AND document.direction = 'DEBIT'
          AND document.document_type = 'GOODS_RECEIPT'
          AND document.status IN ('open','partially_allocated')
          AND document.remaining_amount > 0
        GROUP BY document.supplier_id, supplier.code, supplier.name, document.currency_code
        ORDER BY sum(document.remaining_amount) DESC, supplier.code
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `SELECT document.id AS payable_document_id,
              document.supplier_id,
              supplier.code AS supplier_code,
              supplier.name AS supplier_name,
              document.warehouse_id,
              warehouse.code AS warehouse_code,
              document.source_document_type,
              document.source_document_id,
              document.source_document_number,
              document.source_document_date::text,
              document.payment_method_snapshot,
              document.payment_term_days_snapshot::text,
              document.due_date::text,
              document.currency_code,
              document.original_amount::text,
              document.allocated_amount::text,
              document.remaining_amount::text,
              greatest(($4::date - document.due_date), 0)::text AS overdue_days,
              ${apBucket} AS age_bucket
         FROM accounting.payable_documents document
         JOIN shared.suppliers supplier
           ON supplier.installation_id = document.installation_id
          AND supplier.id = document.supplier_id
         JOIN shared.warehouses warehouse
           ON warehouse.installation_id = document.installation_id
          AND warehouse.id = document.warehouse_id
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR document.warehouse_id = $3::uuid)
          AND document.direction = 'DEBIT'
          AND document.document_type = 'GOODS_RECEIPT'
          AND document.status IN ('open','partially_allocated')
          AND document.remaining_amount > 0
        ORDER BY document.due_date, document.source_document_number, document.id
        LIMIT 100`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'aging',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    currentDate,
    filters: Object.freeze({ warehouseId: filters.warehouseId }),
    scopeWarehouses: mapRows(scopeWarehouses.rows),
    basis: Object.freeze({
      receivable: 'current remaining_amount on sale receivable documents; age is source_document_date because AR has no canonical due_date',
      payable: 'current remaining_amount on payable documents; contractual overdue uses canonical due_date snapshot',
      currency: 'amounts remain separated by currency_code; no cross-currency sum',
    }),
    receivable: Object.freeze({
      summary: mapRows(arSummary.rows),
      customers: mapRows(arCustomers.rows),
      documents: mapRows(arDocuments.rows),
    }),
    payable: Object.freeze({
      summary: mapRows(apSummary.rows),
      suppliers: mapRows(apSuppliers.rows),
      documents: mapRows(apDocuments.rows),
    }),
  });
}

export async function grossMarginReport(adapter, requestContext, filters, warehouseIds) {
  const params = [requestContext.installationId, warehouseIds, filters.from, filters.to, filters.warehouseId];
  const eventsCte = `WITH latest_cost AS (
    SELECT DISTINCT ON (fact.inventory_movement_line_id)
           fact.inventory_movement_line_id, fact.status, fact.value_delta,
           fact.currency_code, fact.rebuild_run_id, run.completed_at AS costing_completed_at
      FROM inventory.inventory_cost_facts fact
      JOIN inventory.inventory_cost_rebuild_runs run
        ON run.installation_id = fact.installation_id
       AND run.id = fact.rebuild_run_id
     WHERE fact.installation_id = $1
       AND fact.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR fact.warehouse_id = $5::uuid)
     ORDER BY fact.inventory_movement_line_id, run.completed_at DESC, fact.rebuild_run_id DESC
  ), sales_events AS (
    SELECT 'SALE'::text AS event_kind,
           document.id AS accounting_document_id,
           document.source_document_number AS document_number,
           document.source_document_date AS document_date,
           document.customer_id, document.customer_code_snapshot AS customer_code,
           document.customer_name_snapshot AS customer_name,
           document.warehouse_id, document.warehouse_code_snapshot AS warehouse_code,
           issue_line.base_variant_id AS variant_id, line.sku_snapshot AS sku,
           document.currency_code,
           (line.gross_amount - line.discount_amount)::numeric AS net_revenue,
           CASE WHEN cost.status = 'COSTED' THEN -cost.value_delta ELSE NULL END::numeric AS cogs,
           cost.status AS cost_status, cost.rebuild_run_id, cost.costing_completed_at,
           line.id AS source_line_id,
           issue_line.inventory_movement_line_id AS costing_movement_line_id
      FROM accounting.receivable_documents document
      JOIN accounting.receivable_document_lines line
        ON line.installation_id = document.installation_id
       AND line.receivable_document_id = document.id
      LEFT JOIN sales.delivery_order_inventory_issue_lines issue_line
        ON issue_line.installation_id = line.installation_id
       AND issue_line.id = line.inventory_issue_line_id
      LEFT JOIN latest_cost cost
        ON cost.inventory_movement_line_id = issue_line.inventory_movement_line_id
     WHERE document.installation_id = $1
       AND document.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR document.warehouse_id = $5::uuid)
       AND document.direction = 'DEBIT'
       AND document.document_type IN ('SALE_DELIVERY','SALE_PICKUP')
       AND document.status <> 'reversed'
       AND document.source_document_date BETWEEN $3::date AND $4::date
  ), return_events AS (
    SELECT 'RETURN'::text AS event_kind,
           adjustment_document.id AS accounting_document_id,
           adjustment_document.source_document_number AS document_number,
           adjustment_document.source_document_date AS document_date,
           adjustment_document.customer_id,
           adjustment_document.customer_code_snapshot AS customer_code,
           adjustment_document.customer_name_snapshot AS customer_name,
           adjustment_document.warehouse_id,
           adjustment_document.warehouse_code_snapshot AS warehouse_code,
           return_line.base_variant_id AS variant_id, return_line.sku_snapshot AS sku,
           adjustment.currency_code,
           -round((source_line.gross_amount - source_line.discount_amount)
                  * adjustment.accepted_base_quantity / source_line.accepted_base_quantity, 6)::numeric AS net_revenue,
           CASE WHEN cost.status = 'COSTED' THEN -cost.value_delta ELSE NULL END::numeric AS cogs,
           cost.status AS cost_status, cost.rebuild_run_id, cost.costing_completed_at,
           adjustment.id AS source_line_id,
           receipt.inventory_movement_line_id AS costing_movement_line_id
      FROM accounting.customer_return_adjustment_lines adjustment
      JOIN accounting.receivable_documents adjustment_document
        ON adjustment_document.installation_id = adjustment.installation_id
       AND adjustment_document.id = adjustment.adjustment_receivable_document_id
      JOIN accounting.receivable_document_lines source_line
        ON source_line.installation_id = adjustment.installation_id
       AND source_line.id = adjustment.source_receivable_line_id
      JOIN sales.customer_return_lines return_line
        ON return_line.installation_id = adjustment.installation_id
       AND return_line.id = adjustment.customer_return_line_id
      JOIN sales.customer_return_receipt_lines receipt
        ON receipt.installation_id = adjustment.installation_id
       AND receipt.id = adjustment.customer_return_receipt_line_id
      LEFT JOIN latest_cost cost
        ON cost.inventory_movement_line_id = receipt.inventory_movement_line_id
     WHERE adjustment.installation_id = $1
       AND adjustment_document.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR adjustment_document.warehouse_id = $5::uuid)
       AND adjustment_document.document_type = 'CUSTOMER_RETURN_CREDIT'
       AND adjustment_document.status <> 'reversed'
       AND adjustment_document.source_document_date BETWEEN $3::date AND $4::date
  ), events AS (
    SELECT * FROM sales_events
    UNION ALL
    SELECT * FROM return_events
  ), classified AS (
    SELECT events.*,
           (currency_code = 'VND' AND cost_status = 'COSTED' AND cogs IS NOT NULL) AS comparable,
           CASE
             WHEN currency_code <> 'VND' THEN 'NON_VND_REVENUE'
             WHEN costing_movement_line_id IS NULL THEN 'MISSING_INVENTORY_LINEAGE'
             WHEN cost_status IS NULL THEN 'MISSING_COST_FACT'
             WHEN cost_status <> 'COSTED' OR cogs IS NULL THEN 'COST_ANOMALY'
             ELSE NULL
           END AS exception_code
      FROM events
  )`;

  const [summary, topCustomers, topSkus, lines, exceptions] = await Promise.all([
    adapter.query(
      `${eventsCte}
       SELECT count(*)::text AS event_line_count,
              count(*) FILTER (WHERE comparable)::text AS comparable_line_count,
              count(*) FILTER (WHERE exception_code = 'MISSING_INVENTORY_LINEAGE')::text AS missing_lineage_count,
              count(*) FILTER (WHERE exception_code = 'MISSING_COST_FACT')::text AS missing_cost_count,
              count(*) FILTER (WHERE exception_code = 'COST_ANOMALY')::text AS cost_anomaly_count,
              count(*) FILTER (WHERE exception_code = 'NON_VND_REVENUE')::text AS non_vnd_count,
              COALESCE(sum(net_revenue) FILTER (WHERE comparable), 0::numeric)::text AS net_revenue_vnd,
              COALESCE(sum(cogs) FILTER (WHERE comparable), 0::numeric)::text AS cogs_vnd,
              COALESCE(sum(net_revenue - cogs) FILTER (WHERE comparable), 0::numeric)::text AS gross_margin_vnd,
              CASE WHEN COALESCE(sum(net_revenue) FILTER (WHERE comparable), 0::numeric) = 0 THEN NULL
                   ELSE round(100 * sum(net_revenue - cogs) FILTER (WHERE comparable)
                              / sum(net_revenue) FILTER (WHERE comparable), 4)::text END AS gross_margin_percent,
              max(costing_completed_at) FILTER (WHERE comparable) AS costing_completed_at
         FROM classified`,
      params,
    ),
    adapter.query(
      `${eventsCte}
       SELECT customer_id, max(customer_code) AS customer_code, max(customer_name) AS customer_name,
              count(*)::text AS line_count,
              sum(net_revenue)::text AS net_revenue_vnd,
              sum(cogs)::text AS cogs_vnd,
              sum(net_revenue - cogs)::text AS gross_margin_vnd,
              CASE WHEN sum(net_revenue) = 0 THEN NULL
                   ELSE round(100 * sum(net_revenue - cogs) / sum(net_revenue), 4)::text END AS gross_margin_percent
         FROM classified
        WHERE comparable
        GROUP BY customer_id
        ORDER BY sum(net_revenue - cogs) DESC, max(customer_code)
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${eventsCte}
       SELECT variant_id, max(sku) AS sku, count(*)::text AS line_count,
              sum(net_revenue)::text AS net_revenue_vnd,
              sum(cogs)::text AS cogs_vnd,
              sum(net_revenue - cogs)::text AS gross_margin_vnd,
              CASE WHEN sum(net_revenue) = 0 THEN NULL
                   ELSE round(100 * sum(net_revenue - cogs) / sum(net_revenue), 4)::text END AS gross_margin_percent
         FROM classified
        WHERE comparable
        GROUP BY variant_id
        ORDER BY sum(net_revenue - cogs) DESC, max(sku)
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${eventsCte}
       SELECT event_kind, accounting_document_id, document_number, document_date::text,
              customer_id, customer_code, customer_name, warehouse_id, warehouse_code,
              variant_id, sku, currency_code, net_revenue::text,
              cogs::text, (net_revenue - cogs)::text AS gross_margin,
              rebuild_run_id, costing_completed_at, source_line_id, costing_movement_line_id
         FROM classified
        WHERE comparable
        ORDER BY document_date DESC, document_number, source_line_id
        LIMIT 100`,
      params,
    ),
    adapter.query(
      `${eventsCte}
       SELECT event_kind, accounting_document_id, document_number, document_date::text,
              customer_id, customer_code, customer_name, warehouse_id, warehouse_code,
              variant_id, sku, currency_code, net_revenue::text,
              exception_code, source_line_id, costing_movement_line_id
         FROM classified
        WHERE NOT comparable
        ORDER BY document_date DESC, document_number, source_line_id
        LIMIT 100`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'gross-margin',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, warehouseId: filters.warehouseId }),
    basis: Object.freeze({
      revenue: 'recognized receivable lines, net of line discount and excluding tax; received customer returns reverse net revenue proportionally',
      cogs: 'latest Phase 7 MWA_V1 cost fact by exact inventory movement line; OUT is sign-reversed into positive COGS and return IN becomes negative COGS',
      comparableCurrency: 'VND only; non-VND sales are surfaced as exceptions and never mixed with VND cost',
      lineage: 'receivable line -> delivery inventory issue line -> inventory movement line -> immutable cost fact; return credit -> return receipt movement line -> immutable cost fact',
    }),
    summary: mapRow(summary.rows?.[0] ?? {}),
    topCustomers: mapRows(topCustomers.rows),
    topSkus: mapRows(topSkus.rows),
    lines: mapRows(lines.rows),
    exceptions: mapRows(exceptions.rows),
  });
}
