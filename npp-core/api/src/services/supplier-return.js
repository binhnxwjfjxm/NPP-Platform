import * as core from './supplier-return-core.js';
import { postSupplierReturnPayable, reverseSourcePayable } from './payable.js';

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

function withPayableLink(result, payableResult) {
  if (!result?.ok || !result.supplierReturn) return result;
  return Object.freeze({
    ...result,
    supplierReturn: Object.freeze({
      ...result.supplierReturn,
      payableDocumentId: payableResult.payableDocument?.id ?? null,
    }),
    payableDocument: payableResult.payableDocument ?? null,
  });
}

export async function submitSupplierReturn(client, args) {
  await lockSourceGoodsReceipts(client, args.requestContext, args.id);
  return core.submitSupplierReturn(client, args);
}

export async function postSupplierReturn(client, args) {
  await lockSourceGoodsReceipts(client, args.requestContext, args.id);
  try {
    const result = await core.postSupplierReturn(client, args);
    if (!result.ok) return result;
    const payableResult = await postSupplierReturnPayable(client, {
      requestContext: args.requestContext,
      supplierReturnId: result.supplierReturn.id,
    });
    if (!payableResult.ok) return payableResult;
    return withPayableLink(result, payableResult);
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

export async function reverseSupplierReturn(client, args) {
  const result = await core.reverseSupplierReturn(client, args);
  if (!result.ok) return result;
  const payableResult = await reverseSourcePayable(client, {
    requestContext: args.requestContext,
    sourceDocumentType: 'SUPPLIER_RETURN',
    sourceDocumentId: result.supplierReturn.id,
    sourceRevision: result.supplierReturn.revision,
    reversedAt: result.supplierReturn.reversedAt,
    reversalReason: result.supplierReturn.reversalReason,
  });
  if (!payableResult.ok) return payableResult;
  return withPayableLink(result, payableResult);
}

export const listSupplierReturns = core.listSupplierReturns;
export const listSupplierReturnSourceLines = core.listSupplierReturnSourceLines;
export const getSupplierReturn = core.getSupplierReturn;
export const createSupplierReturn = core.createSupplierReturn;
export const updateSupplierReturn = core.updateSupplierReturn;
export const approveSupplierReturn = core.approveSupplierReturn;
export const cancelSupplierReturn = core.cancelSupplierReturn;
