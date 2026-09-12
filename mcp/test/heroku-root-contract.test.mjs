import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("Heroku runs the Core API from the repository root", async () => {
  assert.equal((await read("Procfile")).trim(), "web: npm run start:core-api");
  const pkg = JSON.parse(await read("package.json"));
  assert.deepEqual(pkg.workspaces, ["mcp", "mcp/apps/backend", "npp-core/api", "npp-core/web", "packages/*"]);
  assert.equal(pkg.scripts.start, "npm run start:core-api");
  assert.equal(pkg.scripts["heroku-postbuild"], "npm run build:core-api");
});

test("VPS DB bootstrap is manual, exact-main and never exposes PostgreSQL publicly", async () => {
  const workflow = await read(".github/workflows/vps-db-postgresql17-bootstrap-manual.yml");

  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /\/bootstrap-vps-db-postgresql17/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /postgresql-17 postgresql-client-17/);
  assert.match(workflow, /listen_addresses = '127\.0\.0\.1,::1'/);
  assert.match(workflow, /TCP 5432 became public after bootstrap/);
  assert.match(workflow, /production_traffic=not_enabled/);
  assert.doesNotMatch(workflow, /migration:migrate|pg_restore|DATABASE_URL/);
});

test("Heroku to VPS DB rehearsal locks migration heads and cannot cut over production", async () => {
  const workflow = await read(".github/workflows/vps-db-heroku-rehearsal-manual.yml");
  const script = await read("npp-core/api/scripts/vps-db-heroku-rehearsal-958.sh");

  assert.match(workflow, /\/audit-heroku-migration-head-958/);
  assert.match(workflow, /\/rehearse-heroku-to-vps-db-958/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(script, /shared\.schema_migrations/);
  assert.match(script, /heroku pg:backups:capture/);
  assert.match(script, /pg_restore --exit-on-error --no-owner --no-acl/);
  assert.match(script, /restore_db="npp_rehearsal_958"/);
  assert.match(script, /MIGRATION_RERUN_NOOP=PASS/);
  assert.match(script, /PRE_MIGRATION_RECONCILIATION=/);
  assert.match(script, /PUBLIC_TCP_5432=closed/);
  assert.match(script, /PRODUCTION_TRAFFIC=not_enabled/);
  assert.match(script, /CUTOVER=not_performed/);
  assert.doesNotMatch(script, /maintenance:on|maintenance:off/);
  assert.doesNotMatch(workflow, /VPS_COMPANY_SSH_KEY|VPS_MCP_SSH_KEY/);
});

test("Công Ty VPS deploy has isolated release, health and rollback boundaries", async () => {
  const workflow = await read(".github/workflows/vps-company-backend-manual.yml");

  assert.match(workflow, /\/deploy-vps-company-production/);
  assert.match(workflow, /VPS_COMPANY_SSH_KEY/);
  assert.doesNotMatch(workflow, /VPS_MCP_SSH_KEY|ipv4-proxy|ipv6-proxy|oci-ipv6-pool/);
  assert.match(workflow, /root=\/srv\/npp\/company/);
  assert.match(workflow, /releases="\$root\/releases"/);
  assert.match(workflow, /\/health\/live/);
  assert.match(workflow, /\/health\/ready/);
  assert.match(workflow, /ln -sfn "\$previous" "\$current"/);
  assert.doesNotMatch(workflow, /migration:migrate|psql .*migrate/);
});

test("MCP VPS deploy preserves all existing proxy services and listeners", async () => {
  const workflow = await read(".github/workflows/vps-mcp-backend-manual.yml");

  assert.match(workflow, /\/deploy-vps-mcp-production/);
  assert.match(workflow, /VPS_MCP_SSH_KEY/);
  assert.doesNotMatch(workflow, /VPS_COMPANY_SSH_KEY/);
  assert.match(workflow, /ipv4-proxy ipv6-proxy oci-ipv6-pool/);
  assert.match(workflow, /proxy_listener_count=300/);
  assert.match(workflow, /tcp_3000_listener=preserved/);
  assert.match(workflow, /mcp_port_conflicts_with_proxy_range/);
  assert.doesNotMatch(workflow, /systemctl (?:stop|restart) (?:ipv4-proxy|ipv6-proxy|oci-ipv6-pool)/);
  assert.match(workflow, /\/health\/live/);
  assert.match(workflow, /\/health\/ready/);
  assert.doesNotMatch(workflow, /migration:migrate|pg_restore/);
});
