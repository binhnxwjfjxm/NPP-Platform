# Phase 9.2 — Customer Ordering -> Core canonical order intake

Parent: #386  
Task: #389  
Core baseline: `main@6fc49be30993bdce240286a41ae02d0d5b3b3a12`  
Customer baseline: `binhnxwjfjxm/nguyenlieuhungphat@95dd4a466b2bc1b84c1dfd095a10ccb1bce5114e`

## Locked authority boundary

- Clerk authenticates external customer identity only. Internal employees remain on Core users/employees/roles.
- Core resolves `Clerk subject -> shared.portal_identities -> shared.portal_users -> sales.customer_portal_memberships` fail-closed.
- An active membership owns the customer, default warehouse, sales channel, collection policy and cancel capability. The browser cannot select or override those authorities.
- Customer Ordering uses a same-origin BFF and forwards only the Clerk bearer token to Core. No Core bootstrap/server secret is exposed to the browser or required by the Customer Ordering runtime.
- No customer/order database is created in the website repository.

## Canonical Sales Order reuse

Phase 9.2 does not create a second order engine or lifecycle. It reuses existing Core Sales Order entry normalization, customer pricing, idempotency and audit/outbox.

Customer orders are stored as canonical `sales.sales_orders` with:

- `source_type = 'API'` (an already-supported canonical source type);
- `source_id = CUSTOMER_PORTAL:<portal-user-id>:<submission-key>`.

The existing unique source index plus request idempotency prevents duplicate orders. NPP source filtering treats that prefix as `Khách hàng`, `MCP` as MCP, and the remaining canonical sources as `Nội bộ`.

## Portal surface

Core `/api/customer-portal/**` supports the active customer membership only:

- `GET /me`
- `GET /addresses`
- `GET /catalog`
- `GET /orders`
- `GET /orders/:id`
- `POST /orders`
- `POST /orders/:id/cancel`

Read/cancel always re-check customer ownership and Customer Portal lineage. Reorder remains a client action that reloads current Core orderability into the cart; it never clones an order row.

## Production gate

This source task does not deploy or migrate production. Before rollout, verify provider values for the documented Customer Portal Clerk issuer/JWKS variables, create explicit portal identity/membership records through an approved provisioning flow, rehearse migration 071, and perform the normal shared DB backup/restore/reconciliation gate.
