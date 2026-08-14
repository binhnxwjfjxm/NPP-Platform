import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const routeSource = read('src/routes/logistics-driver.js');
const serviceSource = read('src/services/logistics-driver-commercial.js');
const repositorySource = read('src/db/repositories/logistics-driver-commercial.js');

test('driver trip commercial read stays behind assigned-driver authorization', () => {
  assert.match(serviceSource, /getAssignedDriverTrip\(adapter, \{ requestContext, tripId \}\)/);
  assert.match(serviceSource, /if \(!base\.ok\) return base/);
  assert.match(routeSource, /getAssignedDriverTripCommercial/);
  assert.match(routeSource, /tripId: detailMatch\[1\]/);
  assert.match(routeSource, /readDriverCustomerMedia[\s\S]*getAssignedDriverTrip\(/);
});

test('driver order value is derived read-only from immutable Sales Order version commercial facts', () => {
  assert.match(repositorySource, /sales\.sales_order_versions order_version/);
  assert.match(repositorySource, /sales\.sales_order_version_lines order_line/);
  assert.match(repositorySource, /order_line\.line_total \* issue_line\.issued_base_quantity/);
  assert.match(repositorySource, /NULLIF\(order_line\.base_quantity, 0\)/);
  assert.match(repositorySource, /issue_line\.issued_base_quantity \/ NULLIF\(order_line\.conversion_to_base, 0\)/);
  assert.match(repositorySource, /order_line\.unit_price::text/);
  assert.match(repositorySource, /order_version\.currency_code/);
  assert.doesNotMatch(repositorySource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
});

test('commercial read enriches only the already-authorized trip payload', () => {
  assert.match(serviceSource, /currencyCode: commercial\.currency_code/);
  assert.match(serviceSource, /totalAmount: commercial\.total_amount/);
  assert.match(serviceSource, /issuedUnitQuantity: priced\?\.issuedUnitQuantity/);
  assert.match(serviceSource, /unitPrice: priced\?\.unitPrice/);
  assert.match(serviceSource, /lineAmount: priced\?\.lineAmount/);
});
