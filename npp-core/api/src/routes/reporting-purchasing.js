import { BUSINESS_TIMEZONE, mapRow, mapRows } from './reporting-common.js';

const PURCHASE_SCOPED_CTE = `
  WITH scoped AS (
    SELECT
      po.id,
      po.document_number,
      po.status,
      po.order_date,
      po.created_at,
      po.warehouse_id,
      po.currency_code,
      po.total,
      po.supplier_id,
      s.code AS supplier_code,
      s.name AS supplier_name
    FROM purchasing.purchase_orders po
    JOIN shared.suppliers s
      ON s.installation_id = po.installation_id
     AND s.id = po.supplier_id
    WHERE po.installation_id = $1
      AND po.warehouse_id = ANY($2::uuid[])
      AND po.order_date >= $3::date
      AND po.order_date <= $4::date
      AND ($5::uuid IS NULL OR po.warehouse_id = $5::uuid)
  )`;

const RECEIPT_SCOPED_CTE = `
  receipt_scoped AS (
    SELECT gr.id, gr.status, gr.receipt_date, gr.warehouse_id
    FROM purchasing.goods_receipts gr
    WHERE gr.installation_id = $1
      AND gr.warehouse_id = ANY($2::uuid[])
      AND gr.receipt_date >= $3::date
      AND gr.receipt_date <= $4::date
      AND ($5::uuid IS NULL OR gr.warehouse_id = $5::uuid)
  )`;


export async function purchasingReport(adapter, requestContext, filters, warehouseIds) {
  const params = [
    requestContext.installationId,
    warehouseIds,
    filters.from,
    filters.to,
    filters.warehouseId,
  ];
  const effective = "('approved','partially_received','fully_received','closed')";

  const [summary, currencyTotals, statusBreakdown, dailyTrend, topEntities, topSkus, receiptSummary] = await Promise.all([
    adapter.query(
      `${PURCHASE_SCOPED_CTE}
       SELECT
         count(*)::text AS all_order_count,
         count(*) FILTER (WHERE status IN ${effective})::text AS effective_order_count,
         count(*) FILTER (WHERE status = 'pending_approval')::text AS pending_approval_count,
         count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled_order_count
       FROM scoped`,
      params,
    ),
    adapter.query(
      `${PURCHASE_SCOPED_CTE}
       SELECT
         currency_code,
         count(*)::text AS document_count,
         COALESCE(sum(total), 0::numeric)::text AS total_value
       FROM scoped
       WHERE status IN ${effective}
       GROUP BY currency_code
       ORDER BY currency_code`,
      params,
    ),
    adapter.query(
      `${PURCHASE_SCOPED_CTE},
       ${RECEIPT_SCOPED_CTE}
       SELECT dimension, state, count(*)::text AS document_count
       FROM (
         SELECT 'purchase_order'::text AS dimension, status::text AS state FROM scoped
         UNION ALL
         SELECT 'goods_receipt'::text, status::text FROM receipt_scoped
       ) states
       GROUP BY dimension, state
       ORDER BY dimension, state`,
      params,
    ),
    adapter.query(
      `${PURCHASE_SCOPED_CTE}
       SELECT
         order_date::text AS business_date,
         currency_code,
         count(*)::text AS document_count,
         COALESCE(sum(total), 0::numeric)::text AS total_value
       FROM scoped
       WHERE status IN ${effective}
       GROUP BY order_date, currency_code
       ORDER BY order_date ASC, currency_code ASC`,
      params,
    ),
    adapter.query(
      `${PURCHASE_SCOPED_CTE},
       grouped AS (
         SELECT
           currency_code,
           supplier_id,
           supplier_code,
           supplier_name,
           count(*) AS document_count,
           COALESCE(sum(total), 0::numeric) AS total_value
         FROM scoped
         WHERE status IN ${effective}
         GROUP BY currency_code, supplier_id, supplier_code, supplier_name
       ),
       ranked AS (
         SELECT grouped.*,
                row_number() OVER (
                  PARTITION BY currency_code
                  ORDER BY total_value DESC, supplier_code ASC
                ) AS rank
         FROM grouped
       )
       SELECT
         currency_code,
         supplier_id AS entity_id,
         supplier_code AS entity_code,
         supplier_name AS entity_name,
         document_count::text,
         total_value::text
       FROM ranked
       WHERE rank <= 10
       ORDER BY currency_code, rank`,
      params,
    ),
    adapter.query(
      `${PURCHASE_SCOPED_CTE},
       grouped AS (
         SELECT
           scoped.currency_code,
           pol.variant_id,
           pol.sku_snapshot,
           pol.item_name_snapshot,
           COALESCE(sum(pol.base_quantity), 0::numeric) AS base_quantity,
           COALESCE(sum(pol.line_total), 0::numeric) AS total_value,
           (array_agg(
             COALESCE(scoped.document_number, scoped.id::text)
             ORDER BY scoped.order_date DESC, scoped.created_at DESC
           ))[1] AS sample_document_number
         FROM scoped
         JOIN purchasing.purchase_order_lines pol
           ON pol.installation_id = $1
          AND pol.purchase_order_id = scoped.id
         WHERE scoped.status IN ${effective}
         GROUP BY scoped.currency_code, pol.variant_id, pol.sku_snapshot, pol.item_name_snapshot
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
      `WITH ${RECEIPT_SCOPED_CTE}
       SELECT
         count(*) FILTER (WHERE status = 'posted')::text AS posted_receipt_count,
         count(*) FILTER (WHERE status = 'reversed')::text AS reversed_receipt_count
       FROM receipt_scoped`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'purchasing',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    filters: Object.freeze({ from: filters.from, to: filters.to, warehouseId: filters.warehouseId }),
    basis: Object.freeze({
      date: 'purchasing.purchase_orders.order_date; goods receipts use receipt_date',
      value: 'purchasing.purchase_orders.total',
      effectiveStates: Object.freeze(['approved', 'partially_received', 'fully_received', 'closed']),
    }),
    summary: Object.freeze({
      ...mapRow(summary.rows?.[0] ?? {}),
      ...mapRow(receiptSummary.rows?.[0] ?? {}),
    }),
    currencyTotals: mapRows(currencyTotals.rows),
    statusBreakdown: mapRows(statusBreakdown.rows),
    dailyTrend: mapRows(dailyTrend.rows),
    topEntities: mapRows(topEntities.rows),
    topSkus: mapRows(topSkus.rows),
  });
}
