import { NextRequest } from 'next/server';
import {
  createGoodsReceiptDraft,
  listGoodsReceipts,
} from '../../../lib/goods-receipt-gateway';
import {
  goodsReceiptErrorResponse,
  goodsReceiptIdempotencyKey,
  goodsReceiptRequestId,
  goodsReceiptResponse,
  readGoodsReceiptBody,
} from './_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = goodsReceiptRequestId(request);
  try {
    const data = await listGoodsReceipts<unknown>(requestId, {
      limit: request.nextUrl.searchParams.has('limit') ? Number(request.nextUrl.searchParams.get('limit')) : undefined,
      offset: request.nextUrl.searchParams.has('offset') ? Number(request.nextUrl.searchParams.get('offset')) : undefined,
      status: request.nextUrl.searchParams.get('status') || undefined,
      purchaseOrderId: request.nextUrl.searchParams.get('purchaseOrderId') || undefined,
      warehouseId: request.nextUrl.searchParams.get('warehouseId') || undefined,
      search: request.nextUrl.searchParams.get('search') || undefined,
    });
    return goodsReceiptResponse(data, requestId);
  } catch (error) {
    return goodsReceiptErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = goodsReceiptRequestId(request);
  const parsed = await readGoodsReceiptBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createGoodsReceiptDraft(
      requestId,
      parsed.body as never,
      goodsReceiptIdempotencyKey(request),
    );
    return goodsReceiptResponse(data, requestId, 201);
  } catch (error) {
    return goodsReceiptErrorResponse(error, requestId);
  }
}

