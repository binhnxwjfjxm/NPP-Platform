import { listFulfillmentOrderTotals } from '../db/repositories/fulfillment-order-summary.js';

function mergeOrderTotals(work, rows) {
  const totalsByVersion = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      row.sales_order_version_id,
      row.order_total === null || row.order_total === undefined ? null : String(row.order_total),
    ]),
  );
  return (Array.isArray(work) ? work : []).map((item) => Object.freeze({
    ...item,
    orderTotal: totalsByVersion.get(item.salesOrderVersionId) ?? null,
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
