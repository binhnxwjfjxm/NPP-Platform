import { listFulfillmentOrderTotals } from '../db/repositories/fulfillment-order-summary.js';

function mergeOrderTotals(work, rows) {
  const summariesByVersion = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      row.sales_order_version_id,
      {
        orderSubtotal: row.order_subtotal === null || row.order_subtotal === undefined
          ? null
          : String(row.order_subtotal),
        orderDiscountTotal: row.order_discount_total === null || row.order_discount_total === undefined
          ? null
          : String(row.order_discount_total),
        orderTaxTotal: row.order_tax_total === null || row.order_tax_total === undefined
          ? null
          : String(row.order_tax_total),
        orderTotal: row.order_total === null || row.order_total === undefined
          ? null
          : String(row.order_total),
        salesChannelCode: row.sales_channel_code_snapshot ?? null,
        salesChannelName: row.sales_channel_name_snapshot ?? null,
      },
    ]),
  );
  return (Array.isArray(work) ? work : []).map((item) => Object.freeze({
    ...item,
    ...(summariesByVersion.get(item.salesOrderVersionId) ?? {
      orderSubtotal: null,
      orderDiscountTotal: null,
      orderTaxTotal: null,
      orderTotal: null,
      salesChannelCode: null,
      salesChannelName: null,
    }),
  }));
}

export async function attachFulfillmentOrderTotals(adapter, { requestContext, work }) {
  if (!Array.isArray(work) || work.length === 0) return [];
  const rows = await listFulfillmentOrderTotals(adapter, {
    installationId: requestContext.installationId,
    salesOrderVersionIds: work.map((item) => item.salesOrderVersionId),
  });
  return mergeOrderTotals(work, rows);
}

export const fulfillmentOrderSummaryInternals = Object.freeze({ mergeOrderTotals });
