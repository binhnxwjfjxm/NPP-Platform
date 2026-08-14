import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('B1 owns canonical customer media in shared schema and keeps MCP provenance', () => {
  const sharedMigration = read('../../../database/migrations/shared/079_customer_media.sql');
  assert.match(sharedMigration, /CREATE TABLE IF NOT EXISTS shared\.customer_media/);
  assert.match(sharedMigration, /customer_id uuid NOT NULL/);
  assert.match(sharedMigration, /source_app text NOT NULL CHECK \(source_app IN \('CORE', 'MCP'\)\)/);
  assert.match(sharedMigration, /source_media_id text NULL/);
  assert.match(sharedMigration, /object_key text NOT NULL/);
  assert.match(sharedMigration, /REFERENCES shared\.customers \(installation_id, id\)/);
  assert.match(sharedMigration, /media_rank <= 3/);
});

test('B1 persists MCP outlet to canonical Core linkage instead of inferring identity from an order at read time', () => {
  const migration = read('../../../database/migrations/mcp/009_mcp_customer_media_link.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS core_customer_id text NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS core_customer_address_id text NULL/);
  assert.match(migration, /mcp_orders_route_customer_core_linkage/);
  assert.match(migration, /mcp_outlet_media_shared_registry/);
  assert.match(migration, /sync_route_customer_media_to_shared/);
  assert.match(migration, /source_app = 'MCP'/);
  assert.doesNotMatch(migration, /COPY\s+.*object/i);
});

test('Core and MCP share one browser resize contract', () => {
  const helper = read('../../../packages/contracts/customer-media-browser.js');
  const mcpClient = read('../../../mcp/src/features/mcp/outlet-media-client.ts');
  assert.match(helper, /CUSTOMER_MEDIA_MAX_IMAGE_EDGE = 1600/);
  assert.match(helper, /CUSTOMER_MEDIA_JPEG_QUALITY = 0\.82/);
  assert.match(helper, /CUSTOMER_MEDIA_MAX_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(mcpClient, /@npp\/contracts\/customer-media-browser/);
  assert.match(mcpClient, /compressCustomerPhoto\(source\)/);
  assert.doesNotMatch(mcpClient, /canvas\.toBlob/);
});

test('Core media projection keeps object keys backend-only and issues signed URLs at read time', () => {
  const repository = read('../src/db/repositories/customer-media.js');
  const route = read('../src/routes/customers.js');
  assert.match(repository, /objectKey: row\.object_key/);
  const publicProjection = repository.slice(repository.indexOf('export function customerMediaPublic'), repository.indexOf('export async function getCustomerMedia'));
  assert.doesNotMatch(publicProjection, /objectKey/);
  assert.match(route, /createPresignedGetUrl/);
  assert.match(route, /createPresignedPutUrl/);
  assert.match(route, /\/media\/prepare/);
  assert.match(route, /\/media\/finalize/);
  assert.doesNotMatch(route, /viewUrl.*INSERT|signed.*customer_address_snapshot/i);
});
