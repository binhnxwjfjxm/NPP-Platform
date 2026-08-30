import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/customers/customer-media-launcher.tsx', import.meta.url), 'utf8');

test('Ảnh khách nằm trên thanh thao tác và giữ nguyên luồng mở ảnh', () => {
  assert.match(source, /createPortal\(launcherButton, topbarActions\)/);
  assert.match(source, /shellStyles\.topbarActions/);
  assert.match(source, /className=\{shellStyles\.actionButton\}/);
  assert.match(source, />\s*Ảnh khách\s*</);
  assert.match(source, /data-testid="customer-media-launcher"/);
  assert.match(source, /fetch\('\/api\/customers\?limit=1000'/);
  assert.match(source, /<CustomerMediaDialog/);
  assert.doesNotMatch(source, /position:\s*'fixed'/);
  assert.doesNotMatch(source, /bottom:\s*24/);
  assert.doesNotMatch(source, /right:\s*24/);
});
