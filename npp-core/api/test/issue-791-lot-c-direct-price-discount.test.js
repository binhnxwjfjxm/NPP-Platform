import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../src/services/sales-order.js', import.meta.url);
const repositoryPath = new URL('../src/db/repositories/sales-order-commercial.js', import.meta.url);
const permissionPath = new URL('../src/access/permissions-sales.js', import.meta.url);

test('Issue #791 Lô C keeps price override permission, allows zero/no-reason and audits source explicitly', async () => {
  const [service, repository, permissions] = await Promise.all([
    readFile(servicePath, 'utf8'), readFile(repositoryPath, 'utf8'), readFile(permissionPath, 'utf8'),
  ]);
  assert.match(service, /core\.sales-order\.price\.override/);
  assert.match(service, /MONEY_PATTERN = \/\^\(\?:0\|\[1-9\]\\d/);
  assert.doesNotMatch(service, /PRICE_OVERRIDE_REASON_REQUIRED/);
  assert.match(service, /reason: reason \|\| null/);
  assert.match(service, /manualOverride: manual\.value !== null/);
  assert.match(repository, /const source = line\.manualOverride \? 'MANUAL_OVERRIDE' : 'PRICE_ENGINE'/);
  assert.match(repository, /beforeUnitPriceMinor: line\.systemUnitPriceMinor/);
  assert.match(repository, /afterUnitPriceMinor: line\.finalUnitPriceMinor/);
  assert.match(permissions, /'Sửa giá bán trên đơn'/);
});

test('Issue #791 Lô C enforces line discount permission and keeps mixed-scope denial', async () => {
  const service = await readFile(servicePath, 'utf8');
  assert.match(service, /hasLineDiscount && !hasPermission\(requestContext, 'core\.sales-order\.discount\.override'\)/);
  assert.match(service, /LINE_DISCOUNT_FORBIDDEN/);
  assert.match(service, /documentDiscount\.positive && hasLineDiscount/);
  assert.match(service, /MIXED_DISCOUNT_SCOPE/);
});
