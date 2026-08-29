import { NextRequest, NextResponse } from 'next/server';
import { CompanyGatewayError, companyRequest } from '../../../../../lib/company-gateway';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestId(request: NextRequest) {
  return request.headers.get('x-request-id') ?? crypto.randomUUID();
}

function json(data: unknown, id: string, status = 200) {
  return NextResponse.json({ data, requestId: id }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'x-request-id': id },
  });
}

function errorResponse(error: unknown, id: string) {
  const normalized = error instanceof CompanyGatewayError
    ? error
    : new CompanyGatewayError('RETAIL_PRINT_AGENT_UNAVAILABLE', 'Retail Print tạm thời chưa sẵn sàng', 503, true);
  return NextResponse.json({
    error: {
      code: normalized.code,
      message: normalized.publicMessage,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    requestId: id,
  }, {
    status: normalized.statusCode,
    headers: { 'Cache-Control': 'no-store', 'x-request-id': id },
  });
}

async function body(request: NextRequest) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new CompanyGatewayError('INVALID_INPUT', 'Nội dung yêu cầu không hợp lệ', 400, false);
  }
}

function parts(params: { segments: string[] }) {
  return params.segments.map((part) => String(part));
}

export async function GET(request: NextRequest, { params }: { params: { segments: string[] } }) {
  const id = requestId(request);
  const path = parts(params);
  try {
    if (path.length === 1 && path[0] === 'status') {
      const result = await companyRequest<unknown>({ path: '/api/retail/print-agent/status', requestId: id });
      return json(result.data, result.requestId);
    }
    throw new CompanyGatewayError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', 404, false);
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function POST(request: NextRequest, { params }: { params: { segments: string[] } }) {
  const id = requestId(request);
  const path = parts(params);
  try {
    if (path.length === 1 && path[0] === 'pair') {
      const result = await companyRequest<unknown>({
        path: '/api/retail/print-agent/pair',
        method: 'POST',
        body: await body(request),
        requestId: id,
      });
      return json(result.data, result.requestId);
    }

    if (path.length === 3 && path[0] === 'agents' && path[2] === 'jobs') {
      const agentId = path[1];
      if (!UUID_PATTERN.test(agentId)) {
        throw new CompanyGatewayError('INVALID_PRINT_AGENT_ID', 'Mã Retail Print không hợp lệ', 400, false);
      }
      const key = request.headers.get('idempotency-key');
      if (!key) {
        throw new CompanyGatewayError('MISSING_IDEMPOTENCY_KEY', 'Thiếu khóa chống gửi lệnh in trùng', 400, false);
      }
      const result = await companyRequest<unknown>({
        path: `/api/retail/print-agent/agents/${agentId}/jobs`,
        method: 'POST',
        body: await body(request),
        idempotencyKey: key,
        requestId: id,
      });
      return json(result.data, result.requestId, 202);
    }

    throw new CompanyGatewayError('NOT_FOUND', 'Không tìm thấy thao tác yêu cầu', 404, false);
  } catch (error) {
    return errorResponse(error, id);
  }
}
