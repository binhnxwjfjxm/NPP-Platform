# Phase 3.3B: Supplier Master Data Slice

## Overview

Phase 3.3B implements the **Supplier Master Data** slice for NPP Core, enabling management of supplier information as normalized master data with installation-scoped codes and multi-tenant support.

**Status**: Raw code implementation (local branch `agent/supplier-master-data`, not production-deployed)

**Master Data **Scope**: 
- Suppliers (basic info, tax ID, bank details, delivery time)
- Supplier Contacts
- Supplier Addresses  
- Supplier Payment Terms

**Excluded** (as per Phase 3 plan): Products, SKUs, units, pricing, PO/GR/AP

---

## Database Schema (Migration 011)

### shared.suppliers

Core supplier table with installation-scoped normalized code:

```sql
CREATE TABLE shared.suppliers (
  id UUID PRIMARY KEY,
  installation_id UUID NOT NULL,
  code VARCHAR(64) NOT NULL,  -- UNIQUE per installation
  name VARCHAR(256) NOT NULL,
  tax_id VARCHAR(64),
  bank_account VARCHAR(64),
  bank_name VARCHAR(256),
  avg_delivery_days INTEGER,
  purchase_owner_employee_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by UUID,
  updated_by UUID,
  UNIQUE (installation_id, code),
  FOREIGN KEY (installation_id) REFERENCES shared.installations(id),
  FOREIGN KEY (purchase_owner_employee_id) REFERENCES shared.employees(id)
);
```

**Key Properties**:
- `code`: Uppercase alphanumeric, unique per installation (no hard delete means old codes are blocked)
- `tax_id`, `bank_account`, `bank_name`: Master data fields for supplier identification and payment
- `avg_delivery_days`: Average delivery time in days for logistics planning
- `purchase_owner_employee_id`: Optional employee responsible for supplier (must be active on create/edit)
- `is_active`: Lifecycle flag (soft delete only)

### shared.supplier_contacts, shared.supplier_addresses, shared.supplier_payment_terms

Related entity tables for multi-valued attributes:
- **supplier_contacts**: Contact person name, title, phone, email; `is_primary` flag
- **supplier_addresses**: Address type, full address fields; `is_primary` flag
- **supplier_payment_terms**: Payment method, term days, description; `is_primary` and `is_active` flags

All include audit fields (`created_at`, `updated_at`, `created_by`, `updated_by`) and indexed on `installation_id`, `supplier_id`.

---

## API Endpoints

All endpoints require `core.supplier.read` or `core.supplier.write` permission (deny-by-default).

### List Suppliers
```http
GET /api/suppliers?search=ABC&active=true&limit=100&offset=0
Authorization: Bearer <token>
```
**Response**: `{ data: Supplier[] }`

### Get Supplier
```http
GET /api/suppliers/:id
Authorization: Bearer <token>
```
**Response**: `{ data: Supplier }`

### Create Supplier
```http
POST /api/suppliers
Authorization: Bearer <token>
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "code": "SUP-001",
  "name": "Công ty cung cấp ABC",
  "taxId": "0123456789",
  "bankAccount": "1234567890",
  "bankName": "Ngân hàng XYZ",
  "avgDeliveryDays": 7,
  "purchaseOwnerEmployeeId": "<employee-id>"
}
```
**Response**: `{ data: Supplier }` (201 Created)  
**Idempotency**: Same `Idempotency-Key` + payload returns cached response within request window

### Update Supplier
```http
PATCH /api/suppliers/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Công ty cung cấp ABC - cập nhật",
  "taxId": "0123456789",
  "bankAccount": "9876543210",
  "avgDeliveryDays": 10,
  "purchaseOwnerEmployeeId": "<employee-id>",
  "expectedUpdatedAt": "2026-07-27T10:00:00.000Z"
}
```
or 
```json
{
  "isActive": false,
  "expectedUpdatedAt": "2026-07-27T10:00:00.000Z"
}
```
**Response**: `{ data: Supplier }` (200 OK)  
**Optimistic Concurrency**: `expectedUpdatedAt` must match current `updated_at` or request fails with 409 Conflict

---

## Web Gateway & Proxy

### Client-Side Gateway (TypeScript)
**File**: `npp-core/web/lib/supplier-gateway.ts`

Provides same-origin Core API wrapper with error normalization:
- `listAllSuppliers(requestId, searchParams): Promise<Supplier[]>`
- `getSupplier(id, requestId): Promise<Supplier>`
- `createSupplier(requestId, body, idempotencyKey): Promise<Supplier>`
- `patchSupplier(id, requestId, body): Promise<Supplier>`

**Error Handling**: Returns `SupplierGatewayError` with code, public message, status code, and retryable flag.

### Next.js API Proxy Routes
**Files**: 
- `npp-core/web/app/api/suppliers/route.ts` (GET/POST)
- `npp-core/web/app/api/suppliers/[id]/route.ts` (GET/PATCH)

Proxies requests to Core API with authentication token and request ID forwarding.

---

## UI & Page

### Supplier Workspace Component
**File**: `npp-core/web/app/organization/suppliers/supplier-workspace.tsx`

