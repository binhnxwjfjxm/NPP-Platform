import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizeComparablePath(value, {
  pathApi,
  cwd,
  caseInsensitive
}) {
  const normalized = pathApi.normalize(pathApi.resolve(cwd, value));
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function isMainModule(importMetaUrl, argvPath, {
  pathApi = path,
  cwd = process.cwd(),
  fileURLToPathImpl = fileURLToPath,
  caseInsensitive = process.platform === "win32"
} = {}) {
  if (!argvPath) return false;

  let modulePath;
  try {
    modulePath = fileURLToPathImpl(importMetaUrl);
  } catch {
    return false;
  }

  return normalizeComparablePath(modulePath, { pathApi, cwd, caseInsensitive })
    === normalizeComparablePath(argvPath, { pathApi, cwd, caseInsensitive });
}
