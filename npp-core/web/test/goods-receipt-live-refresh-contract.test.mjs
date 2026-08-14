import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx', import.meta.url);

test('goods receipt refresh keeps purchase orders live and preserves last-known-good data per source', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /const \[purchaseOrders, setPurchaseOrders\] = useState<PurchaseOrder\[\]>\(initialPurchaseOrders\);/,
  );
  assert.match(
    source,
    /\(\) => purchaseOrders\.filter\(\(purchaseOrder\) => \['approved', 'partially_received'\]\.includes\(purchaseOrder\.status\)\),\s*\[purchaseOrders\]/s,
  );
  assert.match(source, /Promise\.allSettled\(\[\s*requestJson<GoodsReceipt\[\]>\('\/api\/goods-receipts\?limit=1000'\),\s*requestJson<PurchaseOrder\[\]>\('\/api\/purchase-orders\?limit=1000'\),\s*\]\)/s);
  assert.match(
    source,
    /if \(receiptsResult\.status === 'fulfilled'\) \{\s*setItems\(receiptsResult\.value\);\s*\} else \{\s*setReceiptRefreshError/s,
  );
  assert.match(
    source,
    /if \(purchaseOrdersResult\.status === 'fulfilled'\) \{\s*setPurchaseOrders\(purchaseOrdersResult\.value\);\s*\} else \{\s*setPurchaseOrderRefreshError/s,
  );
  assert.match(source, /Phiếu nhận hàng chưa cập nhật:[\s\S]*Đang giữ dữ liệu gần nhất\./);
  assert.match(source, /Đơn đặt hàng chưa cập nhật:[\s\S]*Đang giữ dữ liệu gần nhất\./);

  const eligibilityBlock = source.match(/const eligiblePurchaseOrders = useMemo\([\s\S]*?\);/)?.[0] ?? '';
  assert.ok(eligibilityBlock.includes("'approved'"));
  assert.ok(eligibilityBlock.includes("'partially_received'"));
  assert.doesNotMatch(eligibilityBlock, /totalAmount/);
});

test('goods receipt refresh ignores stale snapshots across newer refreshes and mutations', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /const refreshGeneration = useRef\(0\);/);
  assert.match(
    source,
    /function upsertReceipt\(goodsReceipt: GoodsReceipt\) \{\s*refreshGeneration\.current \+= 1;\s*setLoadingList\(false\);\s*setItems/s,
  );
  assert.match(
    source,
    /async function loadAll\(successMessage\?: string\) \{\s*const generation = refreshGeneration\.current \+ 1;\s*refreshGeneration\.current = generation;/s,
  );
  assert.match(
    source,
    /Promise\.allSettled[\s\S]*?if \(refreshGeneration\.current !== generation\) return;[\s\S]*?if \(receiptsResult\.status === 'fulfilled'\)/,
  );
  assert.match(
    source,
    /finally \{\s*if \(refreshGeneration\.current === generation\) \{\s*setLoadingList\(false\);\s*\}\s*\}/s,
  );
  assert.match(
    source,
    /upsertReceipt\(updated\);[\s\S]*?void loadAll\(action === 'post' \? 'Phiếu nhận hàng đã được ghi sổ\.' : 'Phiếu nhận hàng đã được đảo\.'\);/,
  );
});
