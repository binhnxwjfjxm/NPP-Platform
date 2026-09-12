import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("VPS DB network audit is read-only and diagnoses packet reachability", async () => {
  const workflow = await readFile(new URL(".github/workflows/vps-db-network-audit-manual.yml", root), "utf8");

  assert.match(workflow, /\/audit-vps-db-network-958/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /tcp dst port 5432/);
  assert.match(workflow, /ip -4 route get/);
  assert.match(workflow, /ufw status numbered/);
  assert.match(workflow, /iptables -S INPUT/);
  assert.match(workflow, /production_traffic=not_enabled/);
  assert.match(workflow, /cutover=not_performed/);
  assert.doesNotMatch(workflow, /ufw allow|ALTER SYSTEM|systemctl restart|apt-get|apt install|pg_hba\.conf.*install/);
});
