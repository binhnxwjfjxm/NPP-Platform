import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('access user mutations use canonical keys and reuse exact payload intents', async () => {
  const source = await readFile(new URL('../app/access/users/user-workspace.tsx', import.meta.url), 'utf8');

  assert.match(source, /import \{ createIdempotencyKey \} from '@npp\/contracts';/);
  assert.doesNotMatch(source, /function idempotencyKey\(/);
  assert.match(source, /const idempotencyKeys = new Map<string, string>\(\);/);
  assert.match(source, /function keyFor\(operation: string, resourceId: string, payload: unknown\): string/);
  assert.match(source, /const fingerprint = JSON\.stringify\(payload\);/);
  assert.match(source, /const existing = idempotencyKeys\.get\(intent\);\s*if \(existing\) return existing;/s);
  assert.match(source, /createIdempotencyKey\(`access-user-\$\{operation\}`\)/);
  assert.equal((source.match(/'Idempotency-Key': keyFor\(/g) ?? []).length, 6);
  assert.match(source, /keyFor\('create', draft\.employeeId, createPayload\)/);
  assert.equal((source.match(/keyFor\('roles', [^,]+, rolesPayload\)/g) ?? []).length, 2);
  assert.equal((source.match(/keyFor\('status', [^,]+, statusPayload\)/g) ?? []).length, 3);
  assert.doesNotMatch(source, /Date\.now\(\)|Math\.random\(\)/);
});
