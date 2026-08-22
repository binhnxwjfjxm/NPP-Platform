import { BUSINESS_TIMEZONE, mapRow, mapRows } from './reporting-common.js';

const SALES_SCOPED_CTE = `
  WITH scoped AS (
    SELECT
      so.id,
      so.order_number,
      so.status,
      so.fulfillment_status,
      so.delivery_status,
      so.settlement_status,
      so.confirmed_at,
      so.warehouse_id,
      sov.id AS version_id,
      sov.currency_code,
      sov.total,
      sov.customer_id,
      sov.customer_code_snapshot,
      sov.customer_name_snapshot
    FROM sales.sales_orders so
    JOIN LATERAL (
      SELECT v.id, v.currency_code, v.total, v.customer_id,
             v.customer_code_snapshot, v.customer_name_snapshot
      FROM sales.sales_order_versions v
      WHERE v.installation_id = so.installation_id
        AND v.sales_order_id = so.id
        AND v.version_status IN ('confirmed','superseded')
      ORDER BY v.version_number DESC
      LIMIT 1
    ) sov ON true
    WHERE so.installation_id = $1
      AND so.warehouse_id = ANY($2::uuid[])
      AND so.confirmed_at >= $3::timestamptz
      AND so.confirmed_at < $4::timestamptz
      AND ($5::uuid IS NULL OR so.warehouse_id = $5::uuid)
  )`;

