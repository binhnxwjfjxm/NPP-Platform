import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('gateway diagnostics distinguish 404, 503 configuration and 401 authentication', async () => {
  const [diagnostics, customerGateway] = await Promise.all([
    readSource('../lib/gateway-diagnostics.ts'),
    readSource('../lib/customer-gateway.ts'),
  ]);

  assert.match(diagnostics, /status === 404[\s\S]*upstream_not_found/);
  assert.match(diagnostics, /status === 401[\s\S]*authentication_failed/);
  assert.match(diagnostics, /status === 503[\s\S]*NOT_CONFIGURED[\s\S]*not_configured/);
  assert.match(diagnostics, /upstreamPath: safePath/);
  assert.match(diagnostics, /requestId: diagnostic\.requestId/);
  assert.doesNotMatch(diagnostics, /Authorization|CORE_API_INTERNAL_URL|CORE_API_SERVER_TOKEN|payload|body/);

  assert.match(customerGateway, /logGatewayFailure/);
  assert.match(customerGateway, /gateway:\s*'customer'/);
  assert.match(customerGateway, /upstreamPath:\s*path/);
  assert.match(customerGateway, /status:\s*[A-Za-z_$][\w$]*\.statusCode/);
  assert.match(customerGateway, /requestId/);
});
