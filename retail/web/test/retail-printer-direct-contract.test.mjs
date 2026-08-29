import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Retail giữ cấu hình máy in trên thiết bị và thêm Retail Print Windows mà không gửi IP lên backend', async () => {
  const [bridge, webBridge, panel, pairing, workspace] = await Promise.all([
    read('lib/printer-bridge.ts'),
    read('lib/retail-print-web-bridge.ts'),
    read('app/printer-settings-panel.tsx'),
    read('app/retail-print-windows-pairing.tsx'),
    read('app/retail-workspace.tsx'),
  ]);

  assert.match(bridge, /PRINTER_SETTINGS_STORAGE_KEY = 'retail\.printer\.settings\.v1'/);
  assert.match(bridge, /method: 'SYSTEM'/);
  assert.match(bridge, /DIRECT_WIFI/);
  assert.match(bridge, /copies: safeCopies/);
  assert.match(bridge, /previewBeforePrint/);
  assert.match(bridge, /window\.localStorage\.setItem/);
  assert.match(panel, /import '\.\.\/lib\/retail-print-web-bridge'/);
  assert.doesNotMatch(bridge, /fetch\(/);
  assert.match(webBridge, /retail-print-windows\/1/);
  assert.match(webBridge, /host: null/);
  assert.match(webBridge, /port: null/);
  assert.doesNotMatch(webBridge, /profile\?\.host|profile\.host|profile\?\.port|profile\.port|192\.168\./);
  assert.match(pairing, /Làm mới danh sách/);
  assert.match(pairing, /Mã kết nối/);
  assert.match(panel, /Địa chỉ máy in/);
  assert.match(panel, /capabilities\.manualIp/);
  assert.match(panel, /Số bản in/);
  assert.match(panel, /Xem trước trước khi in/);
  assert.match(panel, /In thử/);
  assert.match(workspace, /printerSettingsSummary\(printerSettings\)/);
  assert.match(workspace, /printWithConfiguredPrinter/);
  assert.match(workspace, /settings\.method === 'DIRECT_WIFI' && settings\.profile && !settings\.previewBeforePrint/);
});

test('thiết lập in web hỗ trợ Retail Print Windows và vẫn cho test hệ thống đủ A4 A5 80 58', async () => {
  const [panel, pairing] = await Promise.all([
    read('app/printer-settings-panel.tsx'),
    read('app/retail-print-windows-pairing.tsx'),
  ]);
  const directButton = panel.match(/<button[^>]*aria-checked=\{draft\.method === 'DIRECT_WIFI'\}[^>]*onClick=\{chooseDirectMethod\}[^>]*>/)?.[0] ?? '';

  assert.ok(directButton, 'phải tìm thấy nút in trực tiếp');
  assert.doesNotMatch(directButton, /aria-disabled/);
  assert.doesNotMatch(directButton, /\sdisabled=/);
  assert.match(panel, /Retail Print trên Windows/);
  assert.match(pairing, /Mở Retail Print trên Windows → Lấy mã → nhập mã vào đây/);
  assert.match(panel, /<option value="A4">A4<\/option><option value="A5">A5<\/option><option value="80mm">80 mm<\/option><option value="58mm">58 mm<\/option>/);
  assert.match(panel, /A4, A5, 80 mm và 58 mm đều dùng được để định dạng phiếu trên bản web/);
  assert.doesNotMatch(panel, /function systemPaper/);
  assert.doesNotMatch(panel, /\bTCP\b/);
  assert.doesNotMatch(panel, />Anh\b/);
});

