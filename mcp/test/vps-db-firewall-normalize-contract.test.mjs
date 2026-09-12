import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("DB firewall normalization removes only the conflicting legacy REJECT and preserves strict UFW allowlisting", async () => {
  const workflow = await readFile(new URL(".github/workflows/vps-db-firewall-normalize-manual.yml", root), "utf8");

  assert.match(workflow, /\/normalize-vps-db-firewall-958/);
  assert.match(workflow, /legacy_rule='-A INPUT -j REJECT --reject-with icmp-host-prohibited'/);
  assert.match(workflow, /iptables -D INPUT -j REJECT --reject-with icmp-host-prohibited/);
  assert.match(workflow, /host_firewall_authority=ufw/);
  assert.match(workflow, /ufw_default_incoming=deny/);
  assert.match(workflow, /normalization_service=active_enabled/);
  assert.match(workflow, /company_to_db_private_5432=PASS/);
  assert.match(workflow, /mcp_to_db_public_5432=PASS/);
  assert.match(workflow, /unrelated_public_5432=blocked/);
  assert.match(workflow, /proxy_services=active_enabled_untouched/);
  assert.match(workflow, /proxy_listener_count=300/);
  assert.match(workflow, /tcp_3000_listener=preserved/);
  assert.match(workflow, /production_traffic=not_enabled/);
  assert.match(workflow, /cutover=not_performed/);
  assert.doesNotMatch(workflow, /ufw allow from any to any port 5432|ufw allow 5432|0\.0\.0\.0\/0.*5432|maintenance:on|maintenance:off|pg:promote/);
});