React client component with:
- **Create/Edit Form**: Code (immutable on edit), name, tax ID, bank details, delivery days
- **Search & Filter**: By code/name/tax ID; filter by status (all/active/inactive)
- **Table View**: Code, name, tax ID, delivery days, status, edit/toggle actions
- **Status Toggle**: Activate/deactivate with optimistic concurrency

### Page Loader
**File**: `npp-core/web/app/organization/suppliers/page.tsx`

Server-side data loader using supplier gateway; initializes UI with supplier list and error state.

### Navigation
**File**: `npp-core/web/app/components/app-shell.tsx` (updated)

Added "Nhà cung cấp" menu item at `/organization/suppliers` with icon 'user'.

---

## Permissions

**Permissions Added**:
- `core.supplier.read` (read access)
- `core.supplier.write` (create/update/toggle access)

**Bootstrap Principal**: Both permissions granted to bootstrap actor (installation setup user).

**Database**: Permissions registered in `shared.permission_catalog` via Migration 008.

---

## Middleware & Authentication

**Protected Routes**:
- `/api/suppliers/*` — Requires `core.supplier.read` or `core.supplier.write`

**Matcher Updated** (`npp-core/web/middleware.ts`):
- `/organization/suppliers/:path*` — Requires HTTP Basic auth
- `/api/suppliers/:path*` — Requires Bearer token auth

---

## Testing

### E2E Test Suite
**File**: `npp-core/web/e2e/suppliers.spec.ts`

Playwright test covering:
1. Create supplier with full details (code, name, tax ID, bank account, delivery days)
2. Search by code
3. Filter by status
4. Edit supplier (update name and delivery days)
5. Toggle supplier status (active → inactive)

**Run**: `npm run test:e2e -- suppliers.spec.ts`

---

## Implementation Notes

### Idempotency
- POST requires `Idempotency-Key` header (1-128 chars, alphanumeric + dot/dash/underscore)
- Same key + payload returns 201 Created if new, repeated request returns cached response
- Stored in `shared.idempotency_requests` table by Core API

### Optimistic Concurrency
- PATCH requires `expectedUpdatedAt` field matching current server `updated_at`
- Conflict (mismatch) returns 409 Conflict; client must re-fetch and retry
- Update timestamp incremented by Core API using PostgreSQL `clock_timestamp()` + 1ms guarantee

### Audit & Outbox
- All mutations (create/update/toggle) wrapped in transactional audit + outbox
- Audit records stored in `shared.audit_log`
- Outbox events stored in `shared.core_outbox_events` for eventual consistency

### Installation Scoping
- All queries scoped by `installation_id`
- Code uniqueness enforced per installation (allows same code across installations)
- Employee references must exist in same installation

### No Hard Delete
- Suppliers never deleted; only `is_active` flag toggled
- Codes are recycled as inactive → can be reactivated with same code or marked for new supplier

---

## Known Limitations & Future Enhancements

**Current Phase (3.3B)**:
- Basic supplier info only (master data fields as listed)
- No contact/address/payment term CRUD UI yet (only POST/GET routes available)
- No bulk operations or import/export

**Future Phases**:
- Phase 3.3C: Products, SKUs, categories, brands
- Phase 3.3E: Price lists and supplier-product pricing
- Supplier contact/address/payment term full CRUD UI
- Supplier classification/segmentation
- Supplier performance metrics
- PO linkage (Phase 3.3G)

---

## Commit History

- **52c8629**: Phase 3.3A - Add customer master data slice for NPP Core
- **<agent/supplier-master-data>**: Phase 3.3B - Add supplier master data slice for NPP Core (branch, not yet merged)

---

## Files Changed (Phase 3.3B)

### Database
- `database/migrations/shared/011_supplier_master_data.sql` — Migration DDL

### API Backend
- `npp-core/api/src/migrations/index.js` — Register migration 011
- `npp-core/api/src/db/repositories/supplier.js` — Repository CRUD
- `npp-core/api/src/services/supplier.js` — Service validation & logic
- `npp-core/api/src/routes/suppliers.js` — Route handlers (GET/POST/PATCH)
- `npp-core/api/src/access/permissions.js` — Add `core.supplier.read/write`
- `npp-core/api/src/request-context.js` — Bootstrap permissions
- `npp-core/api/src/server.js` — Import & wire supplier routes

### Web Frontend
- `npp-core/web/lib/supplier-types.ts` — TypeScript types
- `npp-core/web/lib/supplier-gateway.ts` — Core API gateway
- `npp-core/web/app/api/suppliers/route.ts` — Proxy GET/POST
- `npp-core/web/app/api/suppliers/[id]/route.ts` — Proxy GET/PATCH
- `npp-core/web/app/organization/suppliers/page.tsx` — Page loader
- `npp-core/web/app/organization/suppliers/supplier-workspace.tsx` — React UI
- `npp-core/web/app/components/app-shell.tsx` — Navigation updated
- `npp-core/web/middleware.ts` — Route matcher updated

### Testing & Documentation
- `npp-core/web/e2e/suppliers.spec.ts` — Playwright E2E tests
- `docs/operations/supplier-master-data-slice.md` — This file
