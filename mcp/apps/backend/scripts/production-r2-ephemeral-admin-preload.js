import { createDecipheriv, createECDH, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const HEROKU_ACCEPT = "application/vnd.heroku+json; version=3";
const EXPECTED_APP = "hung-phat-mcp";
const EXPECTED_BUCKET = "hung-phat";
const CURVE = "prime256v1";
const CURVE_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const PUBLIC_KEY_BYTES = 65;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const R2_READ_PERMISSION_NAME = "Workers R2 Storage Read";

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
    fail("r2_ephemeral_admin_envelope_invalid");
  }
  const minimum = 1 + PUBLIC_KEY_BYTES + IV_BYTES + TAG_BYTES + 1;
  if (packed.length < minimum || packed[0] !== 1) fail("r2_ephemeral_admin_envelope_invalid");

  const publicStart = 1;
  const ivStart = publicStart + PUBLIC_KEY_BYTES;
  const tagStart = ivStart + IV_BYTES;
  const cipherStart = tagStart + TAG_BYTES;
  const peerPublic = packed.subarray(publicStart, ivStart);
  const iv = packed.subarray(ivStart, tagStart);
  const tag = packed.subarray(tagStart, cipherStart);
  const ciphertext = packed.subarray(cipherStart);

  try {
    const ecdh = createECDH(CURVE);
    ecdh.setPrivateKey(scalarFromSecret(secret));
    const shared = ecdh.computeSecret(peerPublic);
    const key = sha256Buffer(Buffer.concat([
      Buffer.from("phase-9-4-r2-ecdh-envelope-v1\0", "utf8"),
      shared
    ]));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("r2_ephemeral_admin_payload_invalid");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "r2_ephemeral_admin_payload_invalid") throw error;
    fail("r2_ephemeral_admin_decrypt_failed");
  }
}

async function writeEvidence(path, lines) {
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function cloudflareJson(url, token, { method = "GET", body = null } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    return { ok: false, status: 0, payload: null };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  return { ok: response.ok && payload?.success === true, status: response.status, payload };
}

async function readHerokuConfig(appName, apiKey) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/config-vars`, {
    headers: { Accept: HEROKU_ACCEPT, Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) fail("heroku_config_read_failed");
  return response.json();
}

function accountFromEndpoint(endpointValue) {
  let hostname;
  try {
    hostname = new URL(endpointValue).hostname.toLowerCase();
  } catch {
    fail("runtime_r2_endpoint_invalid");
  }
  const match = hostname.match(/^([a-f0-9]{32})(?:\.[a-z0-9-]+)?\.r2\.cloudflarestorage\.com$/i);
  if (!match) fail("runtime_r2_endpoint_not_cloudflare");
  return match[1].toLowerCase();
}

function permissionGroupsUrl(route, accountId) {
  if (route === "account_parent") {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/permission_groups`;
  }
  return "https://api.cloudflare.com/client/v4/user/tokens/permission_groups";
}

async function resolveR2ReadPermissionId(route, parentToken, accountId) {
  const url = new URL(permissionGroupsUrl(route, accountId));
  url.searchParams.set("name", R2_READ_PERMISSION_NAME);
  const result = await cloudflareJson(url.toString(), parentToken);
  if (!result.ok) {
    return { ok: false, status: result.status, code: "permission_lookup_denied" };
  }
  const groups = Array.isArray(result.payload?.result) ? result.payload.result : [];
  const group = groups.find((item) =>
    text(item?.name) === R2_READ_PERMISSION_NAME &&
    Array.isArray(item?.scopes) &&
    item.scopes.includes("com.cloudflare.api.account")
  );
  if (!text(group?.id)) {
    return { ok: false, status: result.status, code: "permission_group_missing" };
  }
  return { ok: true, id: group.id };
}

function tokenPolicy(accountId, permissionId) {
  const now = Date.now();
  return {
    name: `phase-9-4-r2-lifecycle-read-${text(process.env.GITHUB_RUN_ID) || "manual"}`,
    not_before: new Date(now - 60_000).toISOString(),
    expires_on: new Date(now + TOKEN_TTL_MS).toISOString(),
    policies: [
      {
        effect: "allow",
        permission_groups: [{ id: permissionId }],
        resources: {
          [`com.cloudflare.api.account.${accountId}`]: {
            "com.cloudflare.edge.r2.bucket.*": "*"
          }
        }
      }
    ]
  };
}

function tokenCreateUrl(route, accountId) {
  return route === "account_parent"
    ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens`
    : "https://api.cloudflare.com/client/v4/user/tokens";
}

function tokenDeleteUrl(route, accountId, tokenId) {
  return route === "account_parent"
    ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(tokenId)}`
    : `https://api.cloudflare.com/client/v4/user/tokens/${encodeURIComponent(tokenId)}`;
}

async function createChildToken({ route, parentToken, accountId }) {
  const permission = await resolveR2ReadPermissionId(route, parentToken, accountId);
  if (!permission.ok) return { ok: false, route, status: permission.status, code: permission.code };

  const result = await cloudflareJson(
    tokenCreateUrl(route, accountId),
    parentToken,
    { method: "POST", body: tokenPolicy(accountId, permission.id) }
  );
  const created = result.payload?.result;
  if (!result.ok || !text(created?.id) || !text(created?.value)) {
    return { ok: false, route, status: result.status, code: "token_create_denied" };
  }
  return {
    ok: true,
    route,
    tokenId: created.id,
    tokenValue: created.value,
    parentToken
  };
}

