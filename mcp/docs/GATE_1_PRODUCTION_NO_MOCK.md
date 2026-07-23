# Gate 1 - Production no-mock

Goal: production must not silently show mock data when backend APIs fail.

## Status

Implemented in code:

- `src/lib/api/api-client.ts`
  - production runtime is detected by `NODE_ENV=production` or `VERCEL_ENV=production`.
  - `withMockFallback` only falls back to mock outside production.
  - if production API fails, it throws `production_no_mock: <real error>`.
  - if production has no backend API base URL, it throws `production_no_mock: missing_backend_api_base_url`.

- `src/features/market-reports/MarketReportsPage.tsx`
  - `/reports` was mock-only.
  - production now throws `production_no_mock: /reports is not wired to real market reports API yet` instead of showing fake data.

## Deployment note

Vercel auto deployments for these commits were cancelled by the project's ignored-build setting. Latest production may still point to the previous READY commit until a manual deploy or local push that passes the ignored-build rule is performed.

## Local deploy command

```powershell
cd "F:\1_A_Disk_D\Tool\mcp-plan"
git pull origin main
npm run build
git push origin main
```

If Vercel still cancels due ignored build step, redeploy manually from Vercel dashboard or adjust the ignored-build setting.
