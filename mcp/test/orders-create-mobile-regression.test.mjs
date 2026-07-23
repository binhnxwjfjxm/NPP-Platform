import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/orders/OrderCreateSheet.tsx", import.meta.url), "utf8");
const mobileFixCss = readFileSync(new URL("../src/features/orders/OrderCreateSheet.mobile-fix.module.css", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../src/app/order-create-workspace.css", import.meta.url), "utf8");

test("order creation requires an explicit review step before POST", () => {
  assert.match(source, /if \(mobilePanel !== "cart"\) \{[\s\S]*?setMobilePanel\("cart"\);[\s\S]*?return;/);
  assert.match(source, /if \(mobilePanel !== "cart"\) \{[\s\S]*?Kiểm tra lại số lượng và đơn giá/);
  assert.doesNotMatch(source, /setMobilePanel\("cart"\);\s*void submit\(\);/);
  assert.match(source, /submitInFlightRef\.current/);
});

test("mobile order flow locks prerequisites and product taps cannot bubble", () => {
  assert.match(source, /disabled=\{!customerReady \|\| saving\}/);
  assert.match(source, /disabled=\{!customerReady \|\| items\.length === 0 \|\| saving\}/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*addProduct\(product\);/);
  assert.match(source, /Chọn khách trước, sau đó mới thêm sản phẩm vào đơn/);
});

test("unfinished order drafts require explicit discard confirmation", () => {
  assert.match(source, /function requestClose\(\)/);
  assert.match(source, /window\.confirm\("Đơn đang nhập chưa lưu\. Đóng và bỏ nội dung này\?"\)/);
  assert.match(source, /onClose=\{requestClose\}/);
});

test("mobile viewport, product rows, and footer remain physically usable", () => {
  assert.match(workspaceCss, /\.bottom-sheet-workspace\s*\{[\s\S]*?height:\s*100%\s*!important/);
  assert.match(workspaceCss, /\.bottom-sheet-workspace \.sheet-body\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
  assert.match(mobileFixCss, /grid-auto-rows:\s*max-content/);
  assert.match(mobileFixCss, /\.productCard\s*\{[\s\S]*?min-height:\s*62px/);
  assert.match(mobileFixCss, /@media \(max-width: 900px\)[\s\S]*?\.productCard\s*\{[\s\S]*?min-height:\s*78px/);
  assert.match(mobileFixCss, /\.cartButton\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(mobileFixCss, /\.primaryAction\s*\{[\s\S]*?grid-column:\s*2\s*!important/);
});
