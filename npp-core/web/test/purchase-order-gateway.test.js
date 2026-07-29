import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('purchase-order-gateway scaffold', () => {
  it('creates a TypeScript gateway file containing gateway error class', () => {
    const p = fileURLToPath(new URL('../lib/purchase-order-gateway.ts', import.meta.url));
    const content = readFileSync(p, 'utf8');
    assert.match(content, /export class PurchaseOrderGatewayError/);
    assert.match(content, /normalizePurchaseOrderGatewayError/);
  });
});
