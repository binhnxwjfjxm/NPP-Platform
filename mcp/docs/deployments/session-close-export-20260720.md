# Session close and export production release

Release date: 2026-07-20

Scope:
- Publish PR #75 merge 67f6457796519fdf0851a66c07ac7f298527991b.
- Send the required idempotency contract when closing an active route session.
- Use an owned browser download flow for session PDF and CSV files.

Checks:
- Foundation F0.2 run 616 passed.
- F05 UI Browser Smoke run 161 passed.

This is a frontend-only release. It does not require a database migration or backend restart.
