import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('PWA cài bridge Retail Print Windows nhưng không ghi đè native iOS bridge', async () => {
  const [bridge, webBridge] = await Promise.all([
    read('lib/printer-bridge.ts'),
    read('lib/retail-print-web-bridge.ts'),
  ]);
  assert.doesNotMatch(bridge, /fetch\(/);
  const panel = await read('app/printer-settings-panel.tsx');
  assert.match(panel, /import '\.\.\/lib\/retail-print-web-bridge';/);
  assert.match(webBridge, /version: 'retail-print-windows\/1'/);
  assert.match(webBridge, /if \(!target\.RetailPrinterBridge\) target\.RetailPrinterBridge = webBridge/);
  assert.match(webBridge, /listRetailPrintAgents/);
  assert.match(webBridge, /windows-agent:/);
  assert.doesNotMatch(webBridge, /192\.168\.|:9100/);
});

test('lệnh in dùng canonical Idempotency-Key và retry tái sử dụng đúng key cũ', async () => {
  const client = await read('lib/retail-print-agent.ts');
  assert.match(client, /import \{ createIdempotencyKey \} from '@npp\/contracts'/);
  const submit = client.slice(client.indexOf('export async function submitRetailPrintJob'), client.indexOf('export function getRetailPrintJob'));
  assert.match(submit, /const idempotencyKey = createIdempotencyKey\('retail-print-job'\)/);
  assert.match(submit, /createRetailPrintJob\(agentId, payload, idempotencyKey\)/);
  assert.equal((submit.match(/createIdempotencyKey/g) ?? []).length, 1);
});

test('sau khi backend nhận job thì mất xác nhận không tự fallback để tránh in trùng', async () => {
  const [client, webBridge] = await Promise.all([
    read('lib/retail-print-agent.ts'),
    read('lib/retail-print-web-bridge.ts'),
  ]);
  assert.match(client, /PRINT_STATUS_UNKNOWN/);
  assert.match(client, /Không tự in lại để tránh trùng phiếu/);
  assert.match(webBridge, /value\?\.code === 'PRINT_AGENT_OFFLINE' \|\| value\?\.code === 'PRINT_AGENT_NOT_FOUND'/);
  assert.doesNotMatch(webBridge, /PRINT_STATUS_UNKNOWN'.*safeToFallback: true/s);
});

test('Cài đặt Retail dùng mã Windows cố định, nhập lại được trên nhiều điện thoại và vẫn giữ luồng iOS', async () => {
  const [panel, pairing] = await Promise.all([
    read('app/printer-settings-panel.tsx'),
    read('app/retail-print-windows-pairing.tsx'),
  ]);
  assert.match(panel, /RetailPrintWindowsPairing/);
  assert.match(panel, /Retail Print trên Windows/);
  assert.match(pairing, /Mã kết nối/);
  assert.match(pairing, /8 ký tự trên Retail Print/);
  assert.match(pairing, /pairRetailPrintAgent/);
  assert.match(pairing, /Mã trên máy Windows là cố định/);
  assert.match(pairing, /Mã không mất sau khi kết nối/);
  assert.doesNotMatch(pairing, /Mã chỉ dùng một lần|tự hết hạn|Làm mới danh sách/);
  assert.match(panel, /In Wi‑Fi trực tiếp/);
  assert.match(panel, /Cài đặt nâng cao/);
});

test('Retail gateway chỉ chuyển tiếp qua session Công Ty và giữ Idempotency-Key', async () => {
  const route = await read('app/api/retail/print-agent/[...segments]/route.ts');
  assert.match(route, /companyRequest/);
  assert.match(route, /\/api\/retail\/print-agent\/status/);
  assert.match(route, /\/api\/retail\/print-agent\/pair/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /idempotencyKey: key/);
  assert.doesNotMatch(route, /CORE_API_INTERNAL_URL|Authorization:\s*`Bearer/);
});

test('backend migration và service là nguồn hàng đợi dùng chung, không lưu IP máy in', async () => {
  const [migration, service] = await Promise.all([
    readRepo('database/migrations/shared/119_retail_print_agent.sql'),
    readRepo('npp-core/api/src/services/retail-print-agent.js'),
  ]);
  assert.match(migration, /shared\.retail_print_agents/);
  assert.match(migration, /shared\.retail_print_jobs/);
  assert.doesNotMatch(migration, /ip_address|printer_host|printer_port/i);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /PRINT_AGENT_OFFLINE/);
});
