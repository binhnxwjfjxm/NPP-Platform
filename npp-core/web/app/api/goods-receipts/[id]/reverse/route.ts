import { NextRequest } from 'next/server';
import {
  reverseGoodsReceipt,
} from '../../../../../lib/goods-receipt-gateway';
import {
  goodsReceiptErrorResponse,
  goodsReceiptIdempotencyKey,
  goodsReceiptRequestId,
  goodsReceiptResponse,
  readGoodsReceiptBody,
} from '../../_route-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = goodsReceiptRequestId(request);
  const parsed = await readGoodsReceiptBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return goodsReceiptResponse(
      await reverseGoodsReceipt<unknown>(
        params.id,
        requestId,
        goodsReceiptIdempotencyKey(request),
        parsed.body,
      ),
      requestId,
    );
  } catch (error) {
    return goodsReceiptErrorResponse(error, requestId);
  }
}