export async function salesReport(adapter, requestContext, filters, warehouseIds) {
  const params = [
    requestContext.installationId,
    warehouseIds,
    filters.fromInstant,
    filters.toExclusiveInstant,
    filters.warehouseId,
  ];

  const [summary, currencyTotals, statusBreakdown, dailyTrend, topEntities, topSkus, customers, documents] = await Promise.all([
    adapter.query(
      `${SALES_SCOPED_CTE}
       SELECT
         count(*)::text AS all_order_count,
         count(*) FILTER (WHERE status IN ('confirmed','closed'))::text AS effective_order_count,
         count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled_order_count
       FROM scoped`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE}
       SELECT
         currency_code,
         count(*)::text AS document_count,
         COALESCE(sum(total), 0::numeric)::text AS total_value
       FROM scoped
       WHERE status IN ('confirmed','closed')
       GROUP BY currency_code
       ORDER BY currency_code`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE}
       SELECT dimension, state, count(*)::text AS document_count
       FROM (
         SELECT 'order'::text AS dimension, status::text AS state FROM scoped
         UNION ALL
         SELECT 'fulfillment'::text, fulfillment_status::text FROM scoped
         UNION ALL
         SELECT 'delivery'::text, delivery_status::text FROM scoped
         UNION ALL
         SELECT 'settlement'::text, settlement_status::text FROM scoped
       ) states
       GROUP BY dimension, state
       ORDER BY dimension, state`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE}
       SELECT
         (confirmed_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date::text AS business_date,
         currency_code,
         count(*)::text AS document_count,
         COALESCE(sum(total), 0::numeric)::text AS total_value
       FROM scoped
       WHERE status IN ('confirmed','closed')
       GROUP BY business_date, currency_code
       ORDER BY business_date ASC, currency_code ASC`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE},
       grouped AS (
         SELECT
           currency_code,
           customer_id,
           (array_agg(customer_code_snapshot ORDER BY confirmed_at DESC, id DESC))[1] AS customer_code_snapshot,
           (array_agg(customer_name_snapshot ORDER BY confirmed_at DESC, id DESC))[1] AS customer_name_snapshot,
           count(*) AS document_count,
           COALESCE(sum(total), 0::numeric) AS total_value
         FROM scoped
         WHERE status IN ('confirmed','closed')
         GROUP BY currency_code, customer_id
       ),
       ranked AS (
         SELECT grouped.*,
                row_number() OVER (
                  PARTITION BY currency_code
                  ORDER BY total_value DESC, customer_code_snapshot ASC
                ) AS rank
         FROM grouped
       )
       SELECT
         currency_code,
         customer_id AS entity_id,
         customer_code_snapshot AS entity_code,
         customer_name_snapshot AS entity_name,
         document_count::text,
         total_value::text
       FROM ranked
       WHERE rank <= 10
       ORDER BY currency_code, rank`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE},
       grouped AS (
         SELECT
           scoped.currency_code,
           sovl.variant_id,
           (array_agg(sovl.sku_snapshot ORDER BY scoped.confirmed_at DESC, scoped.id DESC))[1] AS sku_snapshot,
           (array_agg(sovl.item_name_snapshot ORDER BY scoped.confirmed_at DESC, scoped.id DESC))[1] AS item_name_snapshot,
           COALESCE(sum(sovl.base_quantity), 0::numeric) AS base_quantity,
           COALESCE(sum(sovl.line_total), 0::numeric) AS total_value,
           (array_agg(
             COALESCE(scoped.order_number, scoped.id::text)
             ORDER BY scoped.confirmed_at DESC, scoped.id DESC
           ))[1] AS sample_document_number
         FROM scoped
         JOIN sales.sales_order_version_lines sovl
           ON sovl.installation_id = $1
          AND sovl.sales_order_version_id = scoped.version_id
         WHERE scoped.status IN ('confirmed','closed')
         GROUP BY scoped.currency_code, sovl.variant_id
       ),
       ranked AS (
         SELECT grouped.*,
                row_number() OVER (
                  PARTITION BY currency_code
                  ORDER BY total_value DESC, sku_snapshot ASC
                ) AS rank
         FROM grouped
       )
       SELECT
         currency_code,
         variant_id,
         sku_snapshot AS sku,
         item_name_snapshot AS item_name,
         base_quantity::text,
         total_value::text,
         sample_document_number
       FROM ranked
       WHERE rank <= 10
       ORDER BY currency_code, rank`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE}
       SELECT
         currency_code,
         customer_id,
         (array_agg(customer_code_snapshot ORDER BY confirmed_at DESC, id DESC))[1] AS customer_code,
         (array_agg(customer_name_snapshot ORDER BY confirmed_at DESC, id DESC))[1] AS customer_name,
         count(*)::text AS document_count,
         COALESCE(sum(total), 0::numeric)::text AS total_value
       FROM scoped
       WHERE status IN ('confirmed','closed')
       GROUP BY currency_code, customer_id
       ORDER BY COALESCE(sum(total), 0::numeric) DESC,
                (array_agg(customer_code_snapshot ORDER BY confirmed_at DESC, id DESC))[1] NULLS LAST,
                customer_id NULLS LAST
       LIMIT 100`,
      params,
    ),
    adapter.query(
      `${SALES_SCOPED_CTE}
       SELECT
         id AS sales_order_id,
         order_number,
         status,
         fulfillment_status,
         delivery_status,
         settlement_status,
         confirmed_at,
         warehouse_id,
         currency_code,
         total::text AS total_value,
         customer_id,
         customer_code_snapshot AS customer_code,
         customer_name_snapshot AS customer_name
       FROM scoped
       WHERE status IN ('confirmed','closed')
       ORDER BY confirmed_at DESC, id DESC
       LIMIT 200`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'sales',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, warehouseId: filters.warehouseId }),
    basis: Object.freeze({
      date: 'sales.sales_orders.confirmed_at',
      value: 'latest confirmed/superseded sales_order_version total; draft amendments excluded',
      effectiveStates: Object.freeze(['confirmed', 'closed']),
    }),
    summary: mapRow(summary.rows?.[0] ?? {}),
    currencyTotals: mapRows(currencyTotals.rows),
    statusBreakdown: mapRows(statusBreakdown.rows),
    dailyTrend: mapRows(dailyTrend.rows),
    topEntities: mapRows(topEntities.rows),
    topSkus: mapRows(topSkus.rows),
    customers: mapRows(customers.rows),
    documents: mapRows(documents.rows),
  });
}