test('in thử bằng hệ thống giữ CSS khổ giấy cho tới khi cửa sổ in kết thúc', async () => {
  const panel = await read('app/printer-settings-panel.tsx');

  assert.match(panel, /80mm 120mm/);
  assert.match(panel, /58mm 100mm/);
  assert.match(panel, /addEventListener\('afterprint', cleanup/);
  assert.match(panel, /requestAnimationFrame\(\(\) => \{/);
  assert.match(panel, /setTimeout\(cleanup, 120000\)/);
  assert.doesNotMatch(panel, /setTimeout\(\(\) => \{ style\.remove\(\); testScreen\.remove\(\); \}, 0\)/);
});

test('in đơn thật bằng hệ thống giữ khổ giấy cho tới khi cửa sổ in kết thúc', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  const systemPrint = workspace.match(/function printBySystem\(paper: PrintPaper\) \{[\s\S]*?\n    \}\n    async function printConfiguredOrder/)?.[0] ?? '';

  assert.ok(systemPrint, 'phải tìm thấy luồng In bằng hệ thống của đơn thật');
  assert.match(workspace, /80mm 120mm/);
  assert.match(workspace, /58mm 100mm/);
  assert.match(systemPrint, /addEventListener\('afterprint', cleanup/);
  assert.match(systemPrint, /setTimeout\(cleanup, 120000\)/);
  assert.match(systemPrint, /requestAnimationFrame\(\(\) => \{/);
  assert.doesNotMatch(systemPrint, /setTimeout\(\(\) => style\.remove\(\), 0\)/);
});

test('direct print dùng payload chứng từ chuẩn hóa và fallback hệ thống chỉ khi an toàn', async () => {
  const [bridge, workspace, webBridge] = await Promise.all([
    read('lib/printer-bridge.ts'),
    read('app/retail-workspace.tsx'),
    read('lib/retail-print-web-bridge.ts'),
  ]);

  assert.match(bridge, /documentType: 'SALES_ORDER' \| 'PRINTER_TEST'/);
  assert.match(bridge, /buildSalesOrderPrintPayload/);
  assert.match(bridge, /safeToFallback/);
  assert.match(workspace, /reason instanceof RetailPrinterError && reason\.safeToFallback/);
  assert.match(workspace, /printBySystem\(settings\.paper\)/);
  assert.match(webBridge, /PRINT_AGENT_OFFLINE/);
  assert.match(webBridge, /PRINT_AGENT_NOT_FOUND/);
  assert.doesNotMatch(bridge, /192\.168\./);
  assert.doesNotMatch(bridge, /:9100.*fetch/);
});

test('iOS shell vẫn cấp bridge LAN thật, Local Network permission và raster tiếng Việt cho ESC POS', async () => {
  const [nativeBridge, webView, plist, project, scheme] = await Promise.all([
    readRepo('retail/mobile/ios/NPPRetail/RetailPrinterBridge.swift'),
    readRepo('retail/mobile/ios/NPPRetail/RetailWebView.swift'),
    readRepo('retail/mobile/ios/NPPRetail/Info.plist'),
    readRepo('retail/mobile/ios/NPPRetail.xcodeproj/project.pbxproj'),
    readRepo('retail/mobile/ios/NPPRetail.xcodeproj/xcshareddata/xcschemes/NPPRetail.xcscheme'),
  ]);

  assert.match(nativeBridge, /import Network/);
  assert.match(nativeBridge, /NWBrowser/);
  assert.match(nativeBridge, /NWConnection/);
  assert.match(nativeBridge, /_pdl-datastream\._tcp/);
  assert.doesNotMatch(nativeBridge, /bonjour\(type: "_printer\._tcp"/);
  assert.match(nativeBridge, /9100/);
  assert.match(nativeBridge, /UIGraphicsImageRenderer/);
  assert.match(nativeBridge, /0x1D/);
  assert.match(nativeBridge, /PRINT_STATUS_UNKNOWN/);
  assert.match(nativeBridge, /safeToFallback": safe/);
  assert.match(webView, /RetailPrinterBridge\.install/);
  assert.match(plist, /NSLocalNetworkUsageDescription/);
  assert.match(plist, /NSBonjourServices/);
  assert.match(plist, /_pdl-datastream\._tcp/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.nguyenlieuhungphat\.retail/);
  assert.match(scheme, /BlueprintName="NPPRetail"/);
});
