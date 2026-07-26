# Phase 3.2A — Employee Directory

> Status: IMPLEMENTATION IN PROGRESS  
> Branch: `agent/core-employee-directory`  
> Parent roadmap item: users / employees / roles / scopes

## Objective

Deliver the canonical business employee directory required before user identities, role assignments and data scopes can be introduced.

## Included

- `shared.employees` migration scoped by installation.
- Employee code, full name, job title, phone, email and optional branch assignment.
- List, get, create, update and activate/deactivate API operations.
- Deny-by-default employee read/write permissions for the existing bootstrap principal.
- Idempotent create, optimistic concurrency and transactional audit records.
- Server-only Core web gateway.
- Vietnamese `/access/employees` administration UI.
- Nested AppShell navigation under `Nhân sự & phân quyền`.
- PostgreSQL integration tests and Playwright browser coverage.

## Explicitly excluded

- Passwords or password hashes.
- Authentication-provider selection.
- User identity records and employee-user links.
- Roles, permission catalog administration and role assignments.
- Branch/warehouse/territory scope assignments.
- Replacing Vercel Basic Auth.
- Any production migration or deployment before CI, backup and restore rehearsal gates.

## Rules

- Employee identity is not an authentication identity.
- Employee code is immutable after creation.
- Branch assignment is installation-scoped.
- New assignment to an inactive branch is rejected.
- PATCH requires `expectedUpdatedAt`.
- Deactivation preserves the record for audit and future document references.
- Browser never receives the Core backend token or database connection details.

## Delivery gate

```text
migration 007
-> API service/repository/routes
-> Core web server gateway
-> employee administration UI
-> API integration tests
-> browser E2E
-> CI green
-> squash merge
-> verified backup + restore rehearsal
-> production migration
-> backend deploy if required
-> frontend deploy
-> production smoke
```
