// Only metadata is logged here. Never log auth headers, request payloads,
// idempotency keys, query strings, customer names or provider error messages.
const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SLOW_REQUEST_MS = 5_000;

export type SalesGatewayFailureType =
  | 'timeout'
  | 'transport'
  | 'invalid_response'
  | 'upstream_failure';

export function salesGatewayRouteLabel(path: string): string {
  // The actual URL may contain customer IDs, search terms or pricing context.
  // Emit path-only with opaque order UUIDs removed.
  return String(path).split('?')[0].replace(UUID_IN_PATH, ':id').slice(0, 160);
}

export function recordSalesGatewayFailure(input: {
  requestId: string;
  method: string;
  path: string;
  durationMs: number;
  type: SalesGatewayFailureType;
  statusCode?: number;
}): void {
  console.warn(JSON.stringify({
    event: 'sales_order_gateway_failure',
    requestId: SAFE_REQUEST_ID.test(input.requestId) ? input.requestId : 'invalid',
    method: input.method,
    route: salesGatewayRouteLabel(input.path),
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    failureType: input.type,
    statusCode: input.statusCode ?? null,
  }));
}

export function recordSlowSalesGatewayRequest(input: {
  requestId: string;
  method: string;
  path: string;
  durationMs: number;
  statusCode: number;
}): void {
  if (input.durationMs < SLOW_REQUEST_MS) return;
  console.info(JSON.stringify({
    event: 'sales_order_gateway_slow_request',
    requestId: SAFE_REQUEST_ID.test(input.requestId) ? input.requestId : 'invalid',
    method: input.method,
    route: salesGatewayRouteLabel(input.path),
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    statusCode: input.statusCode,
  }));
}
