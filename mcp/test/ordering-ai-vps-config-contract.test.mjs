import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Ordering AI production configuration uses Công Ty VPS as authority and keeps Dialogflow CX shared with Website', async () => {
  const workflow = await read('.github/workflows/ordering-ai-production-config-manual.yml');

  assert.match(workflow, /\/configure-ordering-ai-production/);
  assert.match(workflow, /VPS_COMPANY_HOST: \$\{\{ vars\.VPS_COMPANY_HOST \}\}/);
  assert.match(workflow, /VPS_COMPANY_SSH_KEY/);
  assert.match(workflow, /\/etc\/npp\/company\.env/);
  assert.match(workflow, /ORDERING_AI_API_TOKEN/);
  assert.match(workflow, /WEBSITE_AI_API_TOKEN/);
  assert.match(workflow, /COMPANY_WEBSITE_AI_API_TOKEN/);
  assert.match(workflow, /COMPANY_API_URL="https:\/\/\$VPS_COMPANY_HOST"/);
  assert.match(workflow, /Website Dialogflow CX gateway/);
  assert.match(workflow, /x-ordering-ai-gateway/);
  assert.match(workflow, /dialogflow-cx-\(\?:flow\|playbook\)-text/);
  assert.match(workflow, /ORDERING_AI_PROVIDER=dialogflow-cx/);
  assert.match(workflow, /Redeploy Website before Ordering/);
  assert.match(workflow, /Redeploy Customer Ordering after Website gateway passes/);
  assert.match(workflow, /website_ai_token_probe_failed/);
  assert.match(workflow, /ordering_gateway_auth_probe_failed/);
  assert.match(workflow, /v10\/projects\/\$\{encodeURIComponent\(projectId\)\}\/env/);
  assert.match(workflow, /url\.searchParams\.set\('upsert', 'true'\)/);
  assert.doesNotMatch(workflow, /v9\/projects\/\$\{encodeURIComponent\(projectId\)\}\/env\/\$\{encodeURIComponent\(id\)\}/);

  assert.doesNotMatch(workflow, /HEROKU_API_KEY|api\.heroku\.com|HEROKU_APP_NAME|hung-phat-mcp/);

  const websiteStep = workflow.indexOf('- name: Redeploy Website before Ordering');
  const smokeStep = workflow.indexOf('- name: Verify Công Ty auth, Website usage binding and Dialogflow CX gateway');
  const orderingStep = workflow.indexOf('- name: Redeploy Customer Ordering after Website gateway passes');
  assert.ok(websiteStep >= 0 && smokeStep > websiteStep && orderingStep > smokeStep);
});
