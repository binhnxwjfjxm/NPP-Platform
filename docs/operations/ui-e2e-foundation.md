# Core UI and Browser Verification Foundation

## Purpose

The `/foundation` surface verifies the NPP Core foundation through a real browser while keeping the Core API token and provider configuration on the Next.js server. It is an internal diagnostic surface, not a production administration console.

This foundation does not confirm production deployment, production database backup/restore readiness, or Cloudflare R2 provider readiness.

## Routes

```text
GET  /foundation
GET  /api/foundation/status
POST /api/foundation/r2-test
```

All three routes are hidden when `FOUNDATION_TEST_UI_ENABLED` is not exactly `true`. The page uses Next.js `notFound()` so the disabled contract is an actual 404 rather than a client-side warning.

The R2 action is additionally hidden when `FOUNDATION_R2_TEST_ENABLED` is not exactly `true`. It never runs automatically during page load.

## Server-side gateway

The browser calls only same-origin Next.js routes:

```text
browser
  -> Next.js foundation gateway
  -> Authorization header added on the server
  -> allowlisted Core API route
  -> response envelope validated and sanitized
  -> safe browser response
```

The gateway allowlist contains only:

```text
/health/live
/health/ready
/health/authenticated
/api/config
/api/storage/r2-test
```

It is not a generic proxy. Requests have a bounded timeout and a safe request ID. Raw upstream errors, internal URLs, authorization headers, database URLs, provider responses and signed URLs are not returned to the browser.

Required server-only variables:

```text
CORE_API_INTERNAL_URL
CORE_API_SERVER_TOKEN
FOUNDATION_TEST_UI_ENABLED
FOUNDATION_R2_TEST_ENABLED
```

No token or secret may use a `NEXT_PUBLIC_` prefix.

## Foundation status

The UI displays only safe fields:

- Core web loaded;
- Core API live contract;
- PostgreSQL readiness contract;
- authenticated actor, installation, source app and request ID;
- sanitized node environment, installation, database SSL mode and CORS origin count;
- R2 enabled/disabled state and numeric limits;
- last checked timestamp.

The UI never displays the Core API token, database URL, R2 endpoint, bucket name, access keys, signed URLs or raw provider details.

## R2 contract action

The R2 button appears only when `FOUNDATION_R2_TEST_ENABLED=true` and the sanitized Core API config reports both the adapter and Core contract route enabled. The server generates the idempotency key and sends a small server-owned payload to `POST /api/storage/r2-test`. Browser input cannot select a bucket or object key.

R2 remains disabled in CI. No Cloudflare credential is present and no provider call is made.

## Local browser verification

Use an isolated PostgreSQL database and a test-only backend token. Do not use production values.

PowerShell example:

```powershell
$env:E2E_DATABASE_URL="<isolated-local-test-postgres-url>"
$env:E2E_BACKEND_API_TOKEN="<local-test-only-token>"
npx playwright install chromium
npm run test:core-ui-e2e
```

Playwright starts:

```text
Core API                 http://127.0.0.1:3004
Core web, UI disabled    http://127.0.0.1:3003
Core web, UI enabled     http://127.0.0.1:3005
```

The API web server command runs repository migrations against the E2E database before starting. Existing servers are not reused, which prevents stale environment flags from invalidating the disabled/enabled tests.

The default reporter never opens a browser report server. To inspect a completed report manually:

```text
npm --workspace npp-core-web run test:e2e:report
```

## Browser coverage

The suite uses Chromium and verifies:

- `/`, `/login` and `/dashboard` render without browser/page errors;
- same-origin CSS, JavaScript, font and image assets do not fail;
- `/foundation` and both gateway routes are true 404s when disabled;
- enabled status reflects the actual local Core API and PostgreSQL;
- actor and installation remain server-owned despite spoofed headers;
- browser HTML and JSON responses contain no credential-shaped data;
- Refresh re-runs the gateway;
- a gateway outage renders a safe recoverable error state;
- the R2 action remains hidden in CI.

## CI

`.github/workflows/core-ui-e2e.yml` uses Ubuntu 24.04, Node 20, an isolated PostgreSQL 16 service, temporary runner-only credentials, Core API verification, Core web unit/typecheck/build verification and Chromium Playwright E2E. Reports, traces, screenshots and videos are retained only on failure.

The workflow does not call Vercel, Heroku, Supabase, Cloudflare R2 or any other production service. It does not contain production provider credentials.

## Security and operational boundaries

- Foundation UI is disabled by default.
- Missing server gateway configuration fails closed.
- Production requires HTTPS for the internal Core API URL.
- No arbitrary upstream target is accepted from the browser.
- No authorization header is logged or returned.
- Playwright uses test-only credentials.
- Report and trace directories are ignored by Git.
- Production deployment remains a separate accountable action after merge.

## Phase gate

The Phase 2 UI/browser gate remains open until the PR is green and merged. Only after that gate closes should the first business vertical slice be selected:

```text
migration
-> backend API
-> frontend UI
-> unit test
-> integration test
-> browser/E2E test
-> CI
-> merge
```
