import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const helperSource = readFileSync(
  new URL('../lib/sales-order-gateway-diagnostics.ts', import.meta.url), 'utf8',
);
const gatewaySource = readFileSync(
  new URL('../lib/sales-order-gateway.ts', import.meta.url), 'utf8',
);
const previewSource = readFileSync(
  new URL('../lib/sales-order-preview-gateway.ts', import.meta.url), 'utf8',
);
const manualSource = readFileSync(
  new URL('../lib/manual-sales-order-gateway.ts', import.meta.url), 'utf8',
);

function loadDiagnostics() {
  const entries = { warn: [], info: [] };
  const exports = {};
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  vm.runInNewContext(compiled.outputText, {
    exports,
    console: {
      warn: (entry) => entries.warn.push(JSON.parse(entry)),
      info: (entry) => entries.info.push(JSON.parse(entry)),
    },
  });
  return { api: exports, entries };
}

test('sales gateway logs never expose query, UUID, token or customer data', () => {
  const { api, entries } = loadDiagnostics();
  const uuid = '123e4567-e89b-42d3-a456-426614174000';
  const route = `/api/sales-orders/${uuid}/issue-stock?customerName=NeverLog&token=NeverLog`;
  api.recordSalesGatewayFailure({
    requestId: 'sales_abc-123', method: 'POST', path: route,
    durationMs: 31_000, type: 'timeout',
  });
  assert.equal(entries.warn.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(entries.warn[0])),
    {
      event: 'sales_order_gateway_failure',
      requestId: 'sales_abc-123',
      method: 'POST',
      route: '/api/sales-orders/:id/issue-stock',
      durationMs: 31000,
      failureType: 'timeout',
      statusCode: null,
    },
  );
  const payload = JSON.stringify(entries.warn);
  assert.doesNotMatch(payload, /NeverLog|123e4567|token|customerName/i);
});

test('slow successes are logged with safe route; fast requests are not', () => {
  const { api, entries } = loadDiagnostics();
  const request = {
    requestId: 'req-1', method: 'GET',
    path: '/api/sales-orders/sku-previews?customerId=NeverLog',
    statusCode: 200,
  };
  api.recordSlowSalesGatewayRequest({ ...request, durationMs: 4999 });
  assert.equal(entries.info.length, 0);
  api.recordSlowSalesGatewayRequest({ ...request, durationMs: 5000 });
  assert.equal(entries.info.length, 1);
  assert.equal(entries.info[0].route, '/api/sales-orders/sku-previews');
  assert.equal(entries.info[0].durationMs, 5000);
  assert.doesNotMatch(JSON.stringify(entries.info), /NeverLog/);
});

test('gateway never logs malicious request-id verbatim', () => {
  const { api, entries } = loadDiagnostics();
  api.recordSalesGatewayFailure({
    requestId: 'secret\nlogin=NeverLog',
    method: 'POST',
    path: '/api/manual-sales-orders/:id/settlement',
    durationMs: -1,
    type: 'transport',
  });
  assert.equal(entries.warn[0].requestId, 'invalid');
  assert.equal(entries.warn[0].durationMs, 0);
});

test('order, pricing and manual mutation gateways all classify timeout explicitly', () => {
  for (const source of [gatewaySource, previewSource, manualSource]) {
    assert.match(source, /recordSalesGatewayFailure/);
    assert.match(source, /recordSlowSalesGatewayRequest/);
    assert.match(source, /const timedOut = controller\.signal\.aborted;/);
    assert.match(source, /timedOut \? 'timeout' : 'transport'/);
    assert.match(source, /timedOut \? 'SALES_ORDER_GATEWAY_TIMEOUT' : 'SALES_ORDER_GATEWAY_UNAVAILABLE'/);
    assert.match(source, /type: 'invalid_response'/);
    assert.match(source, /type: 'upstream_failure'/);
    assert.doesNotMatch(source, /retry\s*\(\s*\)/);
  }
  assert.match(gatewaySource, /'Idempotency-Key': idempotencyKey/);
  assert.match(manualSource, /'Idempotency-Key': idempotencyKey\(key\)/);
});

test('uncertain POST responses are never treated as a definitive business rejection', () => {
  for (const source of [gatewaySource, manualSource]) {
    assert.match(source, /'SALES_ORDER_GATEWAY_RESPONSE_INVALID'/);
    assert.match(source, /502,\s*true/);
    assert.match(source, /timedOut \? 504 : 503,\s*true/);
    assert.doesNotMatch(source, /fetch\([^]*?\)\.catch\(.*?fetch/);
  }
});
