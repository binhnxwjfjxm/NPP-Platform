import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const shell = read('../app/components/app-shell.tsx');
const action = read('../app/inventory/inventory-export-action.tsx');
const route = read('../app/api/inventory/export/route.ts');
const model = read('../lib/inventory-data-export-model.ts');

test('LÃ´ Kho 3 chá»‰ gáº¯n xuáº¥t dá»¯ liá»‡u vÃ o ba mÃ n Ä‘Ã£ audit mÃ  khÃ´ng phá»¥ thuá»™c route', () => {
  assert.match(shell, /title === 'Tra cá»©u tá»“n kho'/);
  assert.match(shell, /title === 'LÃ´ hÃ ng'/);
  assert.match(shell, /title === 'ChÃ­nh sÃ¡ch quáº£n lÃ½ lÃ´'/);
  assert.match(shell, /<InventoryExportAction scope=\{exportScope\}/);
  assert.doesNotMatch(shell, /usePathname/);
  assert.doesNotMatch(shell, /\/inventory\/adjustments|\/inventory\/stocktakes/);
});

test('há»™p xuáº¥t dÃ¹ng Excel CSV, láº¥y tÃ¬m kiáº¿m hiá»‡n táº¡i vÃ  Ä‘á»ƒ server táº¡o file', () => {
  assert.match(action, /Excel \(\.xlsx\)/);
  assert.match(action, /CSV \(\.csv\)/);
  assert.match(action, /inventory-balances-search-input/);
  assert.match(action, /inventory-lots-search-input/);
  assert.match(action, /TÃ¬m SKU báº¥t ká»³, SKU tá»“n chuáº©n hoáº·c tÃªn hÃ ng/);
  assert.match(action, /query\.append\('column', column\)/);
  assert.match(action, /fetch\(`\/api\/inventory\/export\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(action, /createTabularXlsx/);
});

test('route xuáº¥t láº¥y canonical inventory data qua gateway vÃ  khÃ´ng cáº¯t Ã¢m tháº§m', () => {
  assert.match(route, /listAllInventoryBalances/);
  assert.match(route, /listAllInventoryLots/);
  assert.match(route, /listAllInventoryTrackingPolicies/);
  assert.match(route, /listInventoryTrackingPolicyCandidates/);
  assert.match(route, /MAX_EXPORT_ROWS/);
  assert.match(route, /INVENTORY_EXPORT_ROW_LIMIT_EXCEEDED/);
  assert.match(route, /createTabularXlsx/);
  assert.match(route, /guardCsvFormula/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|export async function PUT|export async function PATCH/);
});

test('file xuáº¥t chá»‰ dÃ¹ng cá»™t nghiá»‡p vá»¥, khÃ´ng Ä‘Æ°a khÃ³a ná»™i bá»™ thÃ nh cá»™t chá»n', () => {
  assert.match(model, /MÃ£ sáº£n pháº©m/);
  assert.match(model, /TÃªn sáº£n pháº©m/);
  assert.match(model, /SKU tá»“n chuáº©n/);
  assert.match(model, /MÃ£ kho/);
  assert.match(model, /Tá»“n kho/);
  assert.match(model, /Tham chiáº¿u nhÃ  cung cáº¥p/);
  assert.match(model, /Tráº¡ng thÃ¡i thiáº¿t láº­p/);
  assert.doesNotMatch(model, /key: 'installationId'/);
  assert.doesNotMatch(model, /key: 'warehouseId'/);
  assert.doesNotMatch(model, /key: 'baseVariantId'/);
  assert.doesNotMatch(model, /key: 'lotId'/);
  assert.m‘½•Í9½Ñ5…Ñ ¡µ½‘•°°€½­•äè€É•…Ñ•‘	äœ¼¤ì)ô¤ì()Ñ•ÍĞ á×†ê•Ğ£µ¹ Ï… ³Ğ‰…¼Ÿ†îM´†êŒM-TƒGŒÛ€£Á„Ñ¡§†êıĞ³†êµÀ¹£Á¹œ­£Ñ¹œÑ£©´‰Õ±¬µÕÑ…Ñ¥½¸œ°€ ¤€ôøì(€…ÍÍ•ÉĞ¹µ…Ñ ¡µ½‘•°°€½Á½±¥äpü€ŸCŒÑ¡§†êıĞ³†êµÀœ€è€£Á„Ñ¡§†êıĞ³†êµÀœ¼¤ì(€…ÍÍ•ÉĞ¹µ…Ñ ¡É½ÕÑ”°€½Á½±¥å	åY…É¥…¹Ñ%¼¤ì(€…ÍÍ•ÉĞ¹µ…Ñ ¡É½ÕÑ”°€½…¹‘¥‘…Ñ•ÍqÌ©p¹µ…À¼¤ì(€…ÍÍ•ÉĞ¹‘½•Í9½Ñ5…Ñ ¡…Ñ¥½¸°€½µ•Ñ¡½éqÌ¨A=MPñµ•Ñ¡½éqÌ¨AUPñµ•Ñ¡½éqÌ¨AQ œ¼¤ì)ô¤ì(