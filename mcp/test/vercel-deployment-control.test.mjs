import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
const workflow = await readFile(
  new URL("../../.github/workflows/vercel-production-manual.yml", import.meta.url),
  "utf8"
);

test("Vercel builds the nested MCP Next.js package", () => {
  assert.deepEqual(config.builds, [
    {
      src: "mcp/package.json",
      use: "@vercel/next"
    }
  ]);
  assert.equal(config.framework, undefined);
  assert.equal(config.outputDirectory, undefined);
});

test("Git-triggered Vercel deployments stay disabled", () => {
  assert.equal(config.git?.deploymentEnabled, false);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /^\s{2}issue_comment:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
});

test("comment deployment requires the exact guarded command", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/deploy-vercel-production'/);
  assert.match(workflow, /\[\"binhnxwjfjxm\",\"khuongbinhinfo-a11y\"\]/);
  assert.match(workflow, /github\.actor/);
});

test("manual deploy targets the linked project without committing credentials", () => {
  assert.match(workflow, /VERCEL_ORG_ID: team_hBA8rX68UHC8ogvREkOyQlJ2/);
  assert.match(workflow, /VERCEL_PROJECT_ID: prj_vFEAzoxesLqNJIfD8uF4q1kytpvk/);
  assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /vcp_[A-Za-z0-9_-]+/);
  assert.match(workflow, /vercel@56\.5\.0 deploy --prebuilt --prod/);
});
