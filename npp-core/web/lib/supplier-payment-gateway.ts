import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupplierPaymentDraft } from './supplier-payment-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['limit','offset','status','supplierId','warehouseId','currencyCode','search']);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

export class SupplierPaymentGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'SupplierPaymentGatewayError';
  }
}

export function resolveSupplierPaymentRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeSupplierPaymentGatewayError(error: unknown): SupplierPaymentGatewayError {
  if (error instanceof SupplierPaymentGatewayError) return error;
  return new SupplierPaymentGatewayError(
    'SUPPLIER_PAYMENT_GATEWAY_UNAVAILABLE',
    'Thanh toán nhà cung cấp tạm thời chưa khả dụng',
    503,
    true,
  );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SupplierPaymentGatewayError(
      'SUPPLIER_PAYMENT_GATEWAY_NOT_CONFIGURED',
      'Thanh toán nhà cung cấp chưa được cấu hình',
      503,
      false,
    );
  }
  return value;
}

function coreApiBaseUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new SupplierPaymentGatewayError('SUPPLIER_PAYMENT_GATEWAY_NOT_CONFIGURED','Thanh toán nhà cung cấp chưa được cấu hình',503,false);
  }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SupplierPaymentGatewayError('SUPPLIER_PAYMENT_GATEWAY_NOT_CONFIGURED','Thanh toán nhà cung cấp chưa được cấu hình',503,false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new SupplierPaymentGatewayError('SUPPLIER_PAYMENT_GATEWAY_NOT_CONFIGURED','Thanh toán nhà cung cấp chưa được cấu hình',503,false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/,'');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/,'');
}

function assertUuid(value: string, code: string, message: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) throw new SupplierPaymentGatewayError(code,message,400,false);
  return normalized;
}

function assertIdempotencyKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new SupplierPaymentGatewayError('INVALID_IDEMPOTENCY_KEY','Khóa chống trùng yêu cầu không hợp lệ',400,false);
  }
  return normalized;
}

function safeQuery(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key,value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(key) && value.length <= 256) next.append(key,value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

async function requestCore<T>({
  method,
  path,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST';
  path: string;
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}${path}${searchParams ? safeQuery(searchParams) : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new SupplierPaymentGatewayError('SUPPLIER_PAYMENT_GATEWAY_RESPONSE_INVALID','Phản hồi thanh toán nhà cung cấp không hợp lệ',502,false);
    }
    if (!response.ok) {
      throw new SupplierPaymentGatewayError(
        payload.error?.code || 'SUPPLIER_PAYMENT_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu thanh toán nhà cung cấp không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload,'data')) {
      throw new SupplierPaymentGatewayError('SUPPLIER_PAYMENT_GATEWAY_RESPONSE_INVALID','Phản hồi thanh toán nhà cung cấp không hợp lệ',502,false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof SupplierPaymentGatewayError) throw error;
    throw new SupplierPaymentGatewayError('SUPPLIER_PAYMENT_GATEWAY_UNAVAILABLE','Thanh toán nhà cung cấp tạm thời chưa khả dụng',503,true);
  } finally {
    clearTimeout(timeout);
  }
}

function queryFrom(params?: Record<string,string | number | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key,value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key,String(value));
  }
  return query;
}

export function listSupplierPayments<T>(requestId: string, params?: Record<string,string | number | undefined>): Promise<T[]> {
  return requestCore<T[]>({ method:'GET',path:'/api/supplier-payments',requestId,searchParams:queryFrom(params) });
}

export function getSupplierPayment<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ method:'GET',path:`/api/supplier-payments/${assertUuid(id,'INVALID_SUPPLIER_PAYMENT_ID','Mã phiếu thanh toán không hợp lệ')}`,requestId });
}

export function listSupplierPaymentTargets<T>(requestId: string, params?: Record<string,string | number | undefined>): Promise<T[]> {
  return requestCore<T[]>({ method:'GET',path:'/api/supplier-payments/allocation-targets',requestId,searchParams:queryFrom(params) });
}

export function createSupplierPayment<T>(requestId: string, body: SupplierPaymentDraft, idempotencyKey: string): Promise<T> {
  return requestCore<T>({ method:'POST',path:'/api/supplier-payments',requestId,body,idempotencyKey:assertIdempotencyKey(idempotencyKey) });
}

export function reverseSupplierPayment<T>(id: string, requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({
    method:'POST',
    path:`/api/supplier-payments/${assertUuid(id,'INVALID_SUPPLIER_PAYMENT_ID','Mã phiếu thanh toán không hợp lệ')}/reverse`,
    requestId,
    body,
    idempotencyKey:assertIdempotencyKey(idempotencyKey),
  });
}

export function createPayableAllocation<T>(requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({ method:'POST',path:'/api/payable-allocations',requestId,body,idempotencyKey:assertIdempotencyKey(idempotencyKey) });
}

export function reversePayableAllocation<T>(id: string, requestId: string, body: unknown, idempotencyKey: string): Promise<T> {
  return requestCore<T>({
    method:'POST',
    path:`/api/payable-allocations/${assertUuid(id,'INVALID_PAYABLE_ALLOCATION_ID','Mã phân bổ công nợ không hợp lệ')}/reverse`,
    requestId,
    body,
    idempotencyKey:assertIdempotencyKey(idempotencyKey),
  });
}
