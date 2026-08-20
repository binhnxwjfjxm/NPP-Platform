import { NextRequest, NextResponse } from 'next/server';
import { CompanyGatewayError, companyRequest } from '../../../../lib/company-gateway';

export const dynamic = 'force-dynamic';

type GatewayResponse = { data: unknown; requestId: string };

function requestId(request: NextRequest) {
  return request.headers.get('x-request-id');
}

function json(data: unknown, id: string, status = 200) {
  return NextResponse.json({ data, requestId: id }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': id } });
}

function errorResponse(error: unknown, id: string) {
  const normalized = error instanceof CompanyGatewayError
    ? error
    : new CompanyGatewayError('RETAIL_GATEWAY_UNAVAILABLE', 'Chức năng bán tại quầy tạm thời chưa sẵn sàng', 503, true);
  return NextResponse.json({
    error: {
      code: normalized.code,
      message: normalized.publicMessage,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    requestId: id,
  }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': id } });
}

function query(request: NextRequest, allowed: string[]) {
  const next = new URLSearchParams();
  for (const key of allowed) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null && value.length <= 256) next.set(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

async function body(request: NextRequest) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new CompanyGatewayError('INVALID_INPUT', 'Nội dung yêu cầu không hợp lệ', 400, false);
  }
}

async function bootstrap(id: string): Promise<GatewayResponse> {
  const [settings, warehouses, customers, orders, categories] = await Promise.all([
    companyRequest<unknown>({ path: '/api/sales-orders/entry-settings', requestId: id }),
    companyRequest<unknown>({ path: '/api/warehouses?active=true&limit=200', requestId: id }),
    companyRequest<unknown>({ path: '/api/customers?active=true&limit=200', requestId: id }).catch(() => ({ data: [] })),
    companyRequest<unknown>({ path: '/api/sales-orders?limit=100', requestId: id }).catch(() => ({ data: [] })),
    companyRequest<unknown>({ path: '/api/product-categories?active=true&limit=200', requestId: id }).catch(() => ({ data: [] })),
  ]);
  return {
    data: { settings: settings.data, warehouses: warehouses.data, customers: customers.data, orders: orders.data, categories: categories.data },
    requestId: settings.requestId,
  };
}

function parts(params: { segments: string[] }) {
  return params.segments.map((part) => decodeURIComponent(part));
}

export async function GET(request: NextRequest, { params }: { params: { segments: string[] } }) {
  const id = requestId(request) ?? crypto.randomUUID();
  const path = parts(params);
  try {
    if (path.length === 1 && path[0] === 'bootstrap') {
      const result = await bootstrap(id);
      return json(result.data, result.requestId);
    }
    if (path.length === 1 && path[0] === 'products') {
      const result = await companyRequest<unknown>({
        path: `/api/retail/products${query(request, ['search', 'categoryId', 'limit', 'offset'])}`,
        requestId: id,
      });
      return json(result.data, result.requestId);
    }
    if (path.length === 1 && path[0] === 'orders') {
      const result = await companyRequest<unknown>({ path: `/api/sales-orders${query(request, ['limit', 'offset', 'status', 'search'])}`, requestId: id });
      return json(result.data, result.requestId);
    }
    if (path.length === 2 && path[0] === 'orders') {
      const result = await companyRequest<unknown>({ path: `/api/sales-orders/${path[1]}`, requestId: id });
      return json(result.data, result.requestId);
    }
    if (path.length === 3 && path[0] === 'orders' && path[2] === 'availability') {
      const result = await companyRequest<unknown>({ path: `/api/retail/sales-orders/${path[1]}/availability`, requestId: id });
      return json(result.data, result.requestId);
    }
    throw new CompanyGatewayError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', 404, false);
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function POST(request: NextRequest, { params }: { params: { segments: string[] } }) {
  const id = requestId(request) ?? crypto.randomUUID();
  const path = parts(params);
  try {
    const payload = await body(request);
    const key = request.headers.get('idempotency-key');
    if (path.length === 1 && path[0] === 'orders') {
      const result = await companyRequest<unknown>({ path: '/api/sales-orders', method: 'POST', body: payload, idempotencyKey: key, requestId: id });
      return json(result.data, result.requestId, 201);
    }
    if (path.length === 1 && path[0] === 'price') {
      const result = await companyRequest<unknown>({ path: '/api/pricing/resolve', method: 'POST', body: payload, requestId: id });
      return json(result.data, result.requestId);
    }
    if (path.length === 3 && path[0] === 'orders') {
      const action = path[2];
      const mapping: Record<string, { path: string; body: Record<string, unknown> }> = {
        confirm: { path: `/api/sales-orders/${path[1]}/confirm`, body: {} },
        'issue-stock': { path: `/api/sales-orders/${path[1]}/issue-stock`, body: { ...payload, mode: 'PICKUP' } },
        complete: { path: `/api/pickup-sales-orders/${path[1]}/complete`, body: payload },
        settlement: { path: `/api/pickup-sales-orders/${path[1]}/settlement`, body: payload },
      };
      const target = mapping[action];
      if (!target) throw new CompanyGatewayError('NOT_FOUND', 'Không tìm thấy thao tác yêu cầu', 404, false);
      const result = await companyRequest<unknown>({ path: target.path, method: 'POST', body: target.body, idempotencyKey: key, requestId: id });
      return json(result.data, result.requestId);
    }
    throw new CompanyGatewayError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', 404, false);
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function PUT(request: NextRequest, { params }: { params: { segments: string[] } }) {
  const id = requestId(request) ?? crypto.randomUUID();
  const path = parts(params);
  try {
    if (path.length !== 3 || path[0] !== 'orders' || path[2] !== 'draft') {
      throw new CompanyGatewayError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', 404, false);
    }
    const result = await companyRequest<unknown>({
      path: `/api/sales-orders/${path[1]}/draft`,
      method: 'PUT',
      body: await body(request),
      idempotencyKey: request.headers.get('idempotency-key'),
      requestId: id,
    });
    return json(result.data, result.requestId);
  } catch (error) {
    return errorResponse(error, id);
  }
}
