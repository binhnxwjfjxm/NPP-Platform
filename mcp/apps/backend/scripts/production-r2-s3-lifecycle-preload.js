import { createDecipheriv, createECDH, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { signedR2LifecycleRequest } from "../foundation/r2-storage.js";

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
    fail("r2_s3_lifecycle_envelope_invalid");
  }
  const minimum = 1 + PUBLIC_KEY_BYTES + IV_BYTES + TAG_BYTES + 1;
  if (packed.length < minimum || packed[0] !== 1) fail("r2_s3_lifecycle_envelope_invalid");

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
    fail("r2_s3_lifecycle_decrypt_failed");
  }
}

async function readHerokuConfig(appName, apiKey) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/config-vars`, {
    headers: { Accept: HEROKU_ACCEPT, Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) fail("heroku_config_read_failed");
  return response.json();
}

async function writeEvidence(path, lines) {
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}

function lifecycleRuleCount(xml) {
  return Array.from(String(xml).matchAll(/<Rule(?:\s[^>]*)?>[\s\S]*?<\/Rule>/gi)).length;
}

function credentialCandidates(payload) {
  return [
    {
      route: "account_r2",
      accessKeyId: text(payload?.CLOUDFLARE_ACCOUNT_R2_ACCESS_KEY_ID),
      secretAccessKey: text(payload?.CLOUDFLARE_ACCOUNT_R2_SECRET_ACCESS_KEY)
    },
    {
      route: "user_r2",
      accessKeyId: text(payload?.CLOUDFLARE_USER_R2_ACCESS_KEY_ID),
      secretAccessKey: text(payload?.CLOUDFLARE_USER_R2_SECRET_ACCESS_KEY)
    }
  ].filter((item) => item.accessKeyId && item.secretAccessKey);
}

async function readLifecycleWithCandidates(endpoint, payload) {
  const candidates = credentialCandidates(payload);
  if (candidates.length === 0) fail("r2_s3_lifecycle_credentials_missing");

  const attempts = [];
  for (const candidate of candidates) {
    const request = signedR2LifecycleRequest({
      bucket: EXPECTED_BUCKET,
      endpoint: endpoint.toString(),
      region: "auto",
      accessKeyId: candidate.accessKeyId,
      secretAccessKey: candidate.secretAccessKey
    });

    let response;
    try {
      response = await fetch(request.url, request.init);
    } catch {
      attempts.push(`${candidate.route}_network`);
      continue;
    }

    const body = await response.text();
    if (response.ok || (response.status === 404 && /NoSuchLifecycleConfiguration/i.test(body))) {
      return {
        route: candidate.route,
        status: response.status,
        body,
        contentType: response.headers.get("content-type") || "application/xml",
        rules: response.ok ? lifecycleRuleCount(body) : 0
      };
    }
    attempts.push(`${candidate.route}_${response.status}`);
  }

  fail(`r2_s3_lifecycle_blocked_${attempts.join("__") || "unknown"}`);
}

async function main() {
  const apiKey = text(process.env.HEROKU_API_KEY);
  const appName = text(process.env.HEROKU_APP_NAME);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const envelope = text(process.env.MCP_R2_S3_LIFECYCLE_ENVELOPE_B64);
  const evidenceFile = text(process.env.MCP_R2_S3_LIFECYCLE_EVIDENCE_FILE);
  if (!apiKey || !appName || !auditedMainSha || !envelope || !evidenceFile) {
    fail("r2_s3_lifecycle_environment_incomplete");
  }
  if (appName !== EXPECTED_APP) fail("unexpected_mcp_app");

  const runtime = await readHerokuConfig(appName, apiKey);
  if (text(runtime.R2_BUCKET_NAME) !== EXPECTED_BUCKET) fail("unexpected_r2_bucket");
  const endpoint = new URL(text(runtime.R2_ENDPOINT) || fail("missing_runtime_r2_endpoint"));

  const secretPayload = decryptEnvelope(envelope, apiKey);
  const accountId = text(secretPayload?.CLOUDFLARE_ACCOUNT_ID);
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) fail("cloudflare_account_id_invalid");
  const expectedOrigin = `https://${accountId.toLowerCase()}.r2.cloudflarestorage.com`;
  if (
    endpoint.origin !== expectedOrigin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    fail("cloudflare_account_r2_target_mismatch");
  }

  const lifecycle = await readLifecycleWithCandidates(endpoint, secretPayload);
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      if (
        method === "GET" &&
        parsed.hostname.toLowerCase() === endpoint.hostname.toLowerCase() &&
        parsed.pathname === `/${encodeURIComponent(EXPECTED_BUCKET)}` &&
        parsed.searchParams.has("lifecycle")
      ) {
        return new Response(lifecycle.body, {
          status: lifecycle.status,
          headers: { "content-type": lifecycle.contentType }
        });
      }
    }
    return originalFetch(input, init);
  };

  delete process.env.MCP_R2_S3_LIFECYCLE_ENVELOPE_B64;
  await writeEvidence(evidenceFile, [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    "CLOUDFLARE_R2_LIFECYCLE_S3_READY=true",
    `CLOUDFLARE_R2_LIFECYCLE_S3_ROUTE=${lifecycle.route}`,
    `CLOUDFLARE_R2_LIFECYCLE_S3_STATUS=${lifecycle.status}`,
    `CLOUDFLARE_R2_LIFECYCLE_RULES=${lifecycle.rules}`
  ]);
}

try {
  await main();
} catch (error) {
  const code = text(error?.code) || "r2_s3_lifecycle_preload_failed";
  const evidenceFile = text(process.env.MCP_R2_S3_LIFECYCLE_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || "unknown";
  const lines = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `PHASE_9_4_R2_S3_LIFECYCLE_ERROR=${code}`,
    "MCP_R2_S3_LIFECYCLE_READY=false"
  ];
  if (evidenceFile) {
    try { await writeEvidence(evidenceFile, lines); } catch {}
  }
  process.stderr.write(`${lines.join("\n")}\n`);
  throw error;
}
