import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const installerPath = fileURLToPath(new URL("../ops/install-outlet-media-cleanup-timer.sh", import.meta.url));
const serviceTemplate = await readFile(new URL("../ops/systemd/mcp-outlet-media-cleanup.service", import.meta.url), "utf8");
const timerTemplate = await readFile(new URL("../ops/systemd/mcp-outlet-media-cleanup.timer", import.meta.url), "utf8");

async function executable(file, content) {
  await writeFile(file, content, { mode: 0o755 });
}

async function runtimeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcp deploy runtime "));
  const runtime = path.join(root, "custom runtime");
  const fakeBin = path.join(root, "bin");
  const capture = path.join(root, "capture");
  await mkdir(path.join(runtime, "ops", "systemd"), { recursive: true });
  await mkdir(fakeBin);
  await mkdir(capture);
  await writeFile(path.join(runtime, ".env"), "BACKEND_API_TOKEN=test-token\n");
  await writeFile(path.join(runtime, "ops", "run-outlet-media-cleanup.sh"), "#!/usr/bin/env bash\n", { mode: 0o755 });
  await writeFile(path.join(runtime, "ops", "systemd", "mcp-outlet-media-cleanup.service"), serviceTemplate);
  await writeFile(path.join(runtime, "ops", "systemd", "mcp-outlet-media-cleanup.timer"), timerTemplate);

  for (const command of ["chown", "chmod", "systemctl"]) {
    await executable(path.join(fakeBin, command), "#!/usr/bin/env bash\nexit 0\n");
  }
  await executable(path.join(fakeBin, "install"), `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
source_index=$((${#args[@]} - 2))
dest_index=$((${#args[@]} - 1))
source_path="${args[$source_index]}"
dest_path="${args[$dest_index]}"
cp "$source_path" "$CAPTURE_DIR/$(basename "$dest_path")"
`);

  return { root, runtime, fakeBin, capture };
}

test("cleanup service template has no fixed VPS runtime path", () => {
  assert.match(serviceTemplate, /@MCP_RUNTIME_DIR@/);
  assert.doesNotMatch(serviceTemplate, /\/var\/www\/mcp-plan-backend/);
});

test("installer renders every service path from MCP_RUNTIME_DIR", async () => {
  const fixture = await runtimeFixture();
  const result = spawnSync("bash", [installerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:/usr/bin:/bin`,
      MCP_RUNTIME_DIR: fixture.runtime,
      CAPTURE_DIR: fixture.capture
    }
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const rendered = await readFile(path.join(fixture.capture, "mcp-outlet-media-cleanup.service"), "utf8");
  assert.doesNotMatch(rendered, /@MCP_RUNTIME_DIR@/);
  assert.doesNotMatch(rendered, /\/var\/www\/mcp-plan-backend/);
  assert.match(rendered, new RegExp(fixture.runtime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered, new RegExp(`${fixture.runtime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.env`));
  assert.match(rendered, new RegExp(`${fixture.runtime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/ops/run-outlet-media-cleanup\\.sh`));
});

test("installer rejects a relative runtime directory", () => {
  const result = spawnSync("bash", [installerPath], {
    encoding: "utf8",
    env: { ...process.env, MCP_RUNTIME_DIR: "relative/runtime" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime_dir_must_be_absolute/);
});
