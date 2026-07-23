# Gate 4 - Reports + Field-checks real data

Goal: remove mock-only nghiệp vụ khỏi `/reports` và `/field-checks`.

## Status in repo

Implemented:

- `/reports`
  - `src/features/market-reports/MarketReportsPage.tsx`
  - Reads real `market_reports` via Supabase REST.
  - Builds KPI from real rows.
  - Removed mock-only production block.

- `/field-checks`
  - `src/features/market-checks/MarketChecksPage.tsx`
  - Reads real `test_files`, `test_customers`, `test_customer_results`.
  - Builds list from result rows first, then customers without results.

- Field-check save form
  - `src/features/market-checks/MarketChecksClientPage.tsx`
  - Bottom sheet now has real form: product name, result status, note.
  - Saves to `/api/field-checks/result`.

- Field-check save API
  - `src/app/api/field-checks/result/route.ts`
  - If `resultId` exists, PATCH `test_customer_results`.
  - If no `resultId`, POST a new `test_customer_results` row using `fileId + customerId`.

## Deployment note

Vercel auto deploy is still being canceled by the ignored-build setting. Production will not include Gate 4 until a manual deploy/local push passes the Vercel setting.

## Test checklist after deploy

```text
/reports -> must render real market_reports rows, no mock
/field-checks -> must render real test files/customers/results
/field-checks -> Nhập -> Lưu kết quả -> writes test_customer_results
/api/backend/exports/market-reports.csv -> still exports real reports
/api/backend/exports/tests.csv -> includes new field-check result
```
