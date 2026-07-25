# Core UI & Playwright E2E Foundation Testing Guide

## Overview

This document explains the foundation UI component and the server-side API gateway pattern used in NPP Core's Phase 2b — Core UI foundation + browser verification gate.

**Purpose**: Verify that the Core API foundation works correctly through a real browser client, and ensure security boundaries are maintained (no token leakage, no credential exposure).

## Architecture Pattern: Server-Side Gateway

### Why Server-Side Gateway?

The Core API token must **never** reach the browser. If a frontend token is exposed via GitHub secret leak or dependency compromise, attackers could impersonate the web server to the API.

### The Pattern

```
Browser → Next.js Server Route (/api/foundation/status)
                ↓
         Server-only variables (CORE_API_SERVER_TOKEN)
                ↓
         Core API (/health/authenticated)
                ↓
         Response sanitized (no secrets)
                ↓
Browser (safe data only)
```

**Key Principle**: Use `process.env` (which includes all env vars) for server-only routes, never `process.env.NEXT_PUBLIC_*`.

### Implementation Files

- **Foundation UI Page**: `npp-core/web/app/foundation/page.tsx` — React component fetches from `/api/foundation/status` and displays safe data
- **Gateway Routes**: `npp-core/web/app/api/foundation/`:
  - `status/route.ts` — Calls Core API health endpoints, returns sanitized status
  - `r2-test/route.ts` — Tests R2 adapter presign endpoint (disabled by default)

## Environment Variables

### Server-Only (Never NEXT_PUBLIC_*)

These variables are **only** accessible on the Next.js server and never exposed to the browser.

```bash
# npp-core/web/.env or .env.local
CORE_API_INTERNAL_URL=http://127.0.0.1:3004        # Internal URL for server-side calls
CORE_API_SERVER_TOKEN=test-placeholder-token        # Backend API token (keep secret!)
FOUNDATION_TEST_UI_ENABLED=false                    # Enable/disable test UI
FOUNDATION_R2_TEST_ENABLED=false                    # Enable/disable R2 test
```

### Public (Safe for Browser)

```bash
NEXT_PUBLIC_CORE_API_URL=http://127.0.0.1:3004    # Frontend app config
NEXT_PUBLIC_INSTALLATION_ID=npp-local              # Non-sensitive app info
```

## Development Setup

### 1. Enable Foundation UI Locally

```bash
cd npp-core/web

# Copy env template and edit
cp .env.example .env.local

# Set foundation UI to enabled
echo "FOUNDATION_TEST_UI_ENABLED=true" >> .env.local
echo "FOUNDATION_R2_TEST_ENABLED=false" >> .env.local  # Safe default

# Set server token (use dummy value for local testing)
echo "CORE_API_SERVER_TOKEN=local-test-token" >> .env.local
```

### 2. Start Services

```bash
# Terminal 1: Core API (port 3004)
cd npp-core/api
npm run dev

# Terminal 2: Core Web (port 3003)
cd npp-core/web
npm run dev

# Terminal 3: Visit foundation UI
open http://localhost:3003/foundation
```

### 3. View Foundation Status

Once enabled, the foundation UI at `http://localhost:3003/foundation` displays:

- **Core API Status**: Live and ready health checks
- **Authenticated Context**: Actor ID, installation ID, request tracking
- **Sanitized Config**: Environment, port, non-sensitive settings
- **R2 State**: Whether object storage adapter is enabled (with NO credentials shown)
- **Server Timestamp**: When status was captured

## Running Playwright E2E Tests

### Locally (With Foundation Enabled)

```bash
cd npp-core/web

# Development (foundation disabled by default)
npm run test:e2e        # Runs with default .env (foundation disabled)

# Headed mode (see browser)
npm run test:e2e:headed

# View report after tests
npm run test:e2e:report
```

### In CI

Foundation UI is **enabled** in CI to test the gateway pattern:
- `.env.local` is created with `FOUNDATION_TEST_UI_ENABLED=true`
- R2 test is **disabled** (`FOUNDATION_R2_TEST_ENABLED=false`) to avoid real file ops
- PostgreSQL is ephemeral (test database recreated each run)
- Reports uploaded as CI artifacts

**CI Workflow**: `.github/workflows/core-ui-e2e.yml`

## Test Coverage

### Routes Smoke Tests (`e2e/routes.spec.ts`)

✓ `/`, `/login`, `/dashboard` load without 404  
✓ No uncaught console errors  
✓ No sensitive data in HTML  
✓ Static assets (CSS, JS) load successfully  

### Foundation UI Tests (`e2e/foundation.spec.ts`)

