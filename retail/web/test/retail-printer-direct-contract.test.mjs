import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Retail có contract máy in local, nhớ cấu hình và không gửi máy in lên backend', async () => {
  const [bridge, panel, workspace] = await Promise.all([
    read('lib/printer-bridge.ts'),
    read('app/printer-settings-panel.tsx'),
    read('app/retail-workspace.tsx'),
  ]);

  assert.match(bridge, /PRINTER_SETTINGS_STORAGE_KEY = 'retail\.printer\.settings\.v1'/);
  assert.match(bridge, /method: 'SYSTEM'/);
  assert.match(bridge, /DIRECT_WIFI/);
  assert.match(bridge, /copies: safeCopies/);
  assert.match(bridge, /previewBeforePrint/);
  assert.match(bridge, /window\.localStorage\.setItem/);
  assert.doesNotMatch(bridge, /fetch\(/);
  assert.match(panel, /Tìm máy in/);
  assert.match(panel, /Cài đặt nâng cao/);
  assert.match(panel, /Địa chỉ máy in/);
  assert.match(panel, /Số bản in/);
  assert.match(panel, /Xem trước trước khi in/);
  assert.match(panel, /In thử/);
  assert.match(workspace, /printerSettingsSummary\(printerSettings\)/);
  assert.match(workspace, /printWithConfiguredPrinter/);
  assert.match(workspace, /settings\.method === 'DIRECT_WIFI' && settings\.profile && !settings\.previewBeforePrint/);
});

test('thiết lập in trên PWA vẫn chạm được và không hứa sai khổ giấy nhiệt', async () => {
  const panel = await read('app/printer-settings-panel.tsx');

  assert.match(panel, /aria-disabled={!directReady}/);
  assert.match(panel, /onClick={chooseDirectMethod}/);
  assert.doesNotMatch(panel, /disabled={!directReady}/);
  assert.match(panel, /Bản Retail đang mở là bản web/);
  assert.match(panel, /draft\.method === 'DIRECT_WIFI' \? <>\s*<option value="80mm">80 mm<\/option><option value="58mm">58 mm<\/option><\/?> : <>\s*<option value="A4">A4<\/option><option value="A5">A5<\/option>/s);
  assert.match(panel, /máy in\/AirPrint chưa cung cấp khổ đó cho iPhone/);
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

test('direct print dùng payload chứng từ chuẩn hóa và fallback hệ thống chỉ khi an toàn', async () => {
  const [bridge, workspace] = await Promise.all([
    read('lib/printer-bridge.ts'),
    read('app/retail-workspace.tsx'),
  ]);

  assert.match(bridge, /documentType: 'SALES_ORDER' \| 'PRINTER_TEST'/);
  assert.match(bridge, /buildSalesOrderPrintPayload/);
  assert.match(bridge, /safeToFallback/);
  assert.match(workspace, /reason instanceof RetailPrinterError && reason\.safeToFallback/);
  assert.match(workspace, /printBySystem\(settings\.paper\)/);
  assert.doesNotMatch(bridge, /192\.168\./);
  assert.doesNotMatch(bridge, /:9100.*fetch/);
});

test('iOS shell cấp bridge LAN thật, Local Network permission và raster tiếng Việt cho ESC POS', async () => {
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
