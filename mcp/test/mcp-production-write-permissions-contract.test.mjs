import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const backendRoot = new URL("apps/backend/foundation/", new URL("../", import.meta.url));
const manifestPath = new URL("apps/backend/config/mcp-service-permissions.json", new URL("../", import.meta.url));
const scriptPath = new URL("apps/backend/scripts/repair-mcp-production-write-permissions.sh", new URL("../", import.meta.url));
const workflowPath = new URL(".github/workflows/mcp-production-write-permissions.yml", root);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const script = (await readFile(scriptPath, "utf8")).replace(/\r\n/g, "\n");
const workflow = (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");
const configuredPermissions = new Set([
  ...manifest.userFacingWritePermissions,
  ...manifest.integrationPermissions
]);

async function productionFoundationFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directoryUrl);
    if (entry.isDirectory()) {
      files.push(...await productionFoundationFiles(entryUrl));
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      files.push(entryUrl);
    }
  }
  return files;
}

async function sourcePermissions() {
  const permissions = new Set();
  for (const file of await productionFoundationFiles(backendRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/permission\s*:\s*["'](mcp\.[a-z0-9._:-]+)["']/g)) {
      permissions.add(match[1]);
    }
    for (const match of source.matchAll(/\[\s*["']mcp\.[a-z0-9._:-]+["']\s*,\s*["'](mcp\.[a-z0-9._:-]+)["']/g)) {
      permissions.add(match[1]);
    }
  }
  return permissions;
}

test("permission repair script is valid shell", () => {
  execFileSync("bash", ["-n", fileURLToPath(scriptPath)]);
});

test("manifest grants every current user-facing MCP write contract without wildcard access", async () => {
  assert.equal(manifest.version, 1);
  assert.ok(manifest.userFacingWritePermissions.length > 0);
  assert.ok(manifest.integrationPermissions.length > 0);
  assert.equal(configuredPermissions.size, manifest.userFacingWritePermissions.length + manifest.integrationPermissions.length);

  for (const permission of configuredPermissions) {
    assert.match(permission, /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/);
    assert.doesNotMatch(permission, /\*/);
  }

  const requiredBySource = await sourcePermissions();
  assert.ok(requiredBySource.size > 0);
  for (const permission of requiredBySource) {
    assert.ok(configuredPermissions.has(permission), `manifest is missing ${permission}`);
  }

  for (const expected of [
    "mcp.route.write",
    "mcp.route-customer.write",
    "mcp.session.write",
    "mcp.session-customer.write",
    "mcp.order.write",
    "mcp.test.write",
    "mcp.report.write",
    "mcp.followup.write",
    "mcp.report-setting.write",
    "mcp.sales-order.read",
    "mcp.sales-order.create"
  ]) {
    assert.ok(configuredPermissions.has(expected), `required production permission is missing: ${expected}`);
  }
});

test("repair is additive, reversible, health-gated and does not deploy or touch data", () => {
  assert.match(script, /csv_union "\$original_permissions" "\$required_csv"/);
  assert.match(script, /MCP_SERVICE_PERMISSIONS/);
  assert.match(script, /restore_original_config/);
  assert.match(script, /rollback_attempted="true"/);
  assert.match(script, /smoke_health "\$mcp_url" \/health\/live/);
  assert.match(script, /smoke_health "\$mcp_url" \/health\/ready/);
  assert.match(script, /safe_negative_post \/api\/routes/);
  assert.match(script, /safe_negative_post \/api\/mcp-report-settings/);
  assert.match(script, /\[ "\$status" != "400" \]/);
  assert.doesNotMatch(script, /container:(?:push|release)/);
  assert.doesNotMatch(script, /git push/);
  assert.doesNotMatch(script, /migration:(?:migrate|verify|status)/);
  assert.doesNotMatch(script, /pg_dump|pg_restore|psql|DATABASE_URL/);
});

test("production repair is exact-command, exact-main and never automatic", () => {
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/repair-mcp-production-write-permissions'/);
  assert.match(workflow, /github\.actor == 'binhnxwjfjxm'/);
  assert.match(workflow, /github\.actor == 'khuongbinhinfo-a11y'/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /secrets\.HEROKU_API_KEY/);
  assert.match(workflow, /issues\/211\/comments/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|schedule):\s*$/m);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
});
