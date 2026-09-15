import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLocalReadDelta,
  assertLocalReadCacheSafe,
  buildLocalReadCacheKey,
  createIndexedDbLocalReadStorage,
  createLocalReadCache,
} from '../browser-local-read-cache.js';

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); return true; },
    async delete(key) { return values.delete(key); },
    async keys(prefix = '') { return [...values.keys()].filter((key) => key.startsWith(prefix)); },
    values,
  };
}

const scope = Object.freeze({
  app: 'mcp',
  installationId: 'installation-1',
  userId: 'employee-1',
  resource: 'routes',
  schemaVersion: 1,
});

test('cache key is isolated by app, installation, user, resource and schema version', () => {
  assert.equal(
    buildLocalReadCacheKey(scope),
    'resource:mcp:installation-1:employee-1:v1:routes',
  );
  assert.notEqual(
    buildLocalReadCacheKey({ ...scope, userId: 'employee-2' }),
    buildLocalReadCacheKey(scope),
  );
  assert.throws(
    () => buildLocalReadCacheKey({ ...scope, resource: '../routes' }),
    /LOCAL_READ_CACHE_RESOURCE_INVALID/,
  );
});

test('full and delta sync preserve canonical rows by id', () => {
  const full = applyLocalReadDelta(null, {
    cursor: '2026-09-15T00:00:00.000Z',
    full: true,
    upserts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    removeIds: [],
  }, { scope, now: () => '2026-09-15T00:00:01.000Z' });

  const delta = applyLocalReadDelta(full, {
    cursor: '2026-09-15T00:01:00.000Z',
    full: false,
    upserts: [{ id: 'b', name: 'B2' }, { id: 'c', name: 'C' }],
    removeIds: ['a'],
  }, { scope, now: () => '2026-09-15T00:01:01.000Z' });

  assert.equal(delta.cursor, '2026-09-15T00:01:00.000Z');
  assert.deepEqual(delta.rows, [{ id: 'b', name: 'B2' }, { id: 'c', name: 'C' }]);
  assert.equal(delta.savedAt, '2026-09-15T00:01:01.000Z');
});

test('cache rejects secret and session credential fields recursively', () => {
  assert.throws(
    () => assertLocalReadCacheSafe({ id: '1', nested: { accessToken: 'secret-value' } }),
    /LOCAL_READ_CACHE_SENSITIVE_FIELD:accessToken/,
  );
  assert.throws(
    () => assertLocalReadCacheSafe({ id: '1', authorization: 'Bearer abc' }),
    /LOCAL_READ_CACHE_SENSITIVE_FIELD:authorization/,
  );
  assert.doesNotThrow(
    () => assertLocalReadCacheSafe({ id: '1', sessionStatus: 'active', note: 'token hàng hóa' }),
  );
});

test('switching user clears only the previous user cache for the same app and installation', async () => {
  const storage = memoryStorage();
  const cache = createLocalReadCache({ storage, now: () => '2026-09-15T00:00:00.000Z' });

  await cache.applyDelta(scope, {
    cursor: 'cursor-1',
    full: true,
    upserts: [{ id: 'a', name: 'A' }],
    removeIds: [],
  });
  assert.ok(await cache.read(scope));

  const otherUser = { ...scope, userId: 'employee-2' };
  await cache.ensureIdentity(otherUser);

  assert.equal(await storage.get(buildLocalReadCacheKey(scope)), null);
  assert.equal(await cache.read(otherUser), null);

  const otherApp = { ...scope, app: 'admin', userId: 'owner-1' };
  await cache.applyDelta(otherApp, {
    cursor: 'admin-cursor',
    full: true,
    upserts: [{ id: 'x', name: 'Admin' }],
    removeIds: [],
  });
  await cache.ensureIdentity({ ...otherUser, userId: 'employee-3' });
  assert.ok(await cache.read(otherApp));
});

test('logout clears only the active identity cache and marker', async () => {
  const storage = memoryStorage();
  const cache = createLocalReadCache({ storage });

  await cache.applyDelta(scope, {
    cursor: 'cursor-1',
    full: true,
    upserts: [{ id: 'a', name: 'A' }],
    removeIds: [],
  });
  await cache.clearIdentity(scope);

  assert.equal(await storage.get(buildLocalReadCacheKey(scope)), null);
  assert.equal(
    await storage.get('identity:mcp:installation-1'),
    null,
  );
});

test('local-first returns persisted rows before background refresh completes', async () => {
  const storage = memoryStorage();
  const cache = createLocalReadCache({ storage });

  await cache.applyDelta(scope, {
    cursor: 'cursor-old',
    full: true,
    upserts: [{ id: 'a', name: 'Old' }],
    removeIds: [],
  });

  let resolveDelta;
  const deltaPromise = new Promise((resolve) => { resolveDelta = resolve; });
  const result = await cache.readLocalFirst(scope, async (cursor) => {
    assert.equal(cursor, 'cursor-old');
    return deltaPromise;
  });

  assert.deepEqual(result.cached.rows, [{ id: 'a', name: 'Old' }]);
  resolveDelta({
    cursor: 'cursor-new',
    full: false,
    upserts: [{ id: 'a', name: 'New' }],
    removeIds: [],
  });

  const fresh = await result.refresh;
  assert.deepEqual(fresh.rows, [{ id: 'a', name: 'New' }]);
});

test('failed refresh leaves the previous snapshot intact', async () => {
  const storage = memoryStorage();
  const cache = createLocalReadCache({ storage });

  await cache.applyDelta(scope, {
    cursor: 'cursor-old',
    full: true,
    upserts: [{ id: 'a', name: 'Stable' }],
    removeIds: [],
  });

  await assert.rejects(
    cache.refresh(scope, async () => { throw new Error('network down'); }),
    /network down/,
  );

  const cached = await cache.read(scope);
  assert.equal(cached.cursor, 'cursor-old');
  assert.deepEqual(cached.rows, [{ id: 'a', name: 'Stable' }]);
});

test('concurrent refreshes for one resource are deduplicated', async () => {
  const storage = memoryStorage();
  const cache = createLocalReadCache({ storage });
  let calls = 0;

  const fetchDelta = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { cursor: 'cursor-1', full: true, upserts: [{ id: 'a' }], removeIds: [] };
  };

  const [left, right] = await Promise.all([
    cache.refresh(scope, fetchDelta),
    cache.refresh(scope, fetchDelta),
  ]);

  assert.equal(calls, 1);
  assert.equal(left.cursor, 'cursor-1');
  assert.equal(right.cursor, 'cursor-1');
});

test('IndexedDB storage degrades to a no-op when browser storage is unavailable', async () => {
  const storage = createIndexedDbLocalReadStorage({ indexedDBFactory: null });
  assert.equal(await storage.get('missing'), null);
  assert.equal(await storage.put('key', { value: true }), false);
  assert.equal(await storage.delete('key'), false);
  assert.deepEqual(await storage.keys('resource:'), []);
});
