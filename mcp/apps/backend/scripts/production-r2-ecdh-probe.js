import {
  createDecipheriv,
  createECDH,
  createHash
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  presignR2Get,
  presignR2Put,
  signedR2DeleteRequest,
  signedR2HeadRequest,
  signedR2LifecycleRequest
} from "../foundation/r2-storage.js";

const HEROKU_ACCEPT = "application/vnd.heroku+json; version=3";
const EXPECTED_APP = "hung-phat-mcp";
const EXPECTED_BUCKET = "hung-phat";
const EXPECTED_PUBLIC_URL = "https://pub-7d2987fab97d4e3ebb2021a823973862.r2.dev";
const CURVE = "prime256v1";
const CURVE_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const ENVELOPE_VERSION = 1;
const PUBLIC_KEY_BYTES = 65;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const REQUIRED_CANDIDATE = Object.freeze([
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

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function scalarBufferFromSecret(secret) {
  const seed = BigInt(`0x${sha256Hex(`phase-9-4-r2-ecdh-transport\0${secret}`)}`);
  const scalar = (seed % (CURVE_ORDER - 1n)) + 1n;
  return Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
}

function transportEcdh(secret) {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(scalarBufferFromSecret(secret));
  return ecdh;
}

function transportPublicKey(secret) {
  return transportEcdh(secret).getPublicKey(undefined, "uncompressed").toString("base64url");
}

function decryptEnvelope(payload, secret) {
  let packed;
  try {
    packed = Buffer.from(payload, "base64url");
  } catch {
    fail("r2_ecdh_envelope_invalid");
  }
  const minimum = 1 + PUBLIC_KEY_BYTES + IV_BYTES + TAG_BYTES + 1;
  if (packed.length < minimum || packed[0] !== ENVELOPE_VERSION) fail("r2_ecdh_envelope_invalid");

  const publicKeyStart = 1;
  const ivStart = publicKeyStart + PUBLIC_KEY_BYTES;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const ephemeralPublicKey = packed.subarray(publicKeyStart, ivStart);
  const iv = packed.subarray(ivStart, tagStart);
  const tag = packed.subarray(tagStart, ciphertextStart);
  const ciphertext = packed.subarray(ciphertextStart);

  try {
    const ecdh = transportEcdh(secret);
    const shared = ecdh.computeSecret(ephemeralPublicKey);
    const key = sha256Buffer(Buffer.concat([
      Buffer.from("phase-9-4-r2-ecdh-envelope-v1\0", "utf8"),
      shared
    ]));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("r2_ecdh_payload_invalid");
    return parsed;
  } catch (error) {
    if (error?.code === "r2_ecdh_payload_invalid") throw error;
    fail("r2_ecdh_decrypt_failed");
  }
}

function assertCloudflareEndpoint(value) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    fail("candidate_r2_endpoint_invalid");
  }
  if (!hostname.endsWith(".r2.cloudflarestorage.com")) fail("candidate_r2_endpoint_not_cloudflare");
}

function candidateConfig(payload) {
  for (const name of REQUIRED_CANDIDATE) {
    if (!text(payload?.[name])) fail(`candidate_missing_${name.toLowerCase()}`);
  }
  assertCloudflareEndpoint(payload.R2_ENDPOINT);
  return Object.freeze({
    bucket: EXPECTED_BUCKET,
    endpoint: payload.R2_ENDPOINT,
    region: text(payload.R2_REGION) || "auto",
    accessKeyId: payload.R2_ACCESS_KEY_ID,
    secretAccessKey: payload.R2_SECRET_ACCESS_KEY
  });
}

async function herokuConfig(appName, apiKey, { method = "GET", body = null } = {}) {
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

async function probeLifecycle(config) {
  const request = signedR2LifecycleRequest(config);
  let response;
  try {
    response = await fetch(request.url, request.init);
  } catch {
    fail("candidate_r2_lifecycle_network_failed");
  }
  const body = await response.text();
  if (response.status === 404 && /NoSuchLifecycleConfiguration/i.test(body)) return true;
  if (!response.ok) fail(`candidate_r2_lifecycle_status_${response.status}`);
  return true;
}

async function probeObjectCrud(config, runId) {
  const payload = `phase-9-4-ecdh-probe:${runId}:${Date.now()}`;
  const key = `mcp-plan/_phase-9-4-ecdh-probe/${runId}-${sha256Hex(payload).slice(0, 16)}.txt`;
  const put = presignR2Put(config, key, "text/plain", { expiresSeconds: 120 });
  let uploaded = false;
  try {
    let putResponse;
    try {
      putResponse = await fetch(put.putUrl, { method: "PUT", headers: put.requiredHeaders, body: payload });
    } catch {
      fail("candidate_r2_put_network_failed");
    }
    if (!putResponse.ok) fail(`candidate_r2_put_status_${putResponse.status}`);
    uploaded = true;

    const get = presignR2Get(config, key, { expiresSeconds: 120 });
    let getResponse;
    try {
      getResponse = await fetch(get.getUrl);
    } catch {
      fail("candidate_r2_get_network_failed");
    }
    if (!getResponse.ok) fail(`candidate_r2_get_status_${getResponse.status}`);
    if (await getResponse.text() !== payload) fail("candidate_r2_get_content_mismatch");
  } finally {
    if (uploaded) {
      const deletion = signedR2DeleteRequest(config, key);
      let deleteResponse;
      try {
        deleteResponse = await fetch(deletion.url, deletion.init);
      } catch {
        fail("candidate_r2_delete_network_failed");
      }
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        fail(`candidate_r2_delete_status_${deleteResponse.status}`);
      }
      const head = signedR2HeadRequest(config, key);
      let headResponse;
      try {
        headResponse = await fetch(head.url, head.init);
      } catch {
        fail("candidate_r2_head_network_failed");
      }
      if (headResponse.status !== 404) fail(`candidate_r2_delete_verify_status_${headResponse.status}`);
    }
  }
  return true;
}

