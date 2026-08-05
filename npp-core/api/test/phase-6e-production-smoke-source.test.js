import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/phase-6e-production-smoke.sh', import.meta.url);
const workflowUrl = new URL('../../../.github/workflows/phase-6e-production-smoke-manual.yml', import.meta.url);

test('Phase 6E production smoke is exact-main, fail-closed and scoped to Core/NPP/Delivery', async () => {
  const [script, workflow] = await Promise.all([
    readFile(scriptUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
  ]);

  for (const marker of [
    '/smoke-phase-6e-production',
    'github.event.issue.number == 5',
    'DEPLOY_REF: main',
    'HEROKU_APP_NAME: hung-phat',
    'https://office.nguyenlieuhungphat.com',
    'https://npp-platform.vercel.app',
    'https://log.nguyenlieuhungphat.com',
    'persist-credentials: false',
    'SOURCE_SHA=',
    'issues/262/comments',
  ]) {
    assert.ok(workflow.includes(marker), `workflow missing ${marker}`);
  }

  for (const marker of [
    'test "$HEROKU_APP_NAME" = "hung-phat"',
    '/api/logistics/routes?limit=1',
    '/api/logistics/vehicles?limit=1',
    '/api/logistics/drivers?limit=1',
    '/api/logistics/drivers?active=true&limit=1',
    '/api/logistics/trips?limit=1&offset=0',
    '/api/logistics/driver/trips?limit=1&offset=0',
    '/attempts',
    '/reconciliation',
    '/pod',
    '/logistics/dispatch',
    '/logistics/delivery-attempts',
    '/logistics/trip-reconciliation',
    'delivery_auth_source="core-web-bootstrap"',
    'delivery_auth_source="delivery-secret"',
    'DELIVERY_AUTH_SOURCE=',
    'DRIVER_PROFILE_READY=true',
    'expect_one_of',
    'curl_exit=$?',
    'rm -f "$response_file"',
    "assert_error_code 'DELIVERY_TRIP_NOT_FOUND'",
    "assert_error_code 'DELIVERY_ATTEMPT_NOT_FOUND'",
    "! grep -q 'Không tải được chuyến'",
    'R2_ENABLED',
    'R2_CONFIGURATION_COMPLETE',
    'POD_OPTIONAL_ROUTE=success',
    'PHASE_6E_PRODUCTION_SMOKE=success',
  ]) {
    assert.ok(script.includes(marker), `script missing ${marker}`);
  }

  assert.ok(!workflow.includes('hung-phat-mcp'));
  assert.ok(!script.includes('mcp.nguyenlieuhungphat.com'));
  assert.ok(!script.includes('${DELIVERY_WEB_USERS_JSON:?'));
  assert.ok(!script.includes('head -c 1000'));
  assert.ok(!script.includes('|| true'));
  assert.match(script, /if \[ -n "\$\{DELIVERY_WEB_USERS_JSON:-\}" \]; then/);
  assert.match(script, /if \[ "\$curl_exit" -ne 0 \]; then/);
  assert.match(script, /if \[ "\$r2_enabled" = true \]; then/);
  assert.match(script, /Core unauthenticated \$path.*401/);
  assert.match(script, /Core optional POD driver route' 404/);
});
