import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const cutoverPaths = [
  'npp-core/api/scripts/vps-production-cutover-preflight-958.sh',
  'npp-core/api/scripts/vps-production-cutover-db-958.sh',
  'npp-core/api/scripts/vps-production-cutover-runtime-958.sh',
  'npp-core/api/scripts/vps-production-cutover-deploy-958.sh',
  'npp-core/api/scripts/vps-production-cutover-wiring-958.sh',
];
const readCutover = async () => (await Promise.all(cutoverPaths.map(read))).join('\n');

test('Issue 958 final cutover is manual-only, exact-main and gated by exact-head CI', async () => {
  const workflow = await read('.github/workflows/vps-production-cutover-manual.yml');
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/cutover-vps-production-958'/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /foundation-f0-2\.yml\/runs\?head_sha=\$CUTOVER_SHA&event=push/);
  assert.match(workflow, /conclusion=="success"/);
  assert.match(workflow, /VPS_DB_SSH_KEY/);
  assert.match(workflow, /VPS_COMPANY_SSH_KEY/);
  assert.match(workflow, /VPS_MCP_SSH_KEY/);
  assert.match(workflow, /vps-production-cutover-958\.sh/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch):\s*$/m);
});

test('final DB cutover reuses reconciliation but targets a dedicated production database', async () => {
  const [script, rehearsal] = await Promise.all([
    readCutover(),
    read('npp-core/api/scripts/vps-db-heroku-rehearsal-958.sh'),
  ]);
  assert.match(rehearsal, /restore_db="npp_rehearsal_958"/);
  assert.match(script, /PRODUCTION_DB="npp_production"/);
  assert.match(script, /COMPANY_DB_ROLE="npp_company_runtime"/);
  assert.match(script, /MCP_DB_ROLE="mcp_runtime"/);
  assert.ok(script.includes("sed '/^resolve_heroku_database$/,$d' npp-core/api/scripts/vps-db-heroku-rehearsal-958.sh"));
  assert.match(script, /restore_db="npp_production"/);
  assert.match(script, /SOURCE_PENDING_CORE_COUNT/);
  assert.match(script, /SOURCE_PENDING_MCP_COUNT/);
  assert.match(script, /heroku.*formation\/web/);
  assert.match(script, /set_web_quantity "\$HEROKU_COMPANY_APP" 0/);
  assert.match(script, /set_web_quantity "\$HEROKU_MCP_APP" 0/);
  assert.match(script, /FINAL_BACKUP_R2=PASS/);
  assert.match(script, /shared\.grant_mcp_runtime_access/);
  assert.match(script, /hostssl \$db \$company_role/);
  assert.match(script, /hostssl \$db \$mcp_role/);
  assert.doesNotMatch(script, /PRODUCTION_DB="npp_rehearsal_958"/);
});

test('production HTTPS is trusted, renewable and starts frozen', async () => {
  const script = await readCutover();
  assert.match(script, /certbot>=5\.4,<6/);
  assert.match(script, /--preferred-profile shortlived/);
  assert.match(script, /--ip-address "\$ip"/);
  assert.match(script, /npp-ip-cert-renew\.timer/);
  assert.match(script, /NPP958 CUTOVER FREEZE/);
  assert.match(script, /return 503/);
  assert.match(script, /location = \/health\/live/);
  assert.match(script, /location = \/health\/ready/);
  assert.match(script, /set_ingress_mode open/);
  assert.match(script, /opened_writes=true/);
  assert.match(script, /Failure occurred after production write-open; re-freezing VPS ingress/);
  assert.doesNotMatch(script, /find \/etc\/nginx\/sites-enabled[^\n]+-delete/);
});

