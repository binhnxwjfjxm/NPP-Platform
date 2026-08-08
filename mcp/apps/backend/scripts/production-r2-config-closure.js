import { createDecipheriv, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  presignR2Get,
  presignR2Put,
  signedR2DeleteRequest,
  signedR2HeadRequest
} from "../foundation/r2-storage.js";

const HEROKU_ACCEPT = "application/vnd.heroku+json; version=3";
const EXPECTED_APP = "hung-phat-mcp";
const SOURCE_APP = "hung-phat";
const EXPECTED_BUCKET = "hung-phat";
const EXPECTED_PUBLIC_URL = "https://pub-7d2987fab97d4e3ebb2021a823973862.r2.dev";
const REQUIRED_SECRET_CONFIG = Object.freeze([
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY"
]);

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function herokuRequest(appName, apiKey, { method = "GET", body = null } = {}) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/config-vars`, {
    method,
    headers: {
      Accept: HEROKU_ACCEPT,
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) fail(method === "GET" ? "heroku_config_read_failed" : "heroku_config_patch_failed");
  return response.json();
}

function missingSecretConfig(config) {
  return REQUIRED_SECRET_CONFIG.filter((name) => !text(config?.[name]));
}

function assertSecretConfig(config, label = "runtime") {
  const missing = missingSecretConfig(config);
  if (missing.length > 0) {
    fail(`${label}_missing_${missing.map((name) => name.toLowerCase()).join("__")}`);
  }
}

function assertCloudflareR2Endpoint(value) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    fail("r2_endpoint_invalid");
  }
  if (!hostname.endsWith(".r2.cloudflarestorage.com")) fail("r2_endpoint_not_cloudflare");
}

function decryptBootstrap(payload, apiKey) {
  let packed;
  try {
    packed = Buffer.from(payload, "base64url");
  } catch {
    fail("r2_bootstrap_payload_invalid");
  }
  if (packed.length < 29) fail("r2_bootstrap_payload_invalid");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const key = createHash("sha256").update(apiKey).digest();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain);
    assertSecretConfig(parsed, "bootstrap");
    assertCloudflareR2Endpoint(parsed.R2_ENDPOINT);
    return parsed;
  } catch (error) {
    if (error?.code && String(error.code).startsWith("bootstrap_")) throw error;
    fail("r2_bootstrap_decrypt_failed");
  }
}

function r2Config(config) {
  return Object.freeze({
    bucket: config.R2_BUCKET_NAME,
    endpoint: config.R2_ENDPOINT,
    region: text(config.R2_REGION) || "auto",
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY
  });
}

async function smokeR2(config, runId) {
  const payload = `phase-9-4-r2-smoke:${runId}:${Date.now()}`;
  const key = `mcp-plan/_phase-9-4-smoke/${runId}-${sha256(payload).slice(0, 16)}.txt`;
  const put = presignR2Put(config, key, "text/plain", { expiresSeconds: 120 });
  let uploaded = false;
  try {
    const putResponse = await fetch(put.putUrl, {
      method: "PUT",
      headers: put.requiredHeaders,
      body: payload
    });
    if (!putResponse.ok) fail("r2_smoke_put_failed");
    uploaded = true;

    const get = presignR2Get(config, key, { expiresSeconds: 120 });
    const getResponse = await fetch(get.getUrl);
    if (!getResponse.ok) fail("r2_smoke_get_failed");
    if (await getResponse.text() !== payload) fail("r2_smoke_content_mismatch");
  } finally {
    if (uploaded) {
      const deletion = signedR2DeleteRequest(config, key);
      const deleteResponse = await fetch(deletion.url, deletion.init);
      if (!deleteResponse.ok && deleteResponse.status !== 404) fail("r2_smoke_delete_failed");
      const head = signedR2HeadRequest(config, key);
      const headResponse = await fetch(head.url, head.init);
      if (headResponse.status !== 404) fail("r2_smoke_delete_verification_failed");
    }
  }
  return true;
}

async function readApp(appName, apiKey) {
  const response = await fetch(`htttps://api.heroku.com/apps/${encodeURIComponent(appName)}`, {
    headers: { Accept: HEROKU_ACCEPT, Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) fail("heroku_app_read_failed");
  return response.json();
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 90000;
  let lastLive = 0;
  let lastReady = 0;
  while (Date.now() < deadline) {
    try {
      const [live, ready] = await Promise.all([
        fetch(`${baseUrl.replace(/\/$/, "")}/health/live`, { redirect: "manual" }),
        fetch(`${baseUrl.replace(/\/$/, "")}/health/ready`, { redirect: "manual" })
      ]);
      lastLive = live.status;
      lastReady = ready.status;
      if (lastLive === 200 && lastReady === 200) return { live: lastLive, ready: lastReady };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const error = new Error(`mcp_health_failed_${lastLive}_${lastReady}`);
  error.code = "mcp_health_failed";
  throw error;
}

async function main() {
  const apiKey = text(process.env.HEROKU_API_KEY);
  const appName = text(process.env.HEROKU_APP_NAME);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const runId = text(process.env.GITHUB_RUN_ID)  || "manual";
  const evidenceFile = text(process.env.MCP_R2_CONFIG_CLOSURE_EVIDENCE_FILE);
  const bootstrapPayload = text(process.env.MCP_R2_BOOTSTRAP_B64);
  if (!apiKey || !appName || !auditedMainSha || !evidenceFile) fail("r2_config_closure_environment_incomplete");
  if (appName !== EXPECTED_APP) fail("unexpected_mcp_app");

  const before = await herokuRequest(appName, apiKey);
  const missingBefore = missingSecretConfig(before);
  const patch = {};
  let credentialSource = "existing_mcp";

  if (missingBefore.length > 0) {
    if (bootstrapPayload) {
      const bootstrap = decryptBootstrap(bootstrapPayload, apiKey);
      for (const name of missingBefore) patch[name] = bootstrap[name];
      if (!text(before.R2_REGION) && text(bootstrap.R2_REGION)) patch.R2_REGION = bootstrap.R2_REGION;
      credentialSource = "encrypted_bootstrap";
    } else {
      const source = await herokuRequest(SOURCE_APP, apiKey);
      assertSecretConfig(source, "core_runtime");
      assertCloudflareR2Endpoint(source.R2_ENDPOINT);
      if (text(source.R2_BUCKET_NAME) && text(source.R2_BUCKET_NAME) !== EXPECTED_BUCKET) {
        fail("core_r2_bucket_mismatch");
      }
      for (const name of missingBefore) patch[name] = source[name];
      if (!text(before.R2_REGION) && text(source.R2_REGION)) patch.R2_REGION = source.R2_REGION;
      credentialSource = "core_runtime";
    }
  }

  if (text(before.R2_BUCKET_NAME) !== EXPECTED_BUCKET) patch.R2_BUCKET_NAME = EXPECTED_BUCKET;
  if (text(before.CLOUDFLARE_R2_PUBLIC_URL) !== EXPECTED_PUBLIC_URL) {
    patch.CLOUDFLARE_R2_PUBLIC_URL = EXPECTED_PUBLIC_URL;
  }

  const changed = Object.keys(patch).length > 0;
  if (changed) await herokuRequest(appName, apiKey, { method: "PATCH", body: patch });

  const after = await herokuRequest(appName, apiKey);
  assertSecretConfig(after);
  assertCloudflareR2Endpoint(after.R2_ENDPOINT);
  if (text(after.R2_BUCKET_NAME) !== EXPECTED_BUCKET) fail("r2_bucket_patch_not_applied");
  if (text(after.CLOUDFLARE_R2_PUBLIC_URL) !== EXPECTED_PUBLIC_URL) fail("r2_public_url_patch_not_applied");

  const app = await readApp(appName, apiKey);
  const webUrl = text(app.web_url);
  if (!webUrl) fail("mcp_web_url_missing");

  const r2 = r2Config(after);
  await smokeR2(r2, runId);
  const health = await waitForHealth(webUrl);

  const targetFingerprint = sha256(`${new URL(r2.endpoint).hostname.toLowerCase()}\n${r2.bucket}`);
  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `HEROKU_APP_NAME=${appName}`,
    `MCP_R2_CONFIG_CHANGED=${changed}`,
    `MCP_R2_CREDENTIAL_SOURCE=${credentialSource}`,
    "MCP_R2_REQUIRED_SECRET_CONFIG_PRESENT=true",
    "MCP_R2_BUCKET_CONFIGURED=true",
    "MCP_R2_PUBLIC_URL_CONFIGURED=true",
    `R2_TARGET_FINGERPRINT_SHA256=${targetFingerprint}`,
    "MCP_R2_SMOKE_PUT=true",
    "MCP_R2_SMOKE_GET=true",
    "MCP_R2_SMOKE_DELETE=true",
    `MCP_HEALTH_LIVE=${health.live}`,
    `MCP_HEALTH_READY=${health.ready}`
  ].join("\n") + "\n";

  await writeFile(evidenceFile, evidence, { mode: 0o600 });
  process.stdout.write(evidence);
}

main().catch(async (error) => {
  const code = text(error?.code) || "r2_config_closure_failed";
  const evidenceFile = text(process.env.MCP_R2_CONFIG_CLOSURE_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || "unknown";
  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `PHASE_9_4_R2_CONFIG_CLOSURE_ERROR=${code}`,
    "MCP_R2_CONFIG_CLOSURE_READY=false"
  ].join("\n") + "\n";
  if (evidenceFile) {
    try { await writeFile(evidenceFile, evidence, { mode: 0o600 }); } catch {}
  }
  process.stderr.write(evidence);
  process.exitCode = 1;
});
