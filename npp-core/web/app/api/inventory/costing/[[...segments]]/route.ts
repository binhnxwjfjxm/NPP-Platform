import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestInventoryCostingRun,
  listInventoryCostAnomalies,
  listInventoryCostBalances,
  listInventoryCostFacts,
  listInventoryCostReconciliation,
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
      data = await listInventoryCostBalances<unknown>(
        requestId,
        request.nextUrl.searchParams,
      );
    } else if (segments.length === 1 && segments[0] === 'facts') {
      data = await listInventoryCostFacts<unknown>(
        requestId,
        request.nextUrl.searchParams,
      );
    } else if (segments.length === 1 && segments[0] === 'anomalies') {
      data = await listInventoryCostAnomalies<unknown>(
        requestId,
        request.nextUrl.searchParams,
      );
    } else if (segments.length === 1 && segments[0] === 'reconciliation') {
      data = await listInventoryCostReconciliation<unknown>(
        requestId,
        request.nextUrl.searchParams,
      );
    } else if (segments.length === 1 && segments[0] === 'run') {
      data = await getLatestInventoryCostingRun<unknown>(requestId);
    } else {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Không tìm thấy đường dẫn',
            retryable: false,
            details: {},
          },
          requestId,
        },
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
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Dữ liệu dựng lại giá vốn không hợp lệ',
          retryable: false,
          details: {},
        },
        requestId,
      },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  if (segments.length !== 1 || segments[0] !== 'rebuild') {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Không tìm thấy đường dẫn',
          retryable: false,
          details: {},
        },
        requestId,
      },
      { status: 404, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await rebuildInventoryCosting<unknown>(
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json(
      { data, requestId },
      { status: 200, headers: responseHeaders(requestId) },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
