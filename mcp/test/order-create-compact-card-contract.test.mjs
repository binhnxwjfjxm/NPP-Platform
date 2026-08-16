import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/features/orders/OrderCreateSheet.module.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/features/orders/CoreOrderCreateSheet.tsx", import.meta.url), "utf8");

test("Đơn đang lên keeps product and price summary on the left with compact actions on the right", () => {
  assert.match(css, /\.cartItem\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.itemHead,\s*\.itemControls\s*\{\s*display:\s*contents;/);
  assert.match(css, /\.itemIdentity\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(css, /\.removeItem\s*\{[\s\S]*?grid-column:\s*2;/);
  assert.match(css, /\.quantityBlock\s*\{[\s\S]*?grid-row:\s*2 \/ span 2;[\s\S]*?grid-column:\s*2;[\s\S]*?width:\s*90px;/);
  assert.match(css, /\.quantityBlock > span\s*\{\s*display:\s*none;/);
  assert.match(css, /\.itemControls \.lineTotal:nth-child\(2\)\s*\{\s*grid-row:\s*2;/);
  assert.match(css, /\.itemControls \.lineTotal:nth-child\(3\)\s*\{\s*grid-row:\s*3;/);
  assert.match(css, /\.lineTotal\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?justify-content:\s*flex-start;/);
});

test("price copy remains readable and order behavior stays unchanged", () => {
  assert.match(css, /\.lineTotal > span,\s*\.lineTotal strong\s*\{\s*font-size:\s*10px;/);
  assert.match(source, /<span>Giá tham khảo<\/span>/);
  assert.match(source, /<span>Tạm tính<\/span>/);
  assert.match(source, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.match(source, /idempotentMutationFetch/);
  assert.match(source, /\/api\/backend\/core-sales\/orders/);
});
