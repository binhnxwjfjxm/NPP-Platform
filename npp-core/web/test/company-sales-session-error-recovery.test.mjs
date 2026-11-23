import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const gatewaySource = readFileSync(
  new URL('../lib/sales-order-gateway.ts', import.meta.url), 'utf8',
);
const pricingSource = readFileSync(
  new URL('../lib/sales-order-preview-gateway.ts', import.meta.url), 'utf8',
);
const manualSource = readFileSync(
  new URL('../lib/manual-sales-order-gateway.ts', import.meta.url), 'utf8',
);
const routeSource = readFileSync(
  new URL('../app/api/sales-orders/_route-helpers.ts', import.meta.url), 'utf8',
);
const uiSource = readFileSync(
  new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url), 'utf8',
);

function loadSalesGateway({ missingSession = false } = {}) {
  const moduleExports = {};
  let fetchCalls = 0;
  const compiled = ts.transpileModule(gatewaySource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  const fakeRequire = (moduleName) => {
    if (moduleName === 'server-only') return {};
    if (moduleName === '@npp/contracts') {
      return {
        isValidIdempotencyKey: () => true,
        normalizeIdempotencyKey: (value) => value,
      };
    }
    if (moduleName === 'node:crypto') return { randomUUID: () => 'trace-1' };
    if (moduleName === './internal-auth-client') {
      return {
        requireNppWorkforceSessionToken: () => {
          if (missingSession) throw new Error('NPP_AUTH_REQUIRED');
          return 'nppusr.test';
        },
      };
    }
    if (moduleName === './sales-order-gateway-diagnostics') {
      return {
        recordSalesGatewayFailure: () => {},
        recordSlowSalesGatewayRequest: () => {},
      };
    }
    throw new Error(`Unexpected module ${moduleName}`);
  };
  vm.runInNewContext(compiled.outputText, {
    exports: moduleExports,
    require: fakeRequire,
    Error,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    process: {
      env: { CORE_API_INTERNAL_URL: 'https://example.invalid', NODE_ENV: 'production' },
    },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('Should not reach fetch');
    },
  });
  return { api: moduleExports, fetchCalls: () => fetchCalls };
}

test('missing workforce cookie is a 401 rejection before sending any POST to backend', async () => {
  const { api, fetchCalls } = loadSalesGateway({ missingSession: true });
  await assert.rejects(
    api.createSalesOrder('req-sales-1', { lines: [] }, 'sales-test-key'),
    (error) => error.code === 'NPP_AUTH_REQUIRED'
      && error.statusCode === 401
      && error.retryable === false
      && /đăng nhập lại/i.test(error.publicMessage),
  );
  assert.equal(fetchCalls(), 0);
});

test('normalizer retains known backend errors and distinguishes unexpected server errors', () => {
  const { api } = loadSalesGateway();
  const missing = api.normalizeSalesOrderGatewayError(new Error('NPP_AUTH_REQUIRED'));
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.code, 'NPP_AUTH_REQUIRED');
  assert.equal(missing.retryable, false);
  const known = new api.SalesOrderGatewayError('INSUFFICIENT_STOCK', 'Thiếu tồn', 409, false);
  assert.equal(api.normalizeSalesOrderGatewayError(known), known);
  const unexpected = api.normalizeSalesOrderGatewayError(new TypeError('NeverLogSecret'));
  assert.equal(unexpected.statusCode, 503);
  assert.equal(unexpected.code, 'SALES_ORDER_GATEWAY_UNAVAILABLE');
  assert.doesNotMatch(unexpected.publicMessage, /NeverLogSecret/);
});

test('price preview and manual settlement classify pre-network session expiry as auth, not transport', () => {
  for (const source of [pricingSource, manualSource]) {
    assert.match(source, /normalizeSalesOrderGatewayError/);
    assert.match(source, /error\.message === 'NPP_AUTH_REQUIRED'/);
    assert.match(source, /throw normalizeSalesOrderGatewayError\(error\)/);
    assert.match(source, /const timedOut = controller\.signal\.aborted/);
  }
});

test('unexpected gateway errors are diagnosable by request id without exposing payload', () => {
  assert.match(routeSource, /event: 'sales_order_unhandled_gateway_error'/);
  assert.match(routeSource, /requestId,/);
  assert.doesNotMatch(routeSource, /console\.error\(error\)/);
  assert.match(uiSource, /requestId\?: string/);
  assert.match(uiSource, /payload\?\.requestId \|\| response\.headers\.get\('x-request-id'\)/);
  assert.match(uiSource, /response\.status >= 500 && \/\^\[A-Za-z0-9\._:-\]/);
  assert.match(uiSource, /Mã tra cứu:/);
});
