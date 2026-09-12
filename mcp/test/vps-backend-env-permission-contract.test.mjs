import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

for (const [label, relativePath] of [
  ["Công Ty", ".github/workflows/vps-company-backend-manual.yml"],
  ["MCP", ".github/workflows/vps-mcp-backend-manual.yml"],
]) {
  test(`${label} VPS deploy reads protected runtime env with sudo`, async () => {
    const workflow = await readFile(new URL(relativePath, root), "utf8");
    assert.match(workflow, /sudo -n chmod 640 "\$env_file"/);
    assert.match(workflow, /sudo -n grep -q '\^PORT=' "\$env_file"/);
    assert.doesNotMatch(workflow, /^\s*grep -q '\^PORT=' "\$env_file"/m);
    assert.match(workflow, /port="\$\(sudo -n awk/);
  });
}
