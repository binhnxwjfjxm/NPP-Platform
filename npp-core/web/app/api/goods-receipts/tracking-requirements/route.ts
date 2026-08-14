import { NextRequest } from 'next/server';
import { getGoodsReceiptTrackingRequirements } from '../../../../lib/goods-receipt-gateway';
import {
  goodsReceiptErrorResponse,
  goodsReceiptRequestId,
  goodsReceiptResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = goodsReceiptRequestId(request);
  try {
    const data = await getGoodsReceiptTrackingRequirements<unknown>(
      request.nextUrl.searchParams.get('purchaseOrderId') || '',
      requestId,
    );
    return goodsReceiptResponse(data, requestId);
  } catch (error) {
    return goodsReceiptErrorResponse(error, requestId);
  }
}
