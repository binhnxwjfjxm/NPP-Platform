import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(
  new URL('../app/api/trips/[tripId]/assignments/[assignmentId]/attempts/route.ts', import.meta.url),
  'utf8',
);

test('attempt route counts streamed bytes instead of trusting Content-Length', () => {
  assert.match(routeSource, /MAX_ATTEMPT_BODY_BYTES = 65_536/);
  assert.match(routeSource, /request\.body\.getReader\(\)/);
  assert.match(routeSource, /receivedBytes \+= chunk\.value\.byteLength/);
  assert.match(routeSource, /receivedBytes > MAX_ATTEMPT_BODY_BYTES/);
  assert.match(routeSource, /reader\.cancel\('request_body_too_large'\)/);
  assert.doesNotMatch(routeSource, /request\.json\(\)/);
});
