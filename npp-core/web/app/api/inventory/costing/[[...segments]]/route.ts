import { NextRequest, NextResponse } from 'next/server';
import {
  closeInventoryCostingPeriod,
  createInventoryCostAdjustment,
  getLatestInventoryCostingRun,
  listInventoryCostAdjustments,
  listInventoryCostAnomalies,
  listInventoryCostBalances,
  listInventoryCostDiscrepancies,
  listInventoryCostFacts,
  listInventoryCostingPeriods,
  listInventoryCostReconciliation,
  openInventoryCostingPeriod,
  rebuildInventoryCosting,
} from '../../../../../lib/inventory-costing-gateway';
import {
  errorResponse,
  readJsonBody,
  requestIdFrom,
  responseHeaders,
} from '../../_shared';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ segments?: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  const requestId = requestIdFrom(request);
  const { segments = [] } = await context.params;
  try {
    let data: unknown;
    if (segments.length === 1 && segments[0] === 'balances') {
      data = await listInventoryCostBalances<unknown>(requestId, request.nextUrl.searchParams);
    } else if (segments.length === 1 && segments[0] === 'facts') {
      data = await listInventoryCostFacts<unknown>(requestId, request.nextUrl.searchParams);
    } else if (segments.length === 1 && segments[0] === 'anomalies') {
      data = await listInventoryCostAnomalies<unknown>(requestId, request.nextUrl.searchParams);
    } else if (segments.length === 1 && segments[0] === 'reconciliation') {
      data = await listInventoryCostReconciliation<unknown>(requestId, request.nextUrl.searchParams);
    } else if (segments.length === 1 && segments[0] === 'run') {
      data = await getLatestInventoryCostingRun<unknown>(requestId);
    } else if (segments.length === 1 && segments[0] === 'periods') {
      data = await listInventoryCostingPeriods<unknown>(requestId);
    } else if (segments.length === 1 && segments[0] === 'adjustments') {
      data = await listInventoryCostAdjustments<unknown>(requestId);
    } else if (segments.length === 1 && segments[0] === 'discrepancies') {
      data = await listInventoryCostDiscrepancies<unknown>(requestId);
    } else {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn', retryable: false, details: {} }, requestId },
        { status: 404, headers: responseHeaders(requestId) },
      );
    }
    return NextResponse.json(
      { data, requestId },
      { status: 200, headers: responseHeaders(requestId) },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const requestId = requestIdFrom(request);
  const { segments = [] } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Dữ liệu giá vốn không hợp lệ', retryable: false, details: {} }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  const idempotencyKey = request.headers.get('idempotency-key');
  try {
    let data: unknown;
    if (segments.length === 1 && segments[0] === 'rebuild') {
      data = await rebuildInventoryCosting<unknown>(requestId, body, idempotencyKey);
    } else if (segments.length === 2 && segments[0] === 'periods' && segments[1] === 'open') {
      data = await openInventoryCostingPeriod<unknown>(requestId, body, idempotencyKey);
    } else if (segments.length === 2 && segments[0] === 'periods' && segments[1] === 'close') {
      data = await closeInventoryCostingPeriod<unknown>(requestId, body, idempotencyKey);
    } else if (segments.length === 1 && segments[0] === 'adjustments') {
      data = await createInventoryCostAdjustment<unknown>(requestId, body, idempotencyKey);
    } else {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn', retryable: false, details: {} }, requestId },
        { status: 404, headers: responseHeaders(requestId) },
      );
    }
    return NextResponse.json(
      { data, requestId },
      { status: 200, headers: responseHeaders(requestId) },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
