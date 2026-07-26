# Phase 3.2A review checklist

- [x] Employee is a business record, not an authentication identity.
- [x] Migration is installation-scoped and references branches through a composite foreign key.
- [x] Create is idempotent and audited in the same transaction.
- [x] PATCH requires optimistic concurrency through `expectedUpdatedAt`.
- [x] Core web uses a server-only gateway; browser receives no backend token.
- [x] Basic Auth remains in place for this slice.
- [x] Production migration and deployment are excluded until CI and migration safety gates pass.
