import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const dock = await readFile("src/ui/shell/MobileDock.tsx", "utf8");

test("bottom dock remains a document-level escape from pending app-router transitions", () => {
  assert.doesNotMatch(dock, /from "next\/link"/);
  assert.match(dock, /<a[\s\S]*?data-document-navigation="true"[\s\S]*?href=\{item\.href\}/);
  assert.doesNotMatch(dock, /prefetch/);
});

test("visits entry resolves redirects before a route shell can stream", async () => {
  await assert.rejects(
    access("src/app/visits/loading.tsx"),
    (error) => error && error.code === "ENOENT"
  );
});