async function writeEvidence(path, lines) {
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function main() {
  const mode = text(process.env.MCP_R2_ECDH_MODE);
  const apiKey = text(process.env.HEROKU_API_KEY);
  const appName = text(process.env.HEROKU_APP_NAME);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const evidenceFile = text(process.env.MCP_R2_ECDH_EVIDENCE_FILE);
  const runId = text(process.env.GITHUB_RUN_ID) || "manual";
  if (!mode || !apiKey || !appName || !auditedMainSha || !evidenceFile) fail("r2_ecdh_environment_incomplete");
  if (appName !== EXPECTED_APP) fail("unexpected_mcp_app");

  if (mode === "prepare") {
    await writeEvidence(evidenceFile, [
      `AUDITED_MAIN_SHA=${auditedMainSha}`,
      "MCP_R2_ECDH_TRANSPORT_READY=true",
      `MCP_R2_ECDH_PUBLIC_KEY_P256=${transportPublicKey(apiKey)}`
    ]);
    return;
  }

  if (mode !== "replace") fail("r2_ecdh_mode_invalid");
  const envelope = text(process.env.MCP_R2_ECDH_ENVELOPE_B64);
  if (!envelope) fail("r2_ecdh_envelope_missing");
  const secretPayload = decryptEnvelope(envelope, apiKey);
  const candidate = candidateConfig(secretPayload);

  await probeLifecycle(candidate);
  await probeObjectCrud(candidate, `${runId}-candidate`);

  const patch = {
    R2_ENDPOINT: candidate.endpoint,
    R2_ACCESS_KEY_ID: candidate.accessKeyId,
    R2_SECRET_ACCESS_KEY: candidate.secretAccessKey,
    R2_REGION: candidate.region,
    R2_BUCKET_NAME: EXPECTED_BUCKET,
    CLOUDFLARE_R2_PUBLIC_URL: EXPECTED_PUBLIC_URL
  };
  await herokuConfig(appName, apiKey, { method: "PATCH", body: patch });
  const after = await herokuConfig(appName, apiKey);
  if (text(after.R2_BUCKET_NAME) !== EXPECTED_BUCKET) fail("candidate_patch_bucket_not_applied");
  if (text(after.R2_ENDPOINT) !== candidate.endpoint) fail("candidate_patch_endpoint_not_applied");
  if (text(after.R2_ACCESS_KEY_ID) !== candidate.accessKeyId) fail("candidate_patch_access_key_not_applied");
  if (text(after.CLOUDFLARE_R2_PUBLIC_URL) !== EXPECTED_PUBLIC_URL) fail("candidate_patch_public_url_not_applied");

  const fingerprint = sha256Hex(`${new URL(candidate.endpoint).hostname.toLowerCase()}\n${EXPECTED_BUCKET}\n${candidate.accessKeyId}`);
  await writeEvidence(evidenceFile, [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    "MCP_R2_ECDH_TRANSPORT_READY=true",
    "MCP_R2_CANDIDATE_LIFECYCLE_READ=true",
    "MCP_R2_CANDIDATE_SMOKE_PUT=true",
    "MCP_R2_CANDIDATE_SMOKE_GET=true",
    "MCP_R2_CANDIDATE_SMOKE_DELETE=true",
    "MCP_R2_CREDENTIAL_REPLACED=true",
    `MCP_R2_CANDIDATE_FINGERPRINT_SHA256=${fingerprint}`
  ]);
}

main().catch(async (error) => {
  const code = text(error?.code) || "r2_ecdh_probe_failed";
  const evidenceFile = text(process.env.MCP_R2_ECDH_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || "unknown";
  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `PHASE_9_4_R2_ECDH_ERROR=${code}`,
    "MCP_R2_ECDH_READY=false"
  ];
  if (evidenceFile) {
    try { await writeEvidence(evidenceFile, evidence); } catch {}
  }
  process.stderr.write(`${evidence.join("\n")}\n`);
  process.exitCode = 1;
});
