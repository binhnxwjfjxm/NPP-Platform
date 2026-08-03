import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_GROUPS = 7;
const EXPECTED_ITEMS = 52;
const endpoint = "/api/mcp-report-settings?groupType=market_report&includeInactive=1";
const deployments = [
  "https://mcp-field-4m339eob5-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-2iusuwl4k-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-4ovon9igh-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-95m6so4mf-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-bhdi5l7vy-binhnxwjfjxms-projects.vercel.app"
];

function text(value) {
  return String(value ?? "").trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function validateSnapshot(payload) {
  const sourceGroups = payload?.data?.groups;
  if (!Array.isArray(sourceGroups) || sourceGroups.length !== EXPECTED_GROUPS) return null;

  const groups = [];
  const items = [];
  const groupIds = new Set();
  const groupKeys = new Set();
  const itemIds = new Set();
  const itemKeys = new Set();

  for (const sourceGroup of sourceGroups) {
    const groupId = text(sourceGroup?.id);
    const groupKey = text(sourceGroup?.key ?? sourceGroup?.groupKey ?? sourceGroup?.group_key);
    const title = text(sourceGroup?.title);
    const status = text(sourceGroup?.status).toLowerCase();
    const groupItems = sourceGroup?.items;

    if (!groupId || !groupKey || !title || status !== "active" || !Array.isArray(groupItems)) return null;
    if (groupIds.has(groupId) || groupKeys.has(groupKey)) return null;
    groupIds.add(groupId);
    groupKeys.add(groupKey);

    const { items: _nestedItems, ...group } = sourceGroup;
    groups.push(group);

    for (const sourceItem of groupItems) {
      const itemId = text(sourceItem?.id);
      const itemKey = text(sourceItem?.key ?? sourceItem?.itemKey ?? sourceItem?.item_key);
      const label = text(sourceItem?.label);
      const itemStatus = text(sourceItem?.status).toLowerCase();
      const identity = `${groupId}:${itemKey}`;

      if (!itemId || !itemKey || !label || itemStatus !== "active") return null;
      if (itemIds.has(itemId) || itemKeys.has(identity)) return null;
      itemIds.add(itemId);
      itemKeys.add(identity);
      items.push({ ...sourceItem, groupId });
    }
  }

  if (items.length !== EXPECTED_ITEMS) return null;
  return { groups, items };
}

function requestDeployment(deployment, index, token, exportDir) {
  const candidateFile = join(exportDir, `candidate-${index}.json`);
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "vercel@latest",
      "curl",
      endpoint,
      "--deployment",
      deployment,
      "--token",
      token,
      "--no-color",
      "--silent",
      "--show-error",
      "--output",
      candidateFile,
      "--write-out",
      "%{http_code}"
    ],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  const statusMatch = text(result.stdout).match(/(\d{3})$/);
  return {
    candidateFile,
    status: statusMatch?.[1] || "000",
    commandOk: result.status === 0
  };
}

async function main() {
  const token = text(process.env.VERCEL_TOKEN);
  const exportFile = text(process.env.EXPORT_FILE);
  const exportShaFile = text(process.env.EXPORT_SHA_FILE);
  const outputFile = text(process.env.GITHUB_OUTPUT);

  if (!token) throw new Error("vercel_token_missing");
  if (!exportFile || !exportShaFile || !outputFile) throw new Error("legacy_export_path_missing");

  const exportDir = dirname(exportFile);
  await mkdir(exportDir, { recursive: true });

  for (const [index, deployment] of deployments.entries()) {
    const request = requestDeployment(deployment, index, token, exportDir);
    try {
      if (!request.commandOk || request.status !== "200") continue;
      const payload = JSON.parse(await readFile(request.candidateFile, "utf8"));
      const data = validateSnapshot(payload);
      if (!data) continue;

      const canonicalData = canonical(data);
      const encodedData = `${JSON.stringify(canonicalData, null, 2)}\n`;
      const sha256 = createHash("sha256").update(encodedData).digest("hex");
      const artifact = {
        source: {
          provider: "vercel-historical-deployment",
          deployment,
          capturedAt: new Date().toISOString(),
          sourceSha: text(process.env.GITHUB_SHA)
        },
        counts: { groups: data.groups.length, items: data.items.length },
        sha256,
        data: canonicalData
      };

      await writeFile(exportFile, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
      await writeFile(exportShaFile, `${sha256}  ${exportFile}\n`, { mode: 0o600 });
      await writeFile(
        outputFile,
        `groups=${data.groups.length}\nitems=${data.items.length}\nsha256=${sha256}\nsource_deployment=${deployment}\n`,
        { flag: "a" }
      );
      process.stdout.write(`legacy_snapshot_match:${index}\n`);
      return;
    } catch {
      // A historical deployment is accepted only when its response is valid JSON
      // and matches the exact 7-group/52-item contract. Continue otherwise.
    } finally {
      await rm(request.candidateFile, { force: true });
    }
  }

  throw new Error("legacy_report_settings_snapshot_not_found");
}

await main();
