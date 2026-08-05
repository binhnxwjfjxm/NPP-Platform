import test from 'node:test';
import assert from 'node:assert/strict';
import { customerReceivableInternals } from '../src/services/customer-receivable.js';

function sourceLine(overrides = {}) {
  return {
    line_number: 1,
    sales_order_line_id: '11111111-1111-4111-8111-111111111111',
    delivery_order_line_id: '22222222-2222-4222-8222-222222222222',
    delivery_attempt_line_id: '33333333-3333-4333-8333-333333333333',
    inventory_issue_line_id: '44444444-4444-4444-8444-444444444444',
    accepted_base_quantity: '4.000000000000',
    sales_line_base_quantity: '10.000000000000',
    sku_snapshot: 'SKU-001',
    item_name_snapshot: 'Hàng thử',
    unit_code_snapshot: 'KG',
    line_subtotal: '100.000000',
    discount_amount: '10.000000',
    tax_amount: '9.000000',
    line_total: '99.000000',
    ...overrides,
  };
}

test('partial accepted quantity posts only the accepted commercial value', () => {
  const result = customerReceivableInternals.buildPostingLines([sourceLine()], []);
  assert.equal(result.ok, true);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].acceptedBaseQuantity, '4.000000000000');
  assert.equal(result.lines[0].grossAmount, '40.000000');
  assert.equal(result.lines[0].discountAmount, '4.000000');
  assert.equal(result.lines[0].taxAmount, '3.600000');
  assert.equal(result.lines[0].lineAmount, '39.600000');
  assert.equal(customerReceivableInternals.formatAmount(result.documentTotal), '39.600000');
});

test('final accepted quantity absorbs the confirmed-line rounding residual', () => {
  const previous = [{
    sales_order_line_id: '11111111-1111-4111-8111-111111111111',
    accepted_base_quantity: '4.000000000000',
    gross_amount: '40.000000',
    discount_amount: '4.000000',
    tax_amount: '3.600000',
    line_amount: '39.600000',
  }];
  const result = customerReceivableInternals.buildPostingLines([
    sourceLine({
      accepted_base_quantity: '6.000000000000',
      inventory_issue_line_id: '55555555-5555-4555-8555-555555555555',
      delivery_attempt_line_id: '66666666-6666-4666-8666-666666666666',
    }),
  ], previous);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0].grossAmount, '60.000000');
  assert.equal(result.lines[0].discountAmount, '6.000000');
  assert.equal(result.lines[0].taxAmount, '5.400000');
  assert.equal(result.lines[0].lineAmount, '59.400000');
  assert.equal(customerReceivableInternals.formatAmount(result.documentTotal), '59.400000');
});

test('cumulative accepted quantity cannot exceed the confirmed Sales Order line', () => {
  const previous = [{
    sales_order_line_id: '11111111-1111-4111-8111-111111111111',
    accepted_base_quantity: '8.000000000000',
    gross_amount: '80.000000',
    discount_amount: '8.000000',
    tax_amount: '7.200000',
    line_amount: '79.200000',
  }];
  const result = customerReceivableInternals.buildPostingLines([
    sourceLine({ accepted_base_quantity: '3.000000000000' }),
  ], previous);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RECEIVABLE_QUANTITY_EXCEEDS_SALES_LINE');
});

test('posting date uses Vietnam business date', () => {
  assert.equal(
    customerReceivableInternals.dateOnlyInVietnam('2026-08-05T18:30:00.000Z'),
    '2026-08-06',
  );
});
