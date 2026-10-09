import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/pricing-file-import.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { importPricingFileWithConfirmation, PricingImportUnconfirmedError } =
  await import('data:text/javascript;base64,' + Buffer.from(transpiled).toString('base64'));

const payload = { matchBySku: true, sourceBatchId: 'price-file-existing', items: Array.from({ length: 1412 }, (_, i) => ({ sku: 'SKU-' + i, amountMinor: i ? '25000' : '0' })) };
const done = { data: { itemsCreated: 1412, itemsUpdated: 0, totalItems: 1412 } };
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('1,412 prices: delayed commit is replayed using exactly the same key and unchanged payload', async () => {
  let attempts = 0; let pendingCalls = 0; const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, key: init.headers['Idempotency-Key'], body: init.body });
    attempts++;
    if (attempts === 1) return response(503, { error: { code: 'PRICING_GATEWAY_UNAVAILABLE' } });
    if (attempts === 2) return response(409, { error: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
    return response(201, done);
  };
  const result = await importPricingFileWithConfirmation({
    payload, operationKey: 'price-file-existing', fetchImpl,
    pause: async () => {}, onChecking: () => pendingCalls++,
  });
  assert.equal(result.totalItems, 1412);
  assert.equal(requests.length, 3);
  assert.equal(pendingCalls, 2);
  assert.ok(requests.every((r) => r.url === '/api/pricing/import' && r.key === 'price-file-existing'));
  assert.equal(new Set(requests.map((r) => r.body)).size, 1);
  assert.equal(JSON.parse(requests[0].body).items[0].amountMinor, '0');
});

test('connection drops can recover the successful result without creating a second operation', async () => {
  let calls = 0;
  const fetchImpl = async () => { if (++calls === 1) throw new TypeError('network disconnected'); return response(201, done); };
  assert.equal((await importPricingFileWithConfirmation({ payload, operationKey: 'price-file-existing', fetchImpl, pause: async () => {} })).totalItems, 1412);
  assert.equal(calls, 2);
});

test('specific 409 validation errors are not retried or hidden', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(409, { error: { code: 'IMPORT_IDENTITY_CONFLICT', message: 'SKU đã có nhiều mức giá' } }); };
  await assert.rejects(() => importPricingFileWithConfirmation({ payload, operationKey: 'price-file-existing', fetchImpl, pause: async () => {} }), /SKU đã có nhiều mức giá/);
  assert.equal(calls, 1);
});

test('after ambiguous exhaustion the original operation stays recoverable; never report failure', async () => {
  const fetchImpl = async () => response(409, { error: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
  await assert.rejects(() => importPricingFileWithConfirmation({ payload, operationKey: 'price-file-existing', fetchImpl, maxAttempts: 2, pause: async () => {} }), PricingImportUnconfirmedError);
});

test('a success response with missing rows must not be reported as 1412 saved', async () => {
  const fetchImpl = async () => response(201, { data: { totalItems: 200 } });
  await assert.rejects(() => importPricingFileWithConfirmation({ payload, operationKey: 'price-file-existing', fetchImpl, maxAttempts: 2, pause: async () => {} }), PricingImportUnconfirmedError);
});

test('only pricing imports use extended gateway timeout and popup preview fills available height', () => {
  const gateway = readFileSync(new URL('../lib/pricing-gateway.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/pricing/pricing-bulk-overlay.module.css', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../app/pricing/pricing-file-adjustment.tsx', import.meta.url), 'utf8');
  assert.match(gateway, /path==='\/api\/pricing\/import'\?PRICING_IMPORT_TIMEOUT_MS:REQUEST_TIMEOUT_MS/);
  assert.match(css, /\.fileImportLayout\{[^}]*height:100%/);
  assert.match(css, /\.fileImportLayout>\.filePreview\{[^}]*flex:1 1 auto[^}]*max-height:none/);
  assert.doesNotMatch(css, /\.filePreview\{max-height:330px/);
  assert.match(modal, /Kiểm tra lại kết quả/);
  assert.match(modal, /importPricingFileWithConfirmation/);
});
