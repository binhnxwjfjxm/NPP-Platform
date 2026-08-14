import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function source(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

test('Core customer address UI exposes one canonical HTTPS location link field in create and edit flows', async () => {
  const workspace = await source('npp-core/web/app/customers/customer-workspace.tsx');
  const types = await source('npp-core/web/lib/customer-types.ts');

  assert.match(types, /location_url: string \| null;/);
  assert.match(workspace, /customer-create-location-url-input/);
  assert.match(workspace, /customer-address-location-url-input/);
  assert.match(workspace, /type="url"/);
  assert.match(workspace, /maxLength=\{2048\}/);
  assert.match(workspace, /Link định vị phải là URL HTTPS hợp lệ\./);
  assert.ok((workspace.match(/locationUrl: addressDraft\.locationUrl\.trim\(\) \|\| null/g) ?? []).length >= 2);
  assert.doesNotMatch(workspace, /name=["'](?:lat|lng|latitude|longitude)["']/i);
});

test('customer address location migration is nullable and does not introduce editable coordinates', async () => {
  const migration = await source('database/migrations/shared/078_customer_address_location_url.sql');
  assert.match(migration, /ADD COLUMN location_url text NULL/);
  assert.match(migration, /char_length\(location_url\) BETWEEN 1 AND 2048/);
  assert.match(migration, /\^https:\/\//);
  assert.doesNotMatch(migration, /ADD COLUMN\s+(?:lat|lng|latitude|longitude)\b/i);
});