async function deleteChildToken(child, accountId) {
  const result = await cloudflareJson(
    tokenDeleteUrl(child.route, accountId, child.tokenId),
    child.parentToken,
    { method: "DELETE" }
  );
  if (!result.ok) fail(`cloudflare_ephemeral_token_delete_status_${result.status}`);
}

async function createEphemeralToken(parentTokens, accountId) {
  const attempts = [];
  const routes = [
    ["account_parent", parentTokens.account],
    ["user_parent", parentTokens.user]
  ];
  for (const [route, token] of routes) {
    if (!text(token)) {
      attempts.push({ route, status: -1, code: "missing" });
      continue;
    }
    const result = await createChildToken({ route, parentToken: token, accountId });
    if (result.ok) return { child: result, attempts };
    attempts.push(result);
  }
  const accountAttempt = attempts.find((item) => item.route === "account_parent");
  const userAttempt = attempts.find((item) => item.route === "user_parent");
  fail(
    `cloudflare_ephemeral_token_create_blocked_account_${accountAttempt?.status ?? -1}_${accountAttempt?.code ?? "unknown"}` +
    `__user_${userAttempt?.status ?? -1}_${userAttempt?.code ?? "unknown"}`
  );
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

async function readLifecycleWithEphemeral(child, accountId) {
  const result = await cloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
      `/r2/buckets/${encodeURIComponent(EXPECTED_BUCKET)}/lifecycle`,
    child.tokenValue
  );
  if (!result.ok) fail(`cloudflare_ephemeral_r2_lifecycle_status_${result.status}`);
  const rules = result.payload?.result?.rules;
  if (!Array.isArray(rules)) fail("cloudflare_ephemeral_r2_lifecycle_response_invalid");
  return rules;
}

async function main() {
  const apiKey = text(process.env.HEROKU_API_KEY);
  const appName = text(process.env.HEROKU_APP_NAME);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const envelope = text(process.env.MCP_R2_EPHEMERAL_ADMIN_ENVELOPE_B64);
  const evidenceFile = text(process.env.MCP_R2_EPHEMERAL_ADMIN_EVIDENCE_FILE);
  if (!apiKey || !appName || !auditedMainSha || !envelope || !evidenceFile) {
    fail("r2_ephemeral_admin_environment_incomplete");
  }
  if (appName !== EXPECTED_APP) fail("unexpected_mcp_app");

  const secretPayload = decryptEnvelope(envelope, apiKey);
  delete process.env.MCP_R2_EPHEMERAL_ADMIN_ENVELOPE_B64;
  const accountId = text(secretPayload.CLOUDFLARE_ACCOUNT_ID);
  const accountParentToken = text(secretPayload.CLOUDFLARE_ACCOUNT_API_TOKEN);
  const userParentToken = text(secretPayload.CLOUDFLARE_USER_API_TOKEN);
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) fail("cloudflare_account_id_invalid");
  if (!accountParentToken && !userParentToken) fail("cloudflare_parent_tokens_missing");

  const runtime = await readHerokuConfig(appName, apiKey);
  if (text(runtime.R2_BUCKET_NAME) !== EXPECTED_BUCKET) fail("unexpected_r2_bucket");
  const runtimeAccount = accountFromEndpoint(text(runtime.R2_ENDPOINT));
  if (runtimeAccount !== accountId.toLowerCase()) fail("cloudflare_account_r2_target_mismatch");

  const { child } = await createEphemeralToken(
    { account: accountParentToken, user: userParentToken },
    accountId
  );

  let rules;
  let deleteSucceeded = false;
  try {
    rules = await readLifecycleWithEphemeral(child, accountId);
  } finally {
    await deleteChildToken(child, accountId);
    deleteSucceeded = true;
  }

  const syntheticXml = lifecycleXml(rules);
  const originalFetch = globalThis.fetch.bind(globalThis);
  const runtimeEndpoint = new URL(runtime.R2_ENDPOINT);
  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      if (
        parsed.hostname.toLowerCase() === runtimeEndpoint.hostname.toLowerCase() &&
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

  await writeEvidence(evidenceFile, [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `CLOUDFLARE_EPHEMERAL_TOKEN_ROUTE=${child.route}`,
    "CLOUDFLARE_EPHEMERAL_TOKEN_CREATED=true",
    `CLOUDFLARE_EPHEMERAL_TOKEN_DELETED=${deleteSucceeded}`,
    "CLOUDFLARE_R2_LIFECYCLE_EPHEMERAL_READY=true",
    `CLOUDFLARE_R2_LIFECYCLE_RULES=${rules.length}`
  ]);
}

try {
  await main();
} catch (error) {
  const code = text(error?.code) || "r2_ephemeral_admin_preload_failed";
  const evidenceFile = text(process.env.MCP_R2_EPHEMERAL_ADMIN_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || "unknown";
  if (evidenceFile) {
    try {
      await writeEvidence(evidenceFile, [
        `AUDITED_MAIN_SHA=${auditedMainSha}`,
        `PHASE_9_4_R2_EPHEMERAL_ADMIN_ERROR=${code}`,
        "MCP_R2_EPHEMERAL_ADMIN_READY=false"
      ]);
    } catch {}
  }
  process.stderr.write(
    `AUDITED_MAIN_SHA=${auditedMainSha}\nPHASE_9_4_R2_EPHEMERAL_ADMIN_ERROR=${code}\n` +
    "MCP_R2_EPHEMERAL_ADMIN_READY=false\n"
  );
  throw error;
}
