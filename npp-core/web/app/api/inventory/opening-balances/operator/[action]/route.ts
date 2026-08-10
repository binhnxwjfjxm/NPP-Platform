import { NextRequest, NextResponse } from 'next/server';
import {
  listOpeningBalanceOperatorLocations,
  listOpeningBalanceOperatorWarehouses,
  normalizeOpeningBalanceOperatorGatewayError,
  postOpeningBalanceOperator,
  resolveOpeningBalanceOperatorRequestId,
  validateOpeningBalanceOperator,
} from '../../../../../../../lib/opening-balance-operator-gateway';

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function success(data: unknown, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId }, { status, headers: headers(requestId) });
}

function failure(error: unknown, requestId: string) {
  const normalized = normalizeOpeningBalanceOperatorGatewayError(error);
  return NextResponse.json({
    error: {
      code: normalized.code,
      message: normalized.publicMessage,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    requestId,
  }, { status: normalized.statusCode, headers: headers(requestId) });
}

async function jsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { action: string } },
) {
  const requestId = resolveOpeningBalanceOperatorRequestId(request.headers.get('x-request-id'));
  try {
    if (params.action === 'warehouses') {
      return success(await listOpeningBalanceOperatorWarehouses(requestId), requestId);
    }
    if (params.action === 'locations') {
      return success(
        await listOpeningBalanceOperatorLocations(request.nextUrl.searchParams.get('warehouseId') ?? '', requestId),
        requestId,
      );
    }
    return NextResponse.json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Thao tác không hỗ trợ GET', retryable: false },
      requestId,
    }, { status: 405, headers: headers(requestId) });
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { action: string } },
) {
  const requestId = resolveOpeningBalanceOperatorRequestId(request.headers.get('x-request-id'));
  const body = await jsonBody(request);
  if (body === null) {
    return NextResponse.json({
      error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu gửi lên không hợp lệ', retryable: false },
      requestId,
    }, { status: 400, headers: headers(requestId) });
  }
  try {
    if (params.action === 'validate') {
      return success(await validateOpeningBalanceOperator(body, requestId), requestId);
    }
    if (params.action === 'post') {
      return success(
        await postOpeningBalanceOperator(body, requestId, request.headers.get('idempotency-key')),
        requestId,
      );
    }
    return NextResponse.json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Thao tác không hỗ trợ POST', retryable: false },
      requestId,
    }, { status: 405, headers: headers(requestId) });
  } catch (error) {
    return failure(error, requestId);
  }
}
