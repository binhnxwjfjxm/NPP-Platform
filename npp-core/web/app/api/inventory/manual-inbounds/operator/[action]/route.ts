import { NextRequest, NextResponse } from 'next/server';
import {
  listManualInboundOperatorLocations,
  listManualInboundOperatorWarehouses,
  normalizeManualInboundOperatorGatewayError,
  previewManualInboundOperator,
  resolveManualInboundOperatorRequestId,
} from '../../../../../../lib/manual-inbound-operator-gateway';

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function success(data: unknown, requestId: string) {
  return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
}

function failure(error: unknown, requestId: string) {
  const normalized = normalizeManualInboundOperatorGatewayError(error);
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
  const requestId = resolveManualInboundOperatorRequestId(request.headers.get('x-request-id'));
  try {
    if (params.action === 'warehouses') {
      return success(await listManualInboundOperatorWarehouses(requestId), requestId);
    }
    if (params.action === 'locations') {
      return success(
        await listManualInboundOperatorLocations(request.nextUrl.searchParams.get('warehouseId') ?? '', requestId),
        requestId,
      );
    }
    return NextResponse.json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Thao tác này không hỗ trợ tải dữ liệu', retryable: false },
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
  const requestId = resolveManualInboundOperatorRequestId(request.headers.get('x-request-id'));
  if (params.action !== 'preview') {
    return NextResponse.json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Thao tác này không hỗ trợ gửi dữ liệu', retryable: false },
      requestId,
    }, { status: 405, headers: headers(requestId) });
  }
  const body = await jsonBody(request);
  if (body === null) {
    return NextResponse.json({
      error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu gửi lên không hợp lệ', retryable: false },
      requestId,
    }, { status: 400, headers: headers(requestId) });
  }
  try {
    return success(await previewManualInboundOperator(body, requestId), requestId);
  } catch (error) {
    return failure(error, requestId);
  }
}
