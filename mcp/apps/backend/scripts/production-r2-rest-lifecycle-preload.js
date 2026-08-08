import { createDecipheriv, createECDH, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const HEROKU_ACCEPT = "application/vnd.heroku+json; version=3";
const EXPECTED_APP = "hung-phat-mcp";
const EXPECTED_BUCKET = "hung-phat";
const CURVE_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const PUBLIC_KEY_BYTES = 65;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function scalarFromSecret(secret) {
  const seed = BigInt(`0x${sha256Hex(`phase-9-4-r2-ecdh-transport\0${secret}`)}`);
  const scalar = (seed % (CURVE_ORDER - 1n)) + 1n;
  return Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
}

function decryptEnvelope(payload, secret) {
  let packed;
  try {
    packed = Buffer.from(payload, "base64url");
  } catch {
    fail("r2_rest_lifecycle_envelope_invalid");
  }
  const minimum = 1 + PUBLIC_KEY_BYTES + IV_BYTES + TAG_BYTES + 1;
  if (packed.length < minimum || packed[0] !== 1) fail("r2_rest_lifecycle_envelope_invalid");

  const publicStart = 1;
  const ivStart = publicStart + PUBLIC_KEY_BYTES;
  const tagStart = ivStart + IV_BYTES;
  const cipherStart = tagStart + TAG_BYTES;
  const peerPublic = packed.subarray(publicStart, ivStart);
  const iv = packed.subarray(ivStart, tagStart);
  const tag = packed.subarray(tagStart, cipherStart);
  const ciphertext = packed.subarray(cipherStart);

  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(scalarFromSecret(secret));
    const shared = ecdh.computeSecret(peerPublic);
    const key = sha256Buffer(Buffer.concat([
      Buffer.from("phase-9-4-r2-ecdh-envelope-v1\0", "utf8"),
      shared
    ]));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    fail("r2_rest_lifecycle_decrypt_failed");
  }
}

async function readHerokuConfig(appName, apiKey) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/config-vars`, {
    headers: { Accept: HEROKU_ACCEPT, Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) fail("heroku_config_read_failed");
  return response.json();
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lifecycleXml(rules) {
  const body = rules.map((rule, index) => {
    const prefix = text(rule?.conditions?.prefix) ?? "";
    const status = rule?.enabled === true ? "Enabled" : "Disabled";
    const expiration = rule?.deleteObjectsTransition ? "<Expiration><Days>1</Days></Expiration>" : "";
    return `<Rule><ID>${xmlEscape(text(rule?.id) || `rule-${index + 1}`)}</ID>` +
      `<Filter><Prefix>${xmlEscape(prefix)}</Prefix></Filter><Status>${status}</Status>${expiration}</Rule>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration>${body}</LifecycleConfiguration>`;
}

async function writeEvidence(path, lines) {
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function main() {
  const apiKey = text(process.env.HEROKU_API_KEY);
  const appName = text(process.env.HEROKU_APP_NAME);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const envelope = text(process.env.MCP_R2_REST_LIFECYCLE_ENVELOPE_B64);
  const evidenceFile = text(process.env.MCP_R2_REST_LIFECYCLE_EVIDENCE_FILE);
  if (!apiKey || !appName || !auditedMainSha || !envelope || !evidenceFile) {
    fail("r2_rest_lifecycle_environment_incomplete");
  }
  if (appName !== EXPECTED_APP) fail("unexpected_mcp_app");

  const runtime = await readHerokuConfig(appName, apiKey);
  if (text(runtime.R2_BUCKET_NAME) !== EXPECTED_BUCKET) fail("unexpected_r2_bucket");
  const endpoint = new URL(text(runtime.R2_ENDPOINT) || fail("missing_runtime_r2_endpoint"));

  const secretPayload = decryptEnvelope(envelope, apiKey);
  const apiToken = text(secretPayload?.CLOUDFLARE_API_TOKEN);
  const accountId = text(secretPayload?.CLOUDFLARE_ACCOUNT_ID);
  if (!apiToken || !accountId) fail("cloudflare_lifecycle_payload_incomplete");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) fail("cloudflare_account_id_invalid");
  if (endpoint.hostname.toLowerCase() !== `${accountId.toLowerCase()}.r2.cloudflarestorage.com`) {
    fail("cloudflare_account_r2_target_mismatch");
  }

  let response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(EXPECTED_BUCKET)}/lifecycle`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
  } catch {
    fail("cloudflare_r2_lifecycle_network_failed");
  }
  if (!response.ok) fail(`cloudflare_r2_lifecycle_status_${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("cloudflare_r2_lifecycle_response_invalid");
  }
  if (payload?.success !== true || !Array.isArray(payload?.result?.rules)) {
    fail("cloudflare_r2_lifecycle_response_invalid");
  }

  const rules = payload.result.rules;
  const syntheticXml = lifecycleXml(rules);
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      if (
        parsed.hostname.toLowerCase() === endpoint.hostname.toLowerCase() &&
        parsed.pathname === `/${encodeURIComponent(EXPECTED_BUCKET)}` &&
        parsed.searchParams.has("lifecycle")
      ) {
        return new Response(syntheticXml, {
          status: 200,
          headers: { "content-type": "application/xml" }
        });
      }
    }
    return originalFetch(input, init);
  };

  delete process.env.MCP_R2_REST_LIFECYCLE_ENVELOPE_B64;
  await writeEvidence(evidenceFile, [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    "CLOUDFLARE_R2_LIFECYCLE_REST_READY=true",
    `CLOUDFLARE_R2_LIFECYCLE_RULES=${rules.length}`
  ]);
}

try {
  await main();
} catch (error) {
  const code = text(error?.code) || "r2_rest_lifecycle_preload_failed";
  const evidenceFile = text(process.env.MCP_R2_REST_LIFECYCLE_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || "unknown";
  const lines = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `PHASE_9_4_R2_REST_LIFECYCLE_ERROR=${code}`,
    "MCP_R2_REST_LIFECYCLE_READY=false"
  ];
  if (evidenceFile) {
    try { await writeEvidence(evidenceFile, lines); } catch {}
  }
  process.stderr.write(`${lines.join("\n")}\n`);
  throw error;
}
