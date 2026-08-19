import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { logisticsDriverDeliveryInternals } from '../src/services/logistics-driver-delivery.js';

const {
  parseQuantity,
  validateDeliveryBaseQuantity,
  eventKey,
} = logisticsDriverDeliveryInternals;

const repositorySource = readFileSync(
  new URL('../src/db/repositories/logistics-driver-delivery.js', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../src/services/logistics-driver-delivery.js', import.meta.url),
  'utf8',
);

test('Issue #637: Delivery validates actual delivery in canonical inventory units', () => {
  const bottleSource = {
    inventory_issue_line_id: 'line-bottle',
    conversion_to_base: '12.000000',
    base_unit_code: 'CHAI',
    base_unit_allows_fractional: false,
  };
  const eightBottles = parseQuantity('8');
  assert.notEqual(eightBottles, null);
  assert.equal(validateDeliveryBaseQuantity(bottleSource, eightBottles), null);

  const halfBottle = parseQuantity('8.5');
  assert.notEqual(halfBottle, null);
  const fractionalError = validateDeliveryBaseQuantity(bottleSource, halfBottle);
  assert.equal(fractionalError?.code, 'DELIVERY_ATTEMPT_BASE_UNIT_FRACTION_NOT_ALLOWED');
  assert.equal(fractionalError?.details?.baseUnitCode, 'CHAI');

  const weightSource = {
    inventory_issue_line_id: 'line-weight',
    conversion_to_base: '1.000000',
    base_unit_code: 'KG',
    base_unit_allows_fractional: true,
  };
  assert.equal(validateDeliveryBaseQuantity(weightSource, parseQuantity('0.5')), null);

  const missingContract = validateDeliveryBaseQuantity({
    inventory_issue_line_id: 'line-missing',
    conversion_to_base: null,
    base_unit_code: null,
    base_unit_allows_fractional: false,
  }, eightBottles);
  assert.equal(missingContract?.code, 'DELIVERY_ATTEMPT_UNIT_CONTRACT_INVALID');
});

test('Issue #637: driver read model maps confirmed order conversion snapshot to Inventory OUT base unit', () => {
  assert.match(repositorySource, /JOIN sales\.sales_order_version_lines sales_line/);
  assert.match(repositorySource, /'conversionToBase', sales_line\.conversion_to_base::text/);
  assert.match(repositorySource, /'baseUnitCode'/);
  assert.match(repositorySource, /base_unit\.allows_fractional/);
  assert.match(repositorySource, /sales_line\.variant_id = issue_line\.base_variant_id/);
  assert.match(repositorySource, /issue_line\.issued_base_quantity::text/);
});

test('Issue #637: Delivery attempt uses the shared canonical Idempotency-Key contract', () => {
  assert.match(serviceSource, /import \{ IDEMPOTENCY_KEY_PATTERN \} from '@npp\/contracts'/);
  assert.match(serviceSource, /IDEMPOTENCY_KEY_PATTERN\.test\(String\(idempotencyKey/);
  assert.equal(IDEMPOTENCY_KEY_PATTERN.test('delivery-attempt-123'), true);
  assert.equal(IDEMPOTENCY_KEY_PATTERN.test('delivery:attempt:123'), false);
  assert.equal(IDEMPOTENCY_KEY_PATTERN.test(eventKey('delivery-attempt-123', 'assignment-123')), true);
});

test('Issue #637: partial delivery checks each line instead of adding unrelated product units together', () => {
  assert.match(serviceSource, /let hasDeliveredQuantity = false/);
  assert.match(serviceSource, /let hasRemainingQuantity = false/);
  assert.doesNotMatch(serviceSource, /deliveredTotal \+= delivered/);
  assert.doesNotMatch(serviceSource, /issuedTotal \+= issued/);
});