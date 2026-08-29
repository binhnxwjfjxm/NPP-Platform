import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { retailPrintAgentInternals } from '../src/services/retail-print-agent.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Retail Print chỉ nhận thông tin ghép nối hợp lệ và lưu hash thay vì secret thô', async () => {
  const valid = retailPrintAgentInternals.normalizePairingStart({
    deviceId: '9f7ad5b0-5641-4a19-9a8f-7b64b2a8ea03',
    deviceName: 'QUAY-01',
    protocolVersion: '1',
    credentialHash: 'a'.repeat(64),
    pairingProofHash: 'b'.repeat(64),
  });
  assert.equal(valid?.deviceName, 'QUAY-01');
  assert.equal(retailPrintAgentInternals.normalizePairingStart({ ...valid, credentialHash: 'rpt.secret' }), null);

  const migration = await readRepo('database/migrations/shared/119_retail_print_agent.sql');
  assert.match(migration, /credential_hash text NOT NULL/);
  assert.match(migration, /pairing_proof_hash text NULL/);
  assert.doesNotMatch(migration, /agent_token|pairing_proof\s+text/i);
});

test('mã ghép nối và payload in bị giới hạn đúng contract', () => {
  for (let index = 0; index < 30; index += 1) {
    assert.match(retailPrintAgentInternals.randomPairingCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  }
  assert.equal(retailPrintAgentInternals.normalizePairingCode(' abcd2345 '), 'ABCD2345');
  assert.equal(retailPrintAgentInternals.normalizePairingCode('ABC'), '');
  assert.ok(retailPrintAgentInternals.normalizeJobPayload({ documentType: 'PRINTER_TEST', paper: '80mm', copies: 1 }));
  assert.ok(retailPrintAgentInternals.normalizeJobPayload({ documentType: 'SALES_ORDER', paper: '58mm', copies: 5 }));
  assert.equal(retailPrintAgentInternals.normalizeJobPayload({ documentType: 'SALES_ORDER', paper: 'A4', copies: 1 }), null);
  assert.equal(retailPrintAgentInternals.normalizeWaitSeconds(999), 20);
});

test('route Retail Print deny-by-default cho thao tác nhân viên và giới hạn body công khai', async () => {
  const route = await read('src/routes/retail-catalog.js');
  for (const path of [
    '/api/retail/print-agent/status',
    '/api/retail/print-agent/pair',
  ]) assert.ok(route.includes(path));
  assert.match(route, /options\.PERMISSIONS\.coreSalesOrderRead/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /MISSING_IDEMPOTENCY_KEY/);
  assert.match(route, /readLimitedJsonBody/);
  assert.match(route, /requestBody\(req, res, options, 4096\)/);
  assert.match(route, /requestBody\(req, res, options, 140 \* 1024\)/);
});

test('job idempotency được tách theo người gửi và retry claim không tạo lệnh mới', async () => {
  const [migration, service] = await Promise.all([
    readRepo('database/migrations/shared/119_retail_print_agent.sql'),
    read('src/services/retail-print-agent.js'),
  ]);
  assert.match(migration, /UNIQUE \(installation_id, agent_id, queued_by, idempotency_key\)/);
  assert.match(service, /ON CONFLICT \(installation_id, agent_id, queued_by, idempotency_key\)/);
  assert.match(service, /status='claimed' AND claimed_at < now\(\) - interval '\$\{CLAIM_LEASE_SECONDS\} seconds'/);
  assert.match(service, /SAVEPOINT retail_print_pairing_code/);
  assert.match(service, /ROLLBACK TO SAVEPOINT retail_print_pairing_code/);
});

test('migration 119 nằm trong canonical registry', async () => {
  const index = await read('src/migrations/index.js');
  assert.match(index, /119_retail_print_agent\.sql/);
  assert.match(index, /id: '119_retail_print_agent'/);
  assert.ok(index.indexOf("id: '118_sales_order_employee_visibility'") < index.indexOf("id: '119_retail_print_agent'"));
});
