# @npp/shared-utils

Owned by the shared platform foundation.

This package provides minimal cross-workspace helpers for request IDs, config normalization, boolean coercion, and the shared browser local-read cache contract.
It is intentionally small and avoids business-domain assumptions.

## Browser local-read cache

Import the browser-only foundation from:

```js
import {
  createLocalReadCache,
  createIndexedDbLocalReadStorage,
} from '@npp/shared-utils/browser-local-read-cache';
```

The cache is read-only from the business point of view: IndexedDB can hold display/search snapshots, while the backend and PostgreSQL remain authoritative.

Required scope:

```text
app + installationId + userId + resource + schemaVersion
```

The foundation supports:

- local-first reads;
- full sync followed by cursor/delta sync;
- `upserts` and `removeIds`;
- one in-flight refresh per resource;
- clearing the previous user's cache when identity changes;
- clearing the active user's cache on logout;
- rejecting credential/secret fields before persistence;
- graceful fallback when IndexedDB is unavailable.

Business mutations, authorization decisions, live price/inventory/debt and other authoritative facts must not use IndexedDB as their source of truth.
