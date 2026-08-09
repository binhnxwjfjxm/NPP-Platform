import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('same-origin gateways and routes forward sanitized conflict details', () => {
  const productGateway = read('../lib/product-gateway.ts');
  const organizationGateway = read('../lib/organization-gateway.ts');
  const productRoute = read('../app/api/products/[id]/route.ts');
  const organizationRoute = read('../app/api/organization/[resource]/[id]/route.ts');

  assert.match(productGateway, /\.error\?\.details\s*\?\?\s*\{\}/);
  assert.match(organizationGateway, /\.error\?\.details\s*\?\?\s*\{\}/);
  assert.match(productRoute, /details: normalized\.details/);
  assert.match(organizationRoute, /details: normalized\.details/);
});

test('product and organization workspaces show actionable deactivate conflict text', () => {
  const productWorkspace = read('../app/products/product-workspace.tsx');
  const organizationWorkspace = read('../app/organization/organization-workspace.tsx');

  for (const source of [productWorkspace, organizationWorkspace]) {
    assert.match(source, /dependencyAwareErrorMessage/);
    assert.match(source, /active_dependents/);
    assert.match(source, /stale_version/);
    assert.match(source, /Mở màn hình xử lý/);
    assert.match(source, /Bấm Làm mới/);
  }
});
