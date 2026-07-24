import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isMainModule } from "../scripts/esm-entrypoint.mjs";

test("matches an absolute entrypoint path containing spaces", () => {
  const modulePath = path.join(process.cwd(), "workspace with spaces", "runner.mjs");

  assert.equal(isMainModule(pathToFileURL(modulePath).href, modulePath), true);
});

test("resolves a relative argv path from the supplied working directory", () => {
  const cwd = path.join(process.cwd(), "repository root");
  const modulePath = path.join(cwd, "scripts", "runner.mjs");

  assert.equal(
    isMainModule(pathToFileURL(modulePath).href, path.join("scripts", "runner.mjs"), { cwd }),
    true
  );
});

test("returns false when argv path is missing or the URL is invalid", () => {
  assert.equal(isMainModule(import.meta.url, undefined), false);
  assert.equal(isMainModule("not-a-file-url", "runner.mjs"), false);
});

test("normalizes Windows drive letters, separators and spaces", () => {
  const convertedModulePath = "C:\\Work Space\\scripts\\runner.mjs";
  const argvPath = "c:/Work Space/scripts/runner.mjs";

  assert.equal(
    isMainModule("file:///C:/Work%20Space/scripts/runner.mjs", argvPath, {
      pathApi: path.win32,
      cwd: "C:\\Work Space",
      fileURLToPathImpl: () => convertedModulePath,
      caseInsensitive: true
    }),
    true
  );
  assert.equal(convertedModulePath.startsWith("/C:/"), false);
});
