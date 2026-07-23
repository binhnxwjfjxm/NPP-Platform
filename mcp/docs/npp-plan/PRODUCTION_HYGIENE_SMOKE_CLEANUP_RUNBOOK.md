# Smoke cleanup deployment runbook

## Apply order

```text
1. Merge the production hygiene PR.
2. Apply migration 20260715154000_harden_mcp_smoke_route_cleanup.sql.
3. Deploy VPS with pullmcp.
4. Deploy/promote the Vercel build containing the PWA metadata change.
5. Run scripts/smoke-mcp-v1-api.mjs from the VPS environment.
6. Verify cleanup results include smokeCleanup=true.
7. Query production for zero 2099/API Smoke fixtures.
```

## Required smoke output

Each route cleanup result must contain:

```json
{
  "smokeCleanup": true,
  "deletedCounts": {
    "orders": 0,
    "orderItems": 0,
    "marketReports": 0,
    "testFiles": 0,
    "testFileProducts": 0,
    "testCustomers": 0,
    "testResults": 0
  }
}
```

The full-session route is expected to report non-zero business cleanup counts; the snapshot-once route may report zeros for business tables. Any cleanup failure fails the smoke.
