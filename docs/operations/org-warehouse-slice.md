# Phase 3 Slice 1 — Organization and Warehouse

## Overview

Phase 3 Slice 1 implements the minimal organization hierarchy for NPP Core:

- **Installation/Company**: Scoped context (read from config, not modifiable in this slice)
- **Branches**: Physical or logical organization branches within an installation
- **Warehouses**: Physical or logical storage facilities within a branch
- **Warehouse Locations**: Specific storage areas within a warehouse

All entities are scoped to an installation and enforce referential integrity with activation constraints.

## Data Model

### Branches
```sql
shared.branches
- id (uuid PK)
- installation_id  (text FK, NOT NULL)
- code (text UNIQUE per installation, NOT NULL, 1-64 chars)
- name (text NOT NULL, 1-256 chars)
- address (text, nullable, 0-512 chars)
- phone (text, nullable, 0-20 chars)
- email (text, nullable, 0-256 chars)
- is_active (boolean DEFAULT true)
- created_at, updated_at (timestamptz with timezone)
- created_by, updated_by (actor_id, NOT NULL)
```

**Constraints:**
- `installation_id` and `code` are unique together
- No hard delete
- Foreign key references from `warehouses.branch_id` have ON DELETE RESTRICT

### Warehouses
```sql
shared.warehouses
- id (uuid PK)
- installation_id (text FK, NOT NULL)
- branch_id (uuid FK to branches, ON DELETE RESTRICT)
- code (text UNIQUE per installation, NOT NULL, 1-64 chars)
- name (text NOT NULL, 1-256 chars)
- warehouse_type (enum: main, distribution, vehicle, quarantine, returns, transit, other)
- is_active (boolean DEFAULT true)
- created_at, updated_at (timestamptz with timezone)
- created_by, updated_by (actor_id, NOT NULL)
```

**Constraints:**
- `installation_id` and `code` are unique together
- `branch_id` is scoped to same installation
- Cannot create warehouse under inactive branch
- Cannot deactivate branch if it has active warehouses

### Warehouse Locations
```sql
shared.warehouse_locations
- id (uuid PK)
- installation_id (text FK, NOT NULL)
- warehouse_id (uuid FK to warehouses, ON DELETE RESTRICT)
- code (text UNIQUE per warehouse, NOT NULL, 1-64 chars)
- name (text NOT NULL, 1-256 chars)
- location_type (enum: storage, receiving, shipping, quarantine, returns, damaged, other)
- is_active (boolean DEFAULT true)
- created_at, updated_at (timestamptz with timezone)
- created_by, updated_by (actor_id, NOT NULL)
```

**Constraints:**
- `warehouse_id` and `code` are unique together
- Cannot create location under inactive warehouse
- Cannot deactivate warehouse if it has active locations

## API Routes

### Branches
```
GET    /api/branches                 — List branches (query: active, limit, offset)
POST   /api/branches                 — Create branch (idempotent with idempotency-key)
GET    /api/branches/:id             — Get branch by ID
PATCH  /api/branches/:id             — Update branch or change active status
```

### Warehouses
```
GET    /api/warehouses               — List warehouses (query: branchId, active, limit, offset)
POST   /api/warehouses               — Create warehouse (idempotent)
GET    /api/warehouses/:id           — Get warehouse by ID
PATCH  /api/warehouses/:id           — Update warehouse or change active status
```

### Warehouse Locations
```
GET    /api/warehouse-locations      — List locations (query: warehouseId, active, limit, offset)
POST   /api/warehouse-locations      — Create location (idempotent)
GET    /api/warehouse-locations/:id  — Get location by ID
PATCH  /api/warehouse-locations/:id  — Update location or change active status
```

## Response Format

**Success:**
```json
{
  "data": { /* entity or array of entities */ },
  "requestId": "req_...",
  "receivedAt": "2026-07-25T00:00:00.000Z"
}
```

