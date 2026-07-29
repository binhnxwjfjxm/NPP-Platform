import * as core from './goods-receipt-core.js';
import { postGoodsReceiptPayable, reverseSourcePayable } from './payable.js';

function withPayableLink(result, payableResult) {
  if (!result?.ok || !result.goodsReceipt) return result;
  return Object.freeze({
    ...result,
    goodsReceipt: Object.freeze({
      ...result.goodsReceipt,
      payableDocumentId: payableResult.payableDocument?.id ?? null,
    }),
    payableDocument: payableResult.payableDocument ?? null,
  });
}

export * from './goods-receipt-core.js';

export async function postGoodsReceipt(client, args) {
  const result = await core.postGoodsReceipt(client, args);
  if (!result.ok) return result;
  const payableResult = await postGoodsReceiptPayable(client, {
    requestContext: args.requestContext,
    goodsReceiptId: result.goodsReceipt.id,
  });
  if (!payableResult.ok) return payableResult;
  return withPayableLink(result, payableResult);
}

export async function reverseGoodsReceipt(client, args) {
  const result = await core.reverseGoodsReceipt(client, args);
  if (!result.ok) return result;
  const payableResult = await reverseSourcePayable(client, {
    requestContext: args.requestContext,
    sourceDocumentType: 'GOODS_RECEIPT',
    sourceDocumentId: result.goodsReceipt.id,
    sourceRevision: result.goodsReceipt.revision,
    reversedAt: result.goodsReceipt.reversedAt,
    reversalReason: result.goodsReceipt.reversalReason,
  });
  if (!payableResult.ok) return payableResult;
  return withPayableLink(result, payableResult);
}
