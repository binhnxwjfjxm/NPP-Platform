import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("VPS parallel backend setup uses the private VPS subnet for PostgreSQL", async () => {
  const workflow = await readFile(new URL(".github/workflows/vps-parallel-test-runtime-setup-manual.yml", root), "utf8");

  assert.match(workflow, /\/prepare-vps-parallel-test-958/);
  assert.match(workflow, /Resolve private VPS network addresses/);
  assert.match(workflow, /db_private_ip/);
  assert.match(workflow, /company_private_ip/);
  assert.match(workflow, /mcp_private_ip/);
  assert.match(workflow, /ip\.is_private/);
  assert.match(workflow, /hostssl npp_rehearsal_958 npp_company_test_runtime \$\{company_private_ip\}\/32/);
  assert.match(workflow, /hostssl npp_rehearsal_958 mcp_test_runtime \$\{mcp_private_ip\}\/32/);
  assert.match(workflow, /listen_addresses = %L/);
  assert.match(workflow, /127\.0\.0\.1,::1,/);
  assert.match(workflow, /ufw allow from "\$company_private_ip" to any port 5432/);
  assert.match(workflow, /ufw allow from "\$mcp_private_ip" to any port 5432/);
  assert.match(workflow, /delete allow from "\$company_public_ip" to any port 5432/);
  assert.match(workflow, /delete allow from "\$mcp_public_ip" to any port 5432/);
  assert.match(workflow, /DB_PRIVATE_IP: \$\{\{ steps\.network\.outputs\.db_private_ip \}\}/);
  assert.match(workflow, /company_to_db_private_tcp=PASS/);
  assert.match(workflow, /mcp_to_db_private_tcp=PASS/);
  assert.match(workflow, /DB TCP 5432 became reachable from the public runner/);
  assert.match(workflow, /proxy_services=active_enabled_untouched/);
  assert.match(workflow, /production_traffic=not_enabled/);
  assert.match(workflow, /cutover=not_performed/);
  assert.doesNotMatch(workflow, /maintenance:on|maintenance:off|pg:promote/);
});
