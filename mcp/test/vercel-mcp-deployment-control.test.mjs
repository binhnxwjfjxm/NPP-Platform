import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  mcpWorkflow,
  repairWorkflow,
  coreWorkflow,
  foundationWorkflow,
  mcpConfigSource,
  nextConfig,
  runtimeValidator,
  envExample,
  loginPage,
  internalAuthClient,
] = await Promise.all([
  read(".github/workflows/vercel-mcp-production-manual.yml"),
  read(".github/workflows/vercel-mcp-auth-wiring-repair-manual.yml"),
  read(".github/workflows/vercel-production-manual.yml"),
  read(".github/workflows/foundation-f0-2.yml"),
  read("mcp/vercel.json"),
  read("mcp/next.config.mjs"),
  read("mcp/scripts/validate-runtime-config.mjs"),
  read("mcp/.env.example"),
  read("mcp/src/app/login/page.tsx"),
  read("mcp/src/lib/internal-auth-client.ts"),
]);

const mcpConfig = JSON.parse(mcpConfigSource);
const CORE_PROJECT_ID = "prj_vFEAzoxesLqNJIfD8uF4q1kytpvk";
const MCP_PROJECT_ID = "prj_854SWdJeDEOPezAvvTZzTaRvZUSq";

test("MCP Vercel automatic deployments stay disabled and commands are manual-only", () => {
  assert.equal(mcpConfig.git?.deploymentEnabled, false);
  assert.match(mcpWorkflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(mcpWorkflow, /^\s{2}issue_comment:\s*$/m);
  assert.doesNotMatch(mcpWorkflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.match(mcpWorkflow, /github\.event\.issue\.number == 5/);
  assert.match(mcpWorkflow, /'\/deploy-vercel-mcp-production'/);
  assert.doesNotMatch(mcpWorkflow, /'\/deploy-vercel-production'/);
  assert.match(coreWorkflow, /\/deploy-vercel-production/);
});

test("MCP production deploy is pinned to the dedicated project and exact main CI", () => {
  assert.match(mcpWorkflow, new RegExp(`VERCEL_PROJECT_ID:\\s*${MCP_PROJECT_ID}`));
  assert.match(mcpWorkflow, new RegExp(`CORE_VERCEL_PROJECT_ID:\\s*${CORE_PROJECT_ID}`));
  assert.match(mcpWorkflow, /MCP_ROOT_DIRECTORY: mcp/);
  assert.match(mcpWorkflow, /git fetch --prune --no-tags origin/);
  assert.match(mcpWorkflow, /git rev-parse origin\/main/);
  assert.match(mcpWorkflow, /foundation-f0-2\.yml\/runs\?head_sha=\$TARGET_SHA&event=push/);
  assert.match(mcpWorkflow, /conclusion=="success"/);
  assert.match(mcpWorkflow, /unexpected_mcp_vercel_project/);
  assert.match(mcpWorkflow, /unexpected_mcp_root_directory/);
});

test("MCP Field locks both production dependencies to VPS and never resolves them from Heroku", () => {
  assert.match(mcpWorkflow, /VPS_COMPANY_HOST: \$\{\{ vars\.VPS_COMPANY_HOST \}\}/);
  assert.match(mcpWorkflow, /VPS_MCP_HOST: \$\{\{ vars\.VPS_MCP_HOST \}\}/);
  assert.match(mcpWorkflow, /CORE_API_INTERNAL_URL=\$company_url/);
  assert.match(mcpWorkflow, /BACKEND_API_BASE_URL=\$mcp_url/);
  assert.match(mcpWorkflow, /"CORE_API_INTERNAL_URL"/);
  assert.match(mcpWorkflow, /"BACKEND_API_BASE_URL"/);
  assert.match(mcpWorkflow, /"BACKEND_API_TOKEN"/);
  assert.match(mcpWorkflow, /mcp_backend_token_production_binding_missing_or_ambiguous/);
  assert.doesNotMatch(mcpWorkflow, /HEROKU_API_KEY|api\.heroku\.com|hung-phat-mcp|hung-phat\.herokuapp\.com/i);
  assert.doesNotMatch(mcpWorkflow, /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|postgres(?:ql)?:\/\//i);
});

test("MCP deploy changes routing bindings but never reads or overwrites the backend token value", () => {
  assert.match(mcpWorkflow, /key === "BACKEND_API_TOKEN"/);
  assert.match(mcpWorkflow, /type === "plain"/);
  assert.match(mcpWorkflow, /type:"sensitive"/);
  assert.match(mcpWorkflow, /target:\["production"\]/);
  const upsertBody = mcpWorkflow.slice(mcpWorkflow.indexOf("body=\"$(jq -nc"), mcpWorkflow.indexOf("Pull MCP production project configuration"));
  assert.match(upsertBody, /CORE_API_INTERNAL_URL/);
  assert.match(upsertBody, /BACKEND_API_BASE_URL/);
  assert.doesNotMatch(upsertBody, /key:\"BACKEND_API_TOKEN\"/);
});

test("MCP deploy uses a remote production build so Vercel injects server-only sensitive env", () => {
  assert.match(mcpWorkflow, /vercel@58\.0\.0 pull --yes --environment=production/);
  assert.match(mcpWorkflow, /vercel@58\.0\.0 deploy --prod --yes/);
  assert.doesNotMatch(mcpWorkflow, /--prebuilt/);
  assert.doesNotMatch(mcpWorkflow, /vercel@latest/);
});

test("MCP deploy proves both VPS health boundaries and workforce auth connectivity", () => {
  assert.match(mcpWorkflow, /company_url\/health\/live|\$company_url\/health\/live/);
  assert.match(mcpWorkflow, /mcp_url\/health\/live|\$mcp_url\/health\/live/);
  assert.match(mcpWorkflow, /api\/internal-auth\/me/);
  assert.match(mcpWorkflow, /auth_status.*401/s);
  assert.match(mcpWorkflow, /Smoke MCP production domain/);
  assert.match(mcpWorkflow, /error=invalid_credentials/);
  assert.match(mcpWorkflow, /auth_unavailable/);
  assert.match(mcpWorkflow, /\/api\/backend\/routes 401/);
});

test("targeted MCP auth repair mutates only CORE_API_INTERNAL_URL and redeploys current production source", () => {
  assert.match(repairWorkflow, /github\.event\.issue\.number == 5/);
  assert.match(repairWorkflow, /'\/repair-mcp-auth-wiring-production'/);
  assert.match(repairWorkflow, /VPS_COMPANY_HOST: \$\{\{ vars\.VPS_COMPANY_HOST \}\}/);
  assert.match(repairWorkflow, /VPS_MCP_HOST: \$\{\{ vars\.VPS_MCP_HOST \}\}/);
  assert.match(repairWorkflow, /key:\"CORE_API_INTERNAL_URL\"/);
  assert.match(repairWorkflow, /v6\/deployments\?projectId=\$VERCEL_PROJECT_ID&target=production&state=READY&limit=1/);
  assert.match(repairWorkflow, /vercel@58\.0\.0 redeploy "\$CURRENT_DEPLOYMENT" --target=production/);
  assert.match(repairWorkflow, /error=invalid_credentials/);
  assert.match(repairWorkflow, /auth_unavailable/);
  const repairStep = repairWorkflow.slice(repairWorkflow.indexOf("Repair only MCP Công Ty auth binding"), repairWorkflow.indexOf("Redeploy current MCP production source only"));
  assert.doesNotMatch(repairStep, /key:\"BACKEND_API_BASE_URL\"|key:\"BACKEND_API_TOKEN\"/);
  assert.doesNotMatch(repairWorkflow, /systemctl|ssh |DATABASE_URL|psql|3128|3427|ipv4-proxy|ipv6-proxy/);
});

test("MCP build and runtime validation cannot pass without the Công Ty auth URL", () => {
  assert.match(nextConfig, /requiredHttpBuildEnv\("CORE_API_INTERNAL_URL"\)/);
  assert.match(nextConfig, /requiredHttpBuildEnv\("BACKEND_API_BASE_URL"\)/);
  assert.match(runtimeValidator, /httpUrl\("CORE_API_INTERNAL_URL", \{ httpsInProduction: true \}\)/);
  assert.match(runtimeValidator, /httpUrl\("BACKEND_API_BASE_URL", \{ httpsInProduction: true \}\)/);
  assert.match(envExample, /^CORE_API_INTERNAL_URL=/m);
  assert.match(envExample, /^BACKEND_API_BASE_URL=/m);
});

test("MCP login uses office-language Công Ty wording", () => {
  assert.match(loginPage, /Dùng tài khoản nhân sự Công Ty/);
  assert.match(loginPage, /được Công Ty xác minh lại/);
  assert.match(loginPage, /Công Ty tạm thời chưa sẵn sàng/);
  assert.doesNotMatch(loginPage, /NPP Core/);
  assert.match(internalAuthClient, /Kết nối Công Ty chưa được cấu hình/);
  assert.match(internalAuthClient, /Công Ty tạm thời chưa sẵn sàng/);
  assert.doesNotMatch(internalAuthClient, /message: "[^"]*NPP Core/);
});

test("Foundation CI continues to run the MCP Vercel deployment contract", () => {
  assert.match(foundationWorkflow, /Verify workflow workspace path delta/);
  assert.match(foundationWorkflow, /npm run test:vercel-deployment-control/);
});
