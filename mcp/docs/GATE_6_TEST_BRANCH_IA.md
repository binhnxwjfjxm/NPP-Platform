# Gate 6 - Test branch information architecture

## Rule

Test is not a top-level operating module. Test belongs to the MCP session tree:

```text
Ngày
└─ Tuyến / Phiên MCP
   └─ Khách trong phiên
      └─ Test sản phẩm / kết quả test
```

## Implemented

1. Remove Test from main navigation

- `src/ui/shell/navigation.ts`
- Removed `/field-checks` from primary bottom navigation.
- Removed `Test sản phẩm` from sidebar navigation.
- Kept `/field-checks` route available as an admin/summary page, but no longer promoted as a main menu item.

2. Move Test wording under MCP today / session

- `src/app/mcp/page.tsx`
  - Clarifies that order, test, reports, and follow-up live inside the MCP session.
  - Clarifies that Test is not a standalone main menu module.

- `src/features/mcp/McpSessionsManagerSafe.tsx`
  - Session history cards now show branch summary per session:

```text
Nhánh trong phiên: x đơn · y test · z BC · n follow-up
```

3. Convert `/field-checks` into a secondary admin/summary screen

- `src/features/market-checks/MarketChecksClientPage.tsx`
- The page title is now `Tổng hợp test theo phiên`.
- It is explicitly marked as `MCP / Admin phụ`.
- It no longer acts as the primary operating entry point for field work.

4. Group test data by MCP session context

- `src/features/market-checks/MarketChecksPage.tsx`
- Reads real data from:

```text
mcp_route_sessions
mcp_session_customers
test_files
test_customers
test_customer_results
```

- Groups by:

```text
routeId + sessionDate + sessionId
```

- Anchors MCP test rows through:

```text
mcp_session_customers.test_id
test_customer_results.raw_payload.session_customer_id
```

- `src/app/api/field-checks/result/route.ts`
  - Saves admin edits with MCP context in `raw_payload`:

```text
session_id
session_customer_id
route_id
session_date
```

- `src/app/api/exports/tests.csv/route.ts`
  - Export now includes route/session columns before the test columns.

5. Stop showing tests as a flat standalone module

- `/field-checks` main list now renders session group cards only.
- Test result rows only appear inside the selected session branch sheet.
- Primary input remains:

```text
/visits -> khách -> Ghi test
```

## Not changed

- `/field-checks` route is not deleted.
- DB schema is not changed.
- Test save remains under `/visits -> khách -> Ghi test` through the existing backend session-customer action.

## Smoke checks

```text
/mcp
/routes
/visits?routeId=<routeId>&date=<yyyy-mm-dd>
/mcp/sessions
/field-checks
/api/backend/exports/tests.csv
```

Expected:

```text
- Bottom nav has no Test item.
- Sidebar has no Test sản phẩm item.
- MCP copy explains Test is inside session.
- Session history card shows test count as a branch count.
- /field-checks shows session groups, not flat test rows.
- Opening one session group shows its test rows.
- Export tests has route_id, route_name, session_date, session_id, session_customer_id columns.
```
