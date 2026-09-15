const DATABASE_NAME = 'npp-local-read-cache-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'resources';
const MAX_SCOPE_PART_LENGTH = 160;
const MAX_CURSOR_LENGTH = 512;
const SCOPE_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'passwd',
  'secret',
  'apikey',
  'accesskey',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'token',
]);

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > MAX_SCOPE_PART_LENGTH || !SCOPE_PART_PATTERN.test(normalized)) {
    throw new Error(`LOCAL_READ_CACHE_${label.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function normalizeIdentity(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('LOCAL_READ_CACHE_IDENTITY_INVALID');
  }
  return Object.freeze({
    app: requiredText(input.app, 'app'),
    installationId: requiredText(input.installationId, 'installation_id'),
    userId: requiredText(input.userId, 'user_id'),
  });
}

function normalizeScope(input) {
  const identity = normalizeIdentity(input);
  const schemaVersion = Number(input?.schemaVersion ?? 1);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 9999) {
    throw new Error('LOCAL_READ_CACHE_SCHEMA_VERSION_INVALID');
  }
  return Object.freeze({
    ...identity,
    resource: requiredText(input.resource, 'resource'),
    schemaVersion,
  });
}

function keyPart(value) {
  return encodeURIComponent(value);
}

function identitySlotKey(identityInput) {
  const identity = normalizeIdentity(identityInput);
  return `identity:${keyPart(identity.app)}:${keyPart(identity.installationId)}`;
}

function identityResourcePrefix(identityInput) {
  const identity = normalizeIdentity(identityInput);
  return `resource:${keyPart(identity.app)}:${keyPart(identity.installationId)}:${keyPart(identity.userId)}:`;
}

export function buildLocalReadCacheKey(scopeInput) {
  const scope = normalizeScope(scopeInput);
  return `${identityResourcePrefix(scope)}v${scope.schemaVersion}:${keyPart(scope.resource)}`;
}

function normalizedSensitiveKey(key) {
  return String(key ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

export function assertLocalReadCacheSafe(value) {
  const activePath = new WeakSet();

  function visit(current) {
    if (!current || typeof current !== 'object') return;
    if (activePath.has(current)) throw new Error('LOCAL_READ_CACHE_CIRCULAR_VALUE');
    activePath.add(current);

    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      activePath.delete(current);
      return;
    }

    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = normalizedSensitiveKey(key);
      if (SENSITIVE_KEYS.has(normalizedKey) || normalizedKey.endsWith('token') || normalizedKey.endsWith('secret')) {
        throw new Error(`LOCAL_READ_CACHE_SENSITIVE_FIELD:${key}`);
      }
      visit(nested);
    }
    activePath.delete(current);
  }

  visit(value);
  return value;
}

function rowId(row, getRowId) {
  const id = String(getRowId(row) ?? '').trim();
  if (!id || id.length > MAX_SCOPE_PART_LENGTH) {
    throw new Error('LOCAL_READ_CACHE_ROW_ID_INVALID');
  }
  return id;
}

function normalizeDelta(delta) {
  if (!delta || typeof delta !== 'object') throw new Error('LOCAL_READ_CACHE_DELTA_INVALID');
  const cursor = String(delta.cursor ?? '').trim();
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) throw new Error('LOCAL_READ_CACHE_CURSOR_INVALID');
  if (typeof delta.full !== 'boolean') throw new Error('LOCAL_READ_CACHE_DELTA_INVALID');
  if (!Array.isArray(delta.upserts) || !Array.isArray(delta.removeIds)) {
    throw new Error('LOCAL_READ_CACHE_DELTA_INVALID');
  }
  const removeIds = delta.removeIds.map((value) => String(value ?? '').trim());
  if (removeIds.some((value) => !value || value.length > MAX_SCOPE_PART_LENGTH)) {
    throw new Error('LOCAL_READ_CACHE_ROW_ID_INVALID');
  }
  return Object.freeze({
    cursor,
    full: delta.full,
    upserts: delta.upserts,
    removeIds,
  });
}

function validRecord(record, scope) {
  return Boolean(
    record
      && typeof record === 'object'
      && record.schemaVersion === scope.schemaVersion
      && record.scope?.app === scope.app
      && record.scope?.installationId === scope.installationId
      && record.scope?.userId === scope.userId
      && record.scope?.resource === scope.resource
      && typeof record.cursor === 'string'
      && Array.isArray(record.rows)
      && typeof record.savedAt === 'string',
  );
}

export function applyLocalReadDelta(currentRecord, deltaInput, {
  scope: scopeInput,
  getRowId = (row) => row?.id,
  now = () => new Date().toISOString(),
} = {}) {
  const scope = normalizeScope(scopeInput);
  const delta = normalizeDelta(deltaInput);
  const current = validRecord(currentRecord, scope) ? currentRecord : null;
  const byId = new Map();

  if (!delta.full && current) {
    for (const row of current.rows) {
      assertLocalReadCacheSafe(row);
      byId.set(rowId(row, getRowId), row);
    }
  }

  for (const id of delta.removeIds) byId.delete(id);
  for (const row of delta.upserts) {
    assertLocalReadCacheSafe(row);
    byId.set(rowId(row, getRowId), row);
  }

  return Object.freeze({
    schemaVersion: scope.schemaVersion,
    scope,
    cursor: delta.cursor,
    rows: [...byId.values()],
    savedAt: String(now()),
  });
}

function openDatabase(indexedDBFactory, databaseName) {
  if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDBFactory.open(databaseName, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export function createIndexedDbLocalReadStorage({
  indexedDBFactory = globalThis.indexedDB,
  databaseName = DATABASE_NAME,
} = {}) {
  let databasePromise = null;

  async function database() {
    if (!databasePromise) {
      databasePromise = openDatabase(indexedDBFactory, databaseName).then((db) => {
        if (!db) databasePromise = null;
        return db;
      });
    }
    return databasePromise;
  }

  async function withStore(mode, operation, fallback) {
    const db = await database();
    if (!db) return fallback;
    try {
      return await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        operation(store, transaction, resolve);
      });
    } catch {
      return fallback;
    }
  }

  return Object.freeze({
    async get(key) {
      return withStore('readonly', (store, _transaction, resolve) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      }, null);
    },

    async put(key, value) {
      return withStore('readwrite', (store, transaction, resolve) => {
        store.put(value, key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      }, false);
    },

    async delete(key) {
      return withStore('readwrite', (store, transaction, resolve) => {
        store.delete(key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      }, false);
    },

    async keys(prefix = '') {
      return withStore('readonly', (store, _transaction, resolve) => {
        const keys = [];
        const request = store.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(keys);
            return;
          }
          const key = String(cursor.key);
          if (!prefix || key.startsWith(prefix)) keys.push(key);
          cursor.continue();
        };
        request.onerror = () => resolve(keys);
      }, []);
    },
  });
}

export function createLocalReadCache({
  storage = createIndexedDbLocalReadStorage(),
  getRowId = (row) => row?.id,
  now = () => new Date().toISOString(),
} = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function'
    || typeof storage.delete !== 'function' || typeof storage.keys !== 'function') {
    throw new Error('LOCAL_READ_CACHE_STORAGE_INVALID');
  }

  const activeIdentities = new Map();
  const identityPromises = new Map();
  const refreshes = new Map();

  async function clearIdentityRecords(identityInput) {
    const identity = normalizeIdentity(identityInput);
    const prefix = identityResourcePrefix(identity);
    const keys = await storage.keys(prefix);
    await Promise.all(keys.map((key) => storage.delete(key)));
  }

  async function ensureIdentity(scopeInput) {
    const identity = normalizeIdentity(scopeInput);
    const slot = identitySlotKey(identity);
    if (activeIdentities.get(slot) === identity.userId) return;

    while (identityPromises.has(slot)) {
      await identityPromises.get(slot);
      if (activeIdentities.get(slot) === identity.userId) return;
    }

    const work = (async () => {
      const marker = await storage.get(slot);
      const previousUserId = String(marker?.userId ?? '').trim();
      if (previousUserId && previousUserId !== identity.userId) {
        await clearIdentityRecords({ ...identity, userId: previousUserId });
      }
      await storage.put(slot, Object.freeze({
        userId: identity.userId,
        activatedAt: String(now()),
      }));
      activeIdentities.set(slot, identity.userId);
    })().finally(() => {
      identityPromises.delete(slot);
    });

    identityPromises.set(slot, work);
    await work;
  }

  async function read(scopeInput) {
    const scope = normalizeScope(scopeInput);
    await ensureIdentity(scope);
    const key = buildLocalReadCacheKey(scope);
    const record = await storage.get(key);
    if (!validRecord(record, scope)) {
      if (record != null) await storage.delete(key);
      return null;
    }
    return record;
  }

  async function applyDelta(scopeInput, delta) {
    const scope = normalizeScope(scopeInput);
    await ensureIdentity(scope);
    const key = buildLocalReadCacheKey(scope);
    const current = await storage.get(key);
    const next = applyLocalReadDelta(current, delta, { scope, getRowId, now });
    await storage.put(key, next);
    return next;
  }

  async function refresh(scopeInput, fetchDelta) {
    if (typeof fetchDelta !== 'function') throw new Error('LOCAL_READ_CACHE_REFRESH_INVALID');
    const scope = normalizeScope(scopeInput);
    const key = buildLocalReadCacheKey(scope);
    if (refreshes.has(key)) return refreshes.get(key);

    const promise = (async () => {
      const cached = await read(scope);
      const delta = await fetchDelta(cached?.cursor ?? null);
      return applyDelta(scope, delta);
    })().finally(() => {
      refreshes.delete(key);
    });

    refreshes.set(key, promise);
    return promise;
  }

  async function readLocalFirst(scopeInput, fetchDelta) {
    const cached = await read(scopeInput);
    return Object.freeze({
      cached,
      refresh: refresh(scopeInput, fetchDelta),
    });
  }

  async function clearResource(scopeInput) {
    const scope = normalizeScope(scopeInput);
    await ensureIdentity(scope);
    return storage.delete(buildLocalReadCacheKey(scope));
  }

  async function clearIdentity(identityInput) {
    const identity = normalizeIdentity(identityInput);
    await clearIdentityRecords(identity);
    const slot = identitySlotKey(identity);
    const marker = await storage.get(slot);
    if (String(marker?.userId ?? '').trim() === identity.userId) {
      await storage.delete(slot);
      activeIdentities.delete(slot);
    }
  }

  return Object.freeze({
    read,
    applyDelta,
    refresh,
    readLocalFirst,
    clearResource,
    clearIdentity,
    ensureIdentity,
  });
}

export const localReadCacheInternals = Object.freeze({
  DATABASE_NAME,
  STORE_NAME,
  normalizeIdentity,
  normalizeScope,
  identityResourcePrefix,
  identitySlotKey,
});