✓ Foundation UI returns 404 when disabled (default)  
✓ Foundation API endpoints return 404 when disabled  
✓ When enabled, foundation page displays safe status  
✓ API status shows without backend token exposure  
✓ No R2 credentials/bucket/endpoint leaked  
✓ No database URLs leaked  
✓ No signed URLs leaked  
✓ Client-side spoofing (fake headers) ignored  
✓ Gateway failures handled gracefully  
✓ No uncaught errors on foundation page  

## Security Checklist

- [ ] Core API token (`CORE_API_SERVER_TOKEN`) never appears on any page
- [ ] R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) never in browser
- [ ] Database URL (`DATABASE_URL`) never in browser  
- [ ] Signed URLs (with `X-Amz-Signature`) never returned to browser
- [ ] Authorization headers never sent from browser to Core API
- [ ] Server-only variables use `process.env`, not `process.env.NEXT_PUBLIC_*`
- [ ] Gateway routes sanitize responses (remove secrets before JSON response)
- [ ] Console logs don't include tokens or credentials
- [ ] localStorage/sessionStorage/cookies don't contain auth tokens

## Troubleshooting

### Foundation UI Shows "Not Found" Instead of Status

**Issue**: Page returns 404 or "Foundation UI is not enabled"  
**Solution**: Check that `FOUNDATION_TEST_UI_ENABLED=true` is set in `.env.local`

```bash
echo "FOUNDATION_TEST_UI_ENABLED=true" >> npp-core/web/.env.local
npm run dev
```

### Playwright Tests Hang or Timeout

**Issue**: Tests wait for servers to start  
**Solution**: Ensure Core API and Core Web are not already running on ports 3004 and 3003

```bash
# Kill existing processes
lsof -i :3004 -i :3003 | xargs kill -9

# Run tests
npm run test:e2e
```

### "Failed to fetch foundation status" Error

**Issue**: Gateway route can't reach Core API  
**Solution**: Check Core API is running and `CORE_API_INTERNAL_URL` is correct

```bash
# Test Core API directly
curl http://127.0.0.1:3004/health/live

# Check env var
cat npp-core/web/.env.local | grep CORE_API_INTERNAL_URL
```

### R2 Test Returns "Disabled" in CI

**Issue**: R2 presign endpoint not tested in CI  
**Expected**: This is by design. R2 test is disabled by default (`FOUNDATION_R2_TEST_ENABLED=false`)  
**To Enable**: Set `FOUNDATION_R2_TEST_ENABLED=true` in CI workflow (requires R2 test credentials)

## Phase 2b Gate Requirements

To pass the Phase 2b — Core UI foundation + browser verification gate:

- [ ] Foundation UI secure (no secrets in UI, API responses, or logs)
- [ ] Authenticated gateway works (server-side token used for Core API calls)
- [ ] E2E tests pass on actual Core API + ephemeral PostgreSQL
- [ ] Spoofing attempts don't override server context
- [ ] No browser console errors
- [ ] CI workflow runs Playwright tests with PostgreSQL service
- [ ] All routes smoke test pass (no 404s, no leaks)
- [ ] Foundation disabled by default in `.env.example`
- [ ] Documentation complete (this file)

## Related Files

- **Foundation UI Component**: [npp-core/web/app/foundation/page.tsx](../../npp-core/web/app/foundation/page.tsx)
- **Status Gateway Route**: [npp-core/web/app/api/foundation/status/route.ts](../../npp-core/web/app/api/foundation/status/route.ts)
- **R2 Test Gateway Route**: [npp-core/web/app/api/foundation/r2-test/route.ts](../../npp-core/web/app/api/foundation/r2-test/route.ts)
- **Playwright Config**: [npp-core/web/playwright.config.ts](../../npp-core/web/playwright.config.ts)
- **E2E Test Suite**: [npp-core/web/e2e/](../../npp-core/web/e2e/)
- **CI Workflow**: [.github/workflows/core-ui-e2e.yml](../../.github/workflows/core-ui-e2e.yml)
- **Master Plan**: [NPP_PLATFORM_MASTER_PLAN.md](../../NPP_PLATFORM_MASTER_PLAN.md#phase-2b--core-ui-foundation--browser-verification)

## Next: Phase 3 — Master Data

After Phase 2b gate passes, the platform can begin Phase 3 work:
- Installation/company configuration
- Branches, warehouses, locations
- Users, employees, roles, scopes
- Master data import and validation

The foundation established here (secure gateway pattern, E2E testing, context propagation) will be reused throughout Phase 3 and beyond.