test('all seven Vercel frontends are accounted for with exact per-consumer wiring', async () => {
  const script = await readCutover();
  for (const project of [
    'prj_vFEAzoxesLqNJIfD8uF4q1kytpvk',
    'prj_854SWdJeDEOPezAvvTZzTaRvZUSq',
    'prj_0hp2A8WyUW4zgglShPTzL70hesVC',
    'prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux',
    'prj_1O9Ob6ZptSqZOBpxKbpn3Ujfm811',
    'prj_rXqH83GFDHuEGUcQrrv82JBPWnjU',
    'prj_btLk3p4FhmShgKFdRBMq6ZFOagKe',
  ]) assert.match(script, new RegExp(project));
  assert.match(script, /project_env_value "\$PROJECT_COMPANY" CORE_API_INTERNAL_URL/);
  assert.match(script, /project_env_value "\$PROJECT_DELIVERY" CORE_API_INTERNAL_URL/);
  assert.match(script, /project_env_value "\$PROJECT_RETAIL" CORE_API_INTERNAL_URL/);
  assert.match(script, /project_env_value "\$PROJECT_ORDERING" CORE_API_BASE_URL/);
  assert.match(script, /project_env_value "\$PROJECT_MCP" BACKEND_API_BASE_URL/);
  assert.match(script, /upsert_env "\$PROJECT_COMPANY" CORE_API_INTERNAL_URL "\$company_api_url"/);
  assert.match(script, /upsert_env "\$PROJECT_COMPANY" NEXT_PUBLIC_CORE_API_URL "\$company_api_url"/);
  assert.match(script, /upsert_env "\$PROJECT_ADMIN" CORE_API_INTERNAL_URL "\$company_api_url"/);
  assert.match(script, /upsert_env "\$PROJECT_DELIVERY" CORE_API_INTERNAL_URL "\$company_api_url"/);
  assert.match(script, /upsert_env "\$PROJECT_RETAIL" CORE_API_INTERNAL_URL "\$company_api_url"/);
  assert.match(script, /upsert_env "\$PROJECT_ORDERING" CORE_API_BASE_URL "\$company_api_url"/);
  assert.match(script, /upsert_env "\$PROJECT_MCP" BACKEND_API_BASE_URL "\$mcp_api_url"/);
  assert.match(script, /WEBSITE_BACKEND_BINDING=not_applicable/);
  assert.match(script, /restore_vercel_bindings/);
});

test('Delivery and Retail deployments cannot silently rewire Công Ty back to Heroku', async () => {
  const [deliveryWorkflow, deliveryScript, retailWorkflow, retailScript] = await Promise.all([
    read('.github/workflows/vercel-delivery-production-manual.yml'),
    read('delivery/web/scripts/deploy-production.sh'),
    read('.github/workflows/vercel-retail-production-manual.yml'),
    read('retail/web/scripts/deploy-production.sh'),
  ]);
  for (const source of [deliveryWorkflow, deliveryScript, retailWorkflow, retailScript]) {
    assert.doesNotMatch(source, /HEROKU_API_KEY|CORE_HEROKU_APP_NAME|api\.heroku\.com/);
  }
  for (const script of [deliveryScript, retailScript]) {
    assert.match(script, /vercel@58\.0\.0 pull --yes --environment=production/);
    assert.match(script, /\.vercel\/\.env\.production\.local/);
    assert.match(script, /CORE_API_INTERNAL_URL/);
    assert.match(script, /hostname\.endsWith\('\.herokuapp\.com'\)/);
    assert.match(script, /\/health\/live/);
    assert.match(script, /\/health\/ready/);
  }
});

test('runtime manifest locks target topology and Gate B through F completion contract', async () => {
  const doc = await read('docs/operations/vps-production-runtime-manifest.md');
  for (const marker of [
    'npp_production',
    'npp_company_runtime',
    'mcp_runtime',
    'npp_rehearsal_958',
    '/cutover-vps-production-958',
    'GATE_B_PREFLIGHT=PASS',
    'GATE_C_FINAL_DB=PASS',
    'GATE_D_RUNTIME_HTTPS=PASS',
    'GATE_E_FRONTEND_WIRING=PASS',
    'GATE_F_AUTHORITY_PROOF=PASS',
    'PRODUCTION_DB_CUTOVER=true',
    'PRODUCTION_TRAFFIC_CUTOVER=true',
    'PROXY_LISTENER_COUNT=300',
  ]) assert.ok(doc.includes(marker), marker);
  assert.match(doc, /Website[^\n]+không có backend binding/);
  assert.match(doc, /ưu tiên hơn.*Heroku/s);
});
