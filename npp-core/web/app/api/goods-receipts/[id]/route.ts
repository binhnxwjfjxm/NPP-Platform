import { NextRequest } from 'next/server';
import {
  getGoodsReceipt,
  patchGoodsReceiptDraft,
} from '../../../../lib/goods-receipt-gateway';
import {
  goodsReceiptErrorResponse,
  goodsReceiptIdempotencyKey,
  goodsReceiptRequestId,
  goodsReceiptResponse,
  readGoodsReceiptBody,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = goodsReceiptRequestId(request);
  try {
    return goodsReceiptResponse(
      await getGoodsReceipt<unknown>(params.id, requestId),
      requestId,
    );
  } catch (error) {
    return goodsReceiptErrorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = goodsReceiptRequestId(request);
  const parsed = await readGoodsReceiptBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return goodsReceiptResponse(
      await patchGoodsReceiptDraft<unknown>(
        params.id,
        requestId,
        parsed.body,
        goodsReceiptIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return goodsReceiptErrorResponse(error, requestId);
  }
}

