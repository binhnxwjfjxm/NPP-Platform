import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/orders/CoreOrderCreateSheet.tsx", import.meta.url), "utf8");
const loader = readFileSync(new URL("../src/features/orders/CoreOrderCreateLoader.tsx", import.meta.url), "utf8");
const mobileFixCss = readFileSync(new URL("../src/features/orders/OrderCreateSheet.mobile-fix.module.css", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../src/app/order-create-workspace.css", import.meta.url), "utf8");

test("order creation requires an explicit review step before POST", () => {
  assert.match(source, /if \(mobilePanel !== "cart"\) \{[\s\S]*?setMobilePanel\("cart"\);[\s\S]*?return;/);
  assert.doesNotMatch(source, /setMobilePanel\("cart"\);\s*void submit\(\);/);
  assert.match(source, /submitInFlightRef\.current/);
});

test("mobile order flow locks prerequisites to active Công Ty customers with delivery addresses", () => {
  assert.match(source, /disabled=\{!customerReady \|\| saving\}/);
  assert.match(source, /disabled=\{!customerReady \|\| items\.length === 0 \|\| saving\}/);
  assert.match(source, /Khách đang hoạt động, có địa chỉ và thuộc phạm vi được phép bán/);
  assert.doesNotMatch(source, /Chỉ khách đã mở|Mở \/ liên kết mã|đã mở mã/);
  assert.doesNotMatch(source, /Khách nhập tay|ManualCustomer|customerMode/);
  assert.match(loader, /\/api\/backend\/core-customers/);
  assert.match(loader, /item\.status === "active"/);
  assert.match(loader, /item\.defaultAddressId/);
  assert.doesNotMatch(loader, /customer-verifications|approved|linked_existing/);
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
