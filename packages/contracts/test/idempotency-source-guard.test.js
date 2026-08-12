import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function source(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

async function filesIn(relativeDir) {
  return (await readdir(join(repoRoot, relativeDir), { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => `${relativeDir}/${entry.name}`);
}

test('Core web gateways that handle idempotency consume the shared contract', async () => {
  const gateways = (await filesIn('npp-core/web/lib')).filter((path) => path.endsWith('-gateway.ts'));
  const offenders = [];
  for (const path of gateways) {
    const text = await source(path);
    if (!/Idempotency-Key|idempotencyKey/.test(text)) continue;
    if (!/from ['"]@npp\/contracts['"]/.test(text)) offenders.push(`${path}: missing @npp/contracts`);
    if (/const\s+IDEMPOTENCY_(?:KEY_)?PATTERN\s*=/.test(text)) offenders.push(`${path}: local idempotency regex`);
  }
  assert.deepEqual(offenders, []);
});

test('critical Core mutation producers keep payload fingerprints internal and emit shared generated keys', async () => {
  const expectations = [
    ['npp-core/web/app/inventory/fulfillment/fulfillment-workspace.tsx', 'fulfillment-${prefix}'],
    ['npp-core/web/app/inventory/delivery-orders/delivery-order-workspace.tsx', 'delivery-order-${prefix}'],
    ['npp-core/web/app/inventory/customer-returns/customer-return-workspace.tsx', 'customer-return-${prefix}'],
  ];
  for (const [path, operation] of expectations) {
    const text = await source(path);
    assert.match(text, /import \{ createIdempotencyKey \} from '@npp\/contracts';/, path);
    assert.ok(text.includes(`createIdempotencyKey(\`${operation}\`)`), `${path}: shared generator missing`);
    assert.doesNotMatch(text, /\.replace\(\/\[\^A-Za-z0-9\._:-]/, `${path}: ad-hoc idempotency sanitizer`);
  }
});

test('MCP frontend and backend speak the same canonical idempotency language', async () => {
  const client = await source('mcp/src/lib/api/idempotent-fetch.ts');
  const backend = await source('mcp/apps/backend/foundation/request-context.js');
  assert.match(client, /createIdempotencyKey as createContractIdempotencyKey/);
  assert.doesNotMatch(client, /\$\{operationPrefix\(operation\)\}:/);
  assert.match(backend, /from "@npp\/contracts"/);
  assert.doesNotMatch(backend, /IDEMPOTENCY_KEY_PATTERN\s*=/);
});

test('Delivery server adapters use the shared contract and define no private idempotency regex', async () => {
  for (const path of ['delivery/web/lib/attempt-api.ts', 'delivery/web/lib/cod-api.ts', 'delivery/web/lib/pod-api.ts']) {
    const text = await source(path);
    assert.match(text, /from '@npp\/contracts';/, path);
    assert.doesNotMatch(text, /IDEMPOTENCY_PATTERN\s*=/, path);
  }
});

test('Core API imports the canonical contract without changing storage ownership', async () => {
  const text = await source('npp-core/api/src/idempotency.js');
  assert.match(text, /createErrorEnvelope, IDEMPOTENCY_KEY_PATTERN.*@npp\/contracts/);
  assert.doesNotMatch(text, /const\s+IDEMPOTENCY_KEY_PATTERN\s*=/);
  assert.match(text, /createRequestFingerprint/);
  assert.match(text, /reclaimFailed/);
  assert.match(text, /markCompleted/);
  assert.match(text, /markFailed/);
});
