import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./esm-entrypoint.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const WORKSPACE_ROOTS = ["mcp/", "npp-core/", "admin/", "delivery/", "retail/", "packages/", "database/"];
const LEGACY_FILTER_ROOTS = ["src/", "test/", "apps/", "supabase/", "scripts/", "ops/", "agent-backend/"];
const LEGACY_ROOT_FILES = new Set([
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "tsconfig.json"
]);

function indentOf(line) {
  return line.match(/^\s*/)?.[0].length || 0;
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function workflowJobBlocks(text) {
  const lines = text.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex < 0) return [];

  const starts = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) starts.push({ index, name: match[1] });
  }

  return starts.map((start, position) => ({
    name: start.name,
    lines: lines.slice(start.index, starts[position + 1]?.index ?? lines.length)
  }));
}

function runCommands(lines) {
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!match) continue;
    const baseIndent = match[1].length;
    const inline = match[2].trim();
    if (inline && inline !== "|" && inline !== ">") {
      commands.push(inline);
      continue;
    }

    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && indentOf(line) <= baseIndent) {
        index -= 1;
        break;
      }
      block.push(line.trim());
    }
    commands.push(block.join("\n"));
  }
  return commands;
}

function pathFilterValues(text) {
  const lines = text.split(/\r?\n/);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)paths:\s*$/);
    if (!match) continue;
    const baseIndent = match[1].length;
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && indentOf(line) <= baseIndent) {
        index -= 1;
        break;
      }
      const item = line.match(/^\s*-\s+(.+?)\s*$/);
      if (item) values.push(unquote(item[1]));
    }
  }
  return values;
}

function artifactPaths(text) {
  const lines = text.split(/\r?\n/);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)path:\s*(.*)$/);
    if (!match) continue;
    const baseIndent = match[1].length;
    const inline = unquote(match[2]);
    if (inline && inline !== "|" && inline !== ">") {
      values.push(inline);
      continue;
    }

    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && indentOf(line) <= baseIndent) {
        index -= 1;
        break;
      }
      if (line.trim()) values.push(unquote(line));
    }
  }
  return values;
}

function hasWorkspacePrefix(value) {
  return WORKSPACE_ROOTS.some((root) => value.startsWith(root));
}

export function auditWorkflowText(filename, text) {
  const errors = [];

  for (const value of pathFilterValues(text)) {
    if (LEGACY_FILTER_ROOTS.some((root) => value.startsWith(root)) || LEGACY_ROOT_FILES.has(value)) {
      errors.push(`${filename}:legacy_root_path_filter:${value}`);
    }
  }

  for (const value of artifactPaths(text)) {
    if (!hasWorkspacePrefix(value)) errors.push(`${filename}:artifact_path_missing_workspace:${value}`);
  }

  for (const job of workflowJobBlocks(text)) {
    const block = job.lines.join("\n");
    const commands = runCommands(job.lines);
    const runsNpm = commands.some((command) => /(^|\s)npm(?:\s|$)/.test(command));
    if (runsNpm && !/working-directory:\s*(?:mcp|npp-core|admin|delivery|retail)(?:\/[^\s]+)?\s*$/m.test(block)) {
      errors.push(`${filename}:${job.name}:npm_without_workspace_working_directory`);
    }

    if (/cache:\s*npm\s*$/m.test(block)) {
      const cachePath = block.match(/cache-dependency-path:\s*([^\s]+)\s*$/m)?.[1];
      if (!cachePath || !hasWorkspacePrefix(unquote(cachePath))) {
        errors.push(`${filename}:${job.name}:npm_cache_missing_workspace_lockfile`);
      }
    }
  }

  return errors;
}

export async function auditWorkflowPaths({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  const filenames = (await readdir(workflowsDir))
    .filter((filename) => /\.ya?ml$/i.test(filename))
    .sort();
  const errors = [];
  for (const filename of filenames) {
    const text = await readFile(path.join(workflowsDir, filename), "utf8");
    errors.push(...auditWorkflowText(filename, text));
  }
  return { filenames, errors };
}

async function main() {
  const result = await auditWorkflowPaths();
  if (result.errors.length) {
    console.error("workflow_path_audit_failed");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`workflow_path_audit_passed workflows=${result.filenames.length}`);
}

if (isMainModule(import.meta.url, process.argv[1])) await main();
