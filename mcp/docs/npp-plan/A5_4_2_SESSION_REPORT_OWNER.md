# A5.4.2 — Session report write ownership

> Trạng thái: **SOURCE / DB / VPS RUNTIME VERIFIED — RELEASE PENDING**  
> Ngày cập nhật: **2026-07-16**  
> PR: **#22**  
> Merge commit: `92e56223570a956d7f272e21859ef75051bb5fdc`

## 1. A5.4.1 verification

Production Foundation Gateway health returned a canonical success response and confirmed:

- service is configured;
- installation context is configured;
- provider is configured;
- authentication boundary is `proxy-service`.

The source baseline before A5.4.2 retained 10 reachable direct REST mutation fingerprints after A5.4.1 retirements.

## 2. Caller audit

The complete `src` audit found only two definitions of `saveMcpSessionReportSnapshot` and no live callers:

```text
src/lib/mcp/session-report-snapshot.ts
src/lib/mcp/session-report.ts
```

Both definitions performed direct service-role PostgREST upserts to `mcp_session_reports`. They were dead duplicate write owners and have been removed.

The public mutation entry already existed:

```text
POST /api/mcp-session-report
-> Next proxy
-> Foundation Gateway
-> backend session-report use case
-> mcp_create_session_report_snapshot
```

Read-only report summary construction remains in `src/lib/mcp/session-report.ts`; the file no longer reads service-role configuration or performs POST/upsert operations.

## 3. Canonical aggregate owner

The Foundation Gateway now owns both writes before any legacy forwarding:

```text
POST /api/mcp-session-report
POST /api/mcp-session-report/ai-result
```

Backend use cases:

```text
createSessionReportSnapshot
saveSessionReportAiResult
```

Database owners:

```text
mcp_create_session_report_snapshot
mcp_save_session_report_ai_result
```

The legacy direct `supabasePatch("mcp_session_reports", ...)` AI writer and its route were removed from `apps/backend/server.js`.

## 4. AI result transaction contract

`mcp_save_session_report_ai_result`:

1. validates explicit `session_id` and object `ai_result`;
2. locks the existing report row by `session_id`;
3. fails when no snapshot exists;
4. updates one report row only;
5. stores `ai_result`, `ai_analyzed_at` and Foundation actor/request context;
6. returns the updated row and analyzed timestamp;
7. grants execution only to `service_role`.

## 5. Retired fingerprints

```text
ea324aaa3d01a7941bf3aa3f  Next duplicate snapshot writer
1502e64fc75da4598b208f1a  Next duplicate snapshot writer
6a660d7d414afe70cd88cc4d  legacy direct AI-result patch
```

Verified direct REST mutation debt after this slice:

```text
10 -> 7
```

## 6. Source, CI and database verification

```text
[x] Foundation CI pass — run 29499830985
[x] direct mutation scanner reports legacyDebt=7
[x] backend foundation tests pass
[x] TypeScript typecheck pass
[x] frontend production build pass
[x] migration 20260716193000_save_session_report_ai_result.sql applied to production
[x] service_role can execute AI RPC
[x] anon/authenticated cannot execute AI RPC
[x] sequential two-call database transaction smoke pass
[x] original production report values restored; smoke marker rows = 0
```

Production database smoke used the existing report for session:

```text
mrs_cb8fd2bdce284568985f9864636b4f92
```

The same report identity was retained across both calls, Foundation context persisted, and original values were restored after verification.

## 7. VPS deployment verification

`pullmcp` completed successfully on the production VPS on 2026-07-16.

```text
[x] backend verify passed: 47/47 tests
[x] runtime environment exact: public 127.0.0.1:3001, legacy 127.0.0.1:3102
[x] PM2 mcp-plan-backend online, restart count 0
[x] Foundation boundary smoke: health=200, without_token=401, with_token=200, denied_origin=403
[x] F0.2_VPS_SMOKE=PASS
[x] canonical health response returned requestId
[x] error log cleared and remained 0 bytes after a fresh health request
[x] port ownership verified
```

Verified port ownership:

```text
127.0.0.1:3001  MCP Foundation Gateway
127.0.0.1:3102  MCP legacy internal runtime
*:3002           milktea-backend, separate PID and untouched
```

The prior `EADDRINUSE 127.0.0.1:3002` entries were historical PM2 log content. After truncating only `mcp-plan-backend-error.log`, a new health request produced no new errors.

## 8. Remaining release gates

```text
[ ] authenticated production mutation smoke through the deployed A5.4.2 report routes
[ ] Vercel production deployment ready on current main
```

The report-specific production API smoke must use a safe existing report and restore any changed value, or use a disposable test record with complete cleanup. Do not expose proxy tokens or service-role credentials in evidence.

Vercel did not deploy the merge or the no-diff trigger commit because the account returned `build-rate-limit`. This is an account-level release blocker, not a source or build failure.

Known Vercel state at the time of this update:

```text
merge commit:             92e56223570a956d7f272e21859ef75051bb5fdc
no-diff trigger commit:   3656a60858c950377657a01ca5dcd9eeaf991feb
latest production commit: c9f6be92f261f57b347490d38a64288f04ad9318
A5.4.2 preview commit:     42f3199c37a26e4e87669d2e9c94155f5993446a
```

## 9. Handoff

A5.4.2 is deployed and healthy on the VPS, and its database ownership is verified. It is not yet marked fully released because the report-specific production Gateway mutation smoke and Vercel production deployment are still pending.

Next executable work:

1. record a safe authenticated production smoke for both A5.4.2 report routes;
2. retain Vercel as an explicit external blocker until production updates;
3. begin **A5.4.3 audit only** for Report Settings mutations;
4. target direct mutation debt `7 -> 3` in A5.4.3 implementation after the audit is accepted;
5. do not start Order Core yet.

Every completed phase or subphase must update this evidence and the root `CURRENT_PROGRESS.md` in the repository before it is declared complete.