import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("VPS DB network audit is read-only and diagnoses provider plus private/public paths", async () => {
  const workflow = await readFile(new URL(".github/workflows/vps-db-network-audit-manual.yml", root), "utf8");

  assert.match(workflow, /\/audit-vps-db-network-958/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /opc\/v2\/instance/);
  assert.match(workflow, /opc\/v2\/vnics/);
  assert.match(workflow, /provider=oracle_oci/);
  assert.match(workflow, /company_to_db_private_22/);
  assert.match(workflow, /company_to_db_private_5432/);
  assert.match(workflow, /mcp_to_db_private_22/);
  assert.match(workflow, /mcp_to_db_private_5432/);
  assert.match(workflow, /company_to_db_public_22/);
  assert.match(workflow, /mcp_to_db_public_22/);
  assert.match(workflow, /db_to_company_private_22/);
  assert.match(workflow, /db_to_mcp_private_22/);
  assert.match(workflow, /ip -4 route get/);
  assert.match(workflow, /ufw status numbered/);
  assert.match(workflow, /iptables -S INPUT/);
  assert.match(workflow, /nft list ruleset/);
  assert.match(workflow, /production_traffic=not_enabled/);
  assert.match(workflow, /cutover=not_performed/);
  assert.doesNotMatch(workflow, /ufw allow|ALTER SYSTEM|systemctl restart|apt-get|apt install|pg_hba\.conf.*install/);
});
