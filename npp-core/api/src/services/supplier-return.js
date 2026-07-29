import * as core from './supplier-return-core.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

async function lockSourceGoodsReceipts(client, requestContext, supplierReturnId) {
  if (typeof supplierReturnId !== 'string' || !UUID_PATTERN.test(supplierReturnId.trim())) return;
  await client.query(
    `SELECT gr.id
       FROM purchasing.goods_receipts gr
      WHERE gr.installation_id = $1
        AND gr.id IN (
          SELECT DISTINCT line.source_goods_receipt_id
            FROM purchasing.supplier_return_lines line
           WHERE line.installation_id = $1
             AND line.supplier_return_id = $2::uuid
        )
      ORDER BY gr.id
      FOR UPDATE`,
    [requestContext.installationId, supplierReturnId.trim()],
  );
}

export async function submitSupplierReturn(client, args) {
  await lockSourceGoodsReceipts(client, args.requestContext, args.id);
  return core.submitSupplierReturn(client, args);
}

export async function postSupplierReturn(client, args) {
  await lockSourceGoodsReceipts(client, args.requestContext, args.id);
  try {
    return await core.postSupplierReturn(client, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('inventory_negative_stock_denied')) {
      return failure(
        'INSUFFICIENT_STOCK_CONFLICT',
        'Insufficient unreserved stock for the supplier return',
        false,
      );
    }
    throw error;
  }
}

export const listSupplierReturns = core.listSupplierReturns;
export const listSupplierReturnSourceLines = core.listSupplierReturnSourceLines;
export const getSupplierReturn = core.getSupplierReturn;
export const createSupplierReturn = core.createSupplierReturn;
export const updateSupplierReturn = core.updateSupplierReturn;
export const approveSupplierReturn = core.approveSupplierReturn;
export const cancelSupplierReturn = core.cancelSupplierReturn;
export const reverseSupplierReturn = core.reverseSupplierReturn;