**Error:**
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "User-friendly message",
    "details": {},
    "retryable": false
  },
  "requestId": "req_...",
  "receivedAt": "2026-07-25T00:00:00.000Z"
}
```

## Permissions

- `core.branch.read` — Read branches
- `core.branch.write` — Create/update/activate/deactivate branches
- `core.warehouse.read` — Read warehouses
- `core.warehouse.write` — Create/update/activate/deactivate warehouses
- `core.warehouse.location.read` — Read warehouse locations
- `core.warehouse.location.write` — Create/update/activate/deactivate locations

Bootstrap principal has all permissions for testing.

## Validation

### Code
- Trimmed and normalized to uppercase
- Must be 1-64 characters
- Must be unique within scope (branch: installation, warehouse: installation, location: warehouse)
- Allowed characters: alphanumeric, hyphen, underscore

### Name
- Trimmed
- Must be 1-256 characters
- Not empty

### Email (optional)
- Basic format validation (must contain @ and . if provided)
- Max 256 characters

### Phone (optional)
- Basic format validation (digits, spaces, dashes, plus)
- Max 20 characters

## Idempotency

POST routes support idempotency via request fingerprinting:

- **Key:** `Idempotency-Key` header (client-provided), scoped by installation + actor + route
- **Fingerprint:** SHA256 of request body for conflict detection
- **Behavior:**
  - Same key + same payload → Same response (cached)
  - Same key + different payload → 409 Conflict
  - Retry without key → New submission (potentially duplicate)

## Audit

Every mutation (POST, PATCH) records exactly one audit record in the same transaction:

```json
{
  "audit_id": "uuid",
  "installation_id": "...",
  "actor_id": "...",
  "action": "create|update|activate|deactivate",
  "resource_type": "branch|warehouse|warehouse_location",
  "resource_id": "...",
  "before_data": null, // for create
  "after_data": { /* entity */ },
  "metadata": { "code": "...", ... },
  "occurred_at": "2026-07-25T00:00:00.000Z"
}
```

No audit record creation is retryable (uses same transaction as mutation).

## Outbox Events

Every successful mutation also creates one outbox event for eventual distribution:

```json
{
  "event_id": "uuid",
  "event_type": "branch.created|warehouse.created|warehouse_location.created",
  "aggregate_type": "branch|warehouse|warehouse_location",
  "aggregate_id": "...",
  "event_version": 1,
  "payload": { /* entity */ },
  "status": "pending"
}
```

Events are published asynchronously (not in this slice).

## Business Rules

### Cannot Deactivate
- **Branch**: If it has active warehouses
- **Warehouse**: If it has active locations

**Rationale**: Prevents orphaned structures. Must deactivate children first.

### Cannot Create
- **Warehouse**: Under inactive branch
- **Location**: Under inactive warehouse

**Rationale**: Maintains hierarchy integrity.

### Activation
- Activating a branch/warehouse/location just sets `is_active = true` (no further checks)
- Siblings don't need to be active for a sibling to be active

## Local Development

### Setup
```bash
cd npp-core/api
npm install
```

### Environment
```bash
export NODE_ENV=development
export INSTALLATION_ID=local-npp
export DATABASE_URL=postgresql://user:password@localhost:5432/npp_platform
export DATABASE_SSL_MODE=disable
export BACKEND_API_TOKEN=dev-token
```

### Migrations
```bash
npm run migration:migrate
npm run migration:verify
npm run migration:rehearse
```

### Development Server
```bash
npm run dev    # with --watch
# Server runs on http://127.0.0.1:3004
```

### Tests
```bash
npm run test              # Run all tests
npm run build             # Syntax check
npm run verify            # Build + test
```

## Testing

### Unit/Integration Tests
- Services: code validation, code normalization
- Repositories: CRUD operations, constraints
- Business rules: deactivation conflicts, parent validation
- Audit/Outbox: record creation without dupe events

Location: `test/organization.test.js`

### E2E Tests
- Require actual Core API + PostgreSQL
- Create branch → warehouse → location
- Update and list operations
- Deactivation order rules
- Conflict error handling
- Idempotency on retry

Location: `npp-core/web/e2e/organization.spec.ts` (TODO)

### CI
```bash
npm --workspace npp-core-api run migration:migrate
npm --workspace npp-core-api run test
npm --workspace npp-core-api run verify
```

## Security Boundaries

- Installation scope is server-owned (from config)
- Cannot spoof installation via headers or body
- actorId/roles are server-owned (from auth token)
- Permissions are enforced at action level
- No client-provided IDs in POST payloads
- Audit/outbox cannot be directly manipulated

## Schema Enums

### Warehouse Types
- `main`: Primary warehouse
- `distribution`: Regional distribution center
- `vehicle`: Mobile warehouse (vehicle/truck)
- `quarantine`: Quality hold area
- `returns`: Customer return processing
- `transit`: In-transit inventory
- `other`: Custom type

### Location Types
- `storage`: General storage shelf/bin
- `receiving`: Inbound dock
- `shipping`: Outbound marshaling
- `quarantine`: Quality hold
- `returns`: Return processing
- `damaged`: Scrap/damage holding
- `other`: Custom type

## Production Exclusions

This slice does NOT include:
- Inventory balance calculation
- Stock reservation/allocation
- Inventory movement posting
- Costing or FIFO/WAVG
- Multi-tenant isolation (one installation/app only)
- Inventory aging or reporting
- Lot/expiry tracking
- Import/export of organization structure

## Future Slices

After Phase 3.1 gates:
- **Phase 3.2**: Users, employees, roles, permissions
- **Phase 3.3**: Customers, customer groups, addresses
- **Phase 3.4**: Suppliers, supplier terms
- **Phase 3.5**: Products, SKU, categories, brands
- **Phase 4**: Inventory ledger and movement foundation
- **Phase 5**: Purchasing end-to-end
- **Phase 6**: Sales end-to-end

## Known Limitations

- Only one installation supported (production needs multi-tenancy setup)
- No bulk operations
- Limited to serial code generation (no numeric sequences in this slice)
- No archive/soft-delete strategy yet (hard NOT NULL constraints)
- Activation/deactivation is synchronous (no async jobs)

## References

- Master plan: `NPP_PLATFORM_MASTER_PLAN.md` (Section 2.4, 3 Phase setup)
- Request context: `npp-core/api/src/request-context.js`
- Audit/Outbox: `npp-core/api/src/audit-outbox.js`
- Idempotency: `npp-core/api/src/idempotency.js`
