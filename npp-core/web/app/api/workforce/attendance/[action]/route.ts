import { NextRequest, NextResponse } from 'next/server';
import {
  createAttendancePoint,
  createAttendanceQrToken,
  getAttendancePointManagement,
  getAttendanceToday,
  getManagedManualAttendanceEmployees,
  normalizeWorkforceGatewayError,
  recordAttendance,
  recordManagedManualAttendance,
  recordManagedManualAttendanceBulk,
  resolveWorkforceRequestId,
} from '../../../../../lib/workforce-gateway';

export const dynamic = 'force-dynamic';

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeWorkforceGatewayError(error);
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalized.publicMessage,
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    { status: normalized.statusCode, headers: headers(requestId) },
  );
}

export async function GET(request: NextRequest, { params }: { params: { action: string } }) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  try {
    const data = params.action === 'today'
      ? await getAttendanceToday<unknown>(requestId)
      : params.action === 'points'
        ? await getAttendancePointManagement<unknown>(requestId)
        : params.action === 'manual'
          ? await getManagedManualAttendanceEmployees<unknown>(
              requestId,
              request.nextUrl.searchParams.get('employeeId'),
            )
          : null;
    if (data === null) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Không tìm thấy chức năng chấm công', retryable: false }, requestId },
        { status: 404, headers: headers(requestId) },
      );
    }
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest, { params }: { params: { action: string } }) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId },
      { status: 400, headers: headers(requestId) },
    );
  }
  try {
    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;
    const data = params.action === 'record'
      ? await recordAttendance<unknown>(requestId, body, idempotencyKey)
      : params.action === 'points'
        ? await createAttendancePoint<unknown>(requestId, body, idempotencyKey)
        : params.action === 'qr-token'
          ? await createAttendanceQrToken<unknown>(requestId, body, idempotencyKey)
          : params.action === 'manual'
            ? await recordManagedManualAttendance<unknown>(requestId, body, idempotencyKey)
            : params.action === 'manual-bulk'
              ? await recordManagedManualAttendanceBulk<unknown>(requestId, body, idempotencyKey)
              : null;
    if (data === null) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Không tìm thấy chức năng chấm công', retryable: false }, requestId },
        { status: 404, headers: headers(requestId) },
      );
    }
    return NextResponse.json({ data, requestId }, { status: 201, headers: headers(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
