import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Admin local-first uses the shared IndexedDB contract with per-user and per-period scopes', async () => {
  const hook = await read('app/local-read/use-admin-local-read.ts');
  assert.match(hook, /createLocalReadCache/);
  assert.match(hook, /packages\/shared-utils\/browser-local-read-cache\.js/);
  assert.match(hook, /const APP = "admin-mcp-npp"/);
  assert.match(hook, /installationNamespace\(\)/);
  assert.match(hook, /cacheUserId/);
  assert.match(hook, /resourceName\(kind, period\)/);
  assert.match(hook, /schemaVersion: SCHEMA_VERSION/);
  assert.match(hook, /readLocalFirst/);
  assert.match(hook, /setInterval/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /30_000/);
});

test('Admin local-first keeps the last good snapshot on transient refresh failure but clears forbidden data', async () => {
  const hook = await read('app/local-read/use-admin-local-read.ts');
  assert.match(hook, /if \(message === "FORBIDDEN"\) \{/);
  assert.match(hook, /await cache\.clearResource\(activeScope\)/);
  assert.match(hook, /setData\(null\)/);
  assert.match(hook, /if \(message === "UNAUTHORIZED"\) window\.location\.assign\("\/login"\)/);
  assert.match(hook, /setError\(message\)/);
  assert.doesNotMatch(hook, /clearResource\(activeScope\)[\s\S]{0,200}ADMIN_LOCAL_READ_UNAVAILABLE/);
});

test('same-origin Admin local-read route composes existing authoritative Công Ty sources and cursor deltas', async () => {
  const route = await read('app/api/local-read/admin-data/route.ts');
  assert.match(route, /loadControlTower/);
  assert.match(route, /loadProposals/);
  assert.match(route, /loadAlertCenter/);
  assert.match(route, /resolveReportRange/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /currentCursor === nextCursor \? \[\] : \[\{ id, data \}\]/);
  assert.match(route, /full: currentCursor !== nextCursor/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /DATABASE_URL|SUPABASE|SERVICE_ROLE|Authorization:/);
});

test('Admin auth exposes only a pseudonymous cache identity and logout clears local data before ending the session', async () => {
  const [me, logout, shell] = await Promise.all([
    read('app/api/auth/me/route.ts'),
    read('app/admin-logout-form.tsx'),
    read('app/admin-shell.tsx'),
  ]);
  assert.match(me, /export const runtime = 'nodejs'/);
  assert.match(me, /createHash\('sha256'\)/);
  assert.match(me, /cacheUserId/);
  assert.match(me, /admin\.\$\{createHash/);
  assert.doesNotMatch(me, /data:\s*\{[\s\S]{0,300}token[,}]/);
  assert.match(logout, /clearAdminLocalReadForCurrentUser/);
  assert.match(logout, /fetch\("\/api\/auth\/logout"/);
  assert.match(logout, /finally[\s\S]*window\.location\.assign\("\/login"\)/);
  assert.match(shell, /<AdminLogoutForm \/>/);
});

test('overview, proposals and alerts render local-first while detail and decision paths remain live', async () => {
  const [overviewWrapper, overview, proposalWrapper, proposals, alertWrapper, alerts, proposalDetail, alertDetail] = await Promise.all([
    read('app/page.tsx'),
    read('app/admin-overview-local.tsx'),
    read('app/approvals/page.tsx'),
    read('app/approvals/approvals-local.tsx'),
    read('app/alerts/page.tsx'),
    read('app/alerts/alerts-local.tsx'),
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/alerts/[alertId]/page.tsx'),
  ]);
  for (const wrapper of [overviewWrapper, proposalWrapper, alertWrapper]) {
    assert.doesNotMatch(wrapper, /loadControlTower|loadProposals|loadAlertCenter/);
  }
  assert.match(overview, /useAdminLocalRead<AdminControlTowerData>\("control-tower"/);
  assert.match(overview, /useAdminLocalRead<ProposalItem\[]>\("proposals"/);
  assert.match(overview, /useAdminLocalRead<AlertCenterData>\("alerts"/);
  assert.match(proposals, /useAdminLocalRead<ProposalItem\[]>\("proposals"/);
  assert.match(alerts, /useAdminLocalRead<AlertCenterData>\("alerts"/);
  assert.match(proposalDetail, /loadProposal\(params\.approvalId\)/);
  assert.match(proposalDetail, /ProposalDecisionDialog/);
  assert.match(alertDetail, /loadAlertById/);
  assert.match(alertDetail, /AdminActionBar/);
});

test('cached row payload code contains no authentication or credential fields', async () => {
  const hook = await read('app/local-read/use-admin-local-read.ts');
  const route = await read('app/api/local-read/admin-data/route.ts');
  const rowShape = `${hook}\n${route}`;
  assert.doesNotMatch(rowShape, /sessionToken|accessToken|refreshToken|password|apiKey|secretKey/);
  assert.doesNotMatch(route, /authorization\s*:/i);
});
