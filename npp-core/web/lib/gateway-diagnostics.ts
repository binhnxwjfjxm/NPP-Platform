type GatewayDiagnostic = {
  gateway: string;
  method: string;
  upstreamPath: string;
  status: number;
  requestId: string;
  code: string;
};

export type GatewayFailureKind = 'upstream_not_found' | 'not_configured' | 'authentication_failed' | 'upstream_failure';

export function classifyGatewayFailure(status: number, code: string): GatewayFailureKind {
  if (status === 404) return 'upstream_not_found';
  if (status === 401) return 'authentication_failed';
  if (status === 503 && /NOT_CONFIGURED|CONFIGURATION|CONFIGURED/.test(code)) return 'not_configured';
  return 'upstream_failure';
}

export function logGatewayFailure(diagnostic: GatewayDiagnostic): void {
  const safePath = diagnostic.upstreamPath.startsWith('/') ? diagnostic.upstreamPath.split('?')[0] : '/invalid-path';
  console.error('[gateway-failure]', {
    gateway: diagnostic.gateway,
    method: diagnostic.method,
    upstreamPath: safePath,
    status: diagnostic.status,
    requestId: diagnostic.requestId,
    code: diagnostic.code,
    kind: classifyGatewayFailure(diagnostic.status, diagnostic.code),
  });
}
