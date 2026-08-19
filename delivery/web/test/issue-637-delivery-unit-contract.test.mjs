import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(
  new URL('../app/trips/[tripId]/delivery-attempt-panel.tsx', import.meta.url),
  'utf8',
);
const detailSource = readFileSync(
  new URL('../app/trips/[tripId]/delivery-order-detail-dialog.tsx', import.meta.url),
  'utf8',
);
const typesSource = readFileSync(new URL('../lib/types.ts', import.meta.url), 'utf8');

test('Issue #637: Delivery shows sales packaging separately from canonical inventory unit', () => {
  assert.match(typesSource, /conversionToBase: string \| null/);
  assert.match(typesSource, /baseUnitCode: string \| null/);
  assert.match(typesSource, /baseUnitAllowsFractional: boolean/);
  assert.match(panelSource, /Quy cách: 1 \$\{line\.unitCode\} = \$\{conversion\} \$\{line\.baseUnitCode\}/);
  assert.match(panelSource, /Đã xuất: \{quantityText\(line\.issuedBaseQuantity\)\} \{baseUnitLabel\(line\)\}/);
  assert.match(panelSource, /Đơn vị nhập: \{baseUnitLabel\(line\)\}/);
  assert.match(detailSource, /Quy cách: \{relationship\}/);
  assert.match(detailSource, /Đã xuất: \{quantity\(line\.issuedBaseQuantity\)\} \{baseUnitLabel\(line\)\}/);
});

test('Issue #637: partial delivery keeps quantities exact and shows remainder on the vehicle', () => {
  assert.match(panelSource, /const QUANTITY_SCALE = BigInt\('1000000000000'\)/);
  assert.match(panelSource, /function remainingQuantity\(/);
  assert.match(panelSource, /Còn trên xe:/);
  assert.doesNotMatch(panelSource, /Number\(line\.issuedBaseQuantity\)/);
  assert.doesNotMatch(panelSource, /totalIssued/);
  assert.doesNotMatch(panelSource, /\b0n\b|\b1_000_000_000_000n\b/);
});

test('Issue #637: Delivery submits base quantity and does not implement a second conversion formula in the browser', () => {
  assert.match(panelSource, /deliveredBaseQuantity: quantities\[line\.inventoryIssueLineId\] \|\| '0'/);
  assert.match(panelSource, /inputMode=\{line\.baseUnitAllowsFractional \? 'decimal' : 'numeric'\}/);
  assert.doesNotMatch(panelSource, /deliveredBaseQuantity:\s*[^\n]*conversionToBase/);
  assert.doesNotMatch(panelSource, /parseFloat|Math\.round|Math\.floor|Math\.ceil/);
});

test('Issue #637: order detail never labels a base quantity with the sales unit as fallback', () => {
  assert.match(detailSource, /line\.issuedUnitQuantity !== null/);
  assert.match(detailSource, /Bán theo \$\{line\.unitCode\}/);
  assert.doesNotMatch(detailSource, /issuedUnitQuantity \?\? line\.issuedBaseQuantity/);
  assert.doesNotMatch(detailSource, /quantity\(line\.issuedBaseQuantity\)\} \{line\.unitCode/);
});