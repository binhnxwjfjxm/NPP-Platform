import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Admin local-first uses shared IndexedDB with a session-bound identity and no auth fetch before local data', async () => {
  const [hook, identity, identityServer, layout] = await Promise.all([
    read('app/local-read/use-admin-local-read.ts'),
    read('app/local-read/admin-local-identity.ts'),
    read('app/local-read/admin-local-identity-server.ts'),
    read('app/layout.tsx'),
  ]);
  assert.match(hook, /createLocalReadCache/);
  assert.match(hook, /packages\/shared-utils\/browser-local-read-cache\.js/);
  assert.match(hook, /useAdminLocalUserId\(\)/);
  assert.match(hook, /memory = new Map/);
  assert.match(hook, /readLocalFirst/);
  assert.match(hook, /schemaVersion: SCHEMA_VERSION/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /30_000/);
  assert.doesNotMatch(hook, /fetch\("\/api\/auth\/me"/);
  assert.match(identity, /const APP = "admin-mcp-npp"/);
  assert.match(identity, /createContext/);
  assert.doesNotMatch(identity, /sessionStorage|\/api\/auth\/me/);
  assert.match(identityServer, /readAdminSessionToken/);
  assert.match(identityServer, /createHash\("sha256"\)/);
  assert.match(layout, /AdminLocalIdentityProvider/);
  assert.match(layout, /adminLocalCacheUserIdFromSession/);
});

test('Admin local-first keeps the last good snapshot on transient refresh failure but clears forbidden data', async () => {
  const hook = await read('app/local-read/use-admin-local-read.ts');
  assert.match(hook, /if \(message === "FORBIDDEN"\) \{/);
  assert.match(hook, /await cache\.clearResource\(activeScope\)/);
  assert.match(hook, /setData\(null\)/);
  assert.match(hook, /setError\(message\)/);
});

test('same-origin Admin local-read route composes authoritative sources including report tabs and cursor deltas', async () => {
  const route = await read('app/api/local-read/admin-data/route.ts');
  assert.match(route, /loadControlTower/);
  assert.match(route, /loadProposals/);
  assert.match(route, /loadAlertCenter/);
  assert.match(route, /loadLotCPresentation/);
  assert.match(route, /resolveReportRange/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /currentCursor === nextCursor \? \[\] : \[\{ id, data \}\]/);
  assert.match(route, /full: currentCursor !== nextCursor/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /DATABASE_URL|SUPABASE|SERVICE_ROLE|Authorization:/);
});

test('Admin auth exposes only a pseudonymous cache identity and logout clears local data before ending the session', async () => {
  const [me, logout, shell] = await Promise.all([read('app/api/auth/me/route.ts'), read('app/admin-logout-form.tsx'), read('app/admin-shell.tsx')]);
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

test('overview, proposals, alerts and report tabs render local-first while detail and decision paths remain live', async () => {
  const [overviewWrapper, overview, proposalWrapper, proposals, alertWrapper, alerts, reportsWrapper, reports, proposalDetail, alertDetail] = await Promise.all([
    read('app/page.tsx'), read('app/admin-overview-local.tsx'), read('app/approvals/page.tsx'), read('app/approvals/approvals-local.tsx'), read('app/alerts/page.tsx'), read('app/alerts/alerts-local.tsx'), read('app/reports/page.tsx'), read('app/reports/ReportsLocal.tsx'), read('app/approvals/[approvalId]/page.tsx'), read('app/alerts/[alertId]/page.tsx')
  ]);
  for (const wrapper of [overviewWrapper, proposalWrapper, alertWrapper, reportsWrapper]) assert.doesNotMatch(wrapper, /loadControlTower|loadProposals|loadAlertCenter|loadLotCPresentation/);
  assert.match(overview, /useAdminLocalRead<AdminControlTowerData>\("control-tower"/);
  assert.match(proposals, /useAdminLocalRead<ProposalItem\[]>\("proposals"/);
  assert.match(alerts, /useAdminLocalRead<AlertCenterData>\("alerts"/);
  assert.match(reports, /useAdminLocalRead<LotCPresentation>\("reports"/);
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
