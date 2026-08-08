import test from "node:test";
import assert from "node:assert/strict";
import {
  presignR2Get,
  presignR2Put,
  signedR2DeleteRequest,
  signedR2GetRequest,
  signedR2HeadRequest,
  signedR2LifecycleRequest,
  signedR2ListRequest
} from "./r2-storage.js";

const config = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "hung-phat",
  region: "auto",
  accessKeyId: "test-access-id",
  secretAccessKey: "test-signing-value"
};
const now = new Date("2026-07-19T08:00:00.000Z");

test("presigned PUT is short-lived and binds content type", () => {
  const result = presignR2Put(config, "mcp-plan/outlets/npp/customer/photo 1.jpg", "image/jpeg", { now, expiresSeconds: 300 });
  const url = new URL(result.putUrl);
  assert.equal(url.pathname, "/hung-phat/mcp-plan/outlets/npp/customer/photo%201.jpg");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assert.match(url.searchParams.get("X-Amz-Signature") || "", /^[0-9a-f]{64}$/);
  assert.deepEqual(result.requiredHeaders, { "Content-Type": "image/jpeg" });
  assert.equal(result.expiresAt, "2026-07-19T08:05:00.000Z");
});

test("presigned GET is short-lived and keeps the object private", () => {
  const result = presignR2Get(config, "mcp-plan/outlets/npp/customer/photo 1.jpg", { now, expiresSeconds: 300 });
  const url = new URL(result.getUrl);
  assert.equal(url.pathname, "/hung-phat/mcp-plan/outlets/npp/customer/photo%201.jpg");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(url.searchParams.get("X-Amz-Signature") || "", /^[0-9a-f]{64}$/);
  assert.doesNotMatch(result.getUrl, /test-signing-value/);
  assert.equal(result.expiresAt, "2026-07-19T08:05:00.000Z");
});

test("signed GET and HEAD verification never expose signing material", () => {
  for (const request of [
    signedR2GetRequest(config, "mcp-plan/outlets/npp/customer/photo.jpg", { now }),
    signedR2HeadRequest(config, "mcp-plan/outlets/npp/customer/photo.jpg", { now })
  ]) {
    assert.match(request.init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-access-id\//);
    assert.doesNotMatch(request.init.headers.Authorization, /test-signing-value/);
    assert.equal(request.init.headers["x-amz-content-sha256"], "UNSIGNED-PAYLOAD");
  }
});

test("DELETE is signed against the exact bucket object and is safe to retry", () => {
  const request = signedR2DeleteRequest(config, "mcp-plan/outlets/npp/customer/photo 1.jpg", { now });
  const url = new URL(request.url);
  assert.equal(request.init.method, "DELETE");
  assert.equal(url.pathname, "/hung-phat/mcp-plan/outlets/npp/customer/photo%201.jpg");
  assert.match(request.init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-access-id\//);
  assert.doesNotMatch(request.init.headers.Authorization, /test-signing-value/);
});

test("ListObjectsV2 is signed with canonical prefix and pagination query", () => {
  const request = signedR2ListRequest(config, {
    prefix: "mcp-plan/outlets/fixture install/",
    continuationToken: "next/token+value",
    maxKeys: 500,
    now
  });
  const url = new URL(request.url);
  assert.equal(request.init.method, "GET");
  assert.equal(url.pathname, "/hung-phat");
  assert.equal(url.searchParams.get("list-type"), "2");
  assert.equal(url.searchParams.get("max-keys"), "500");
  assert.equal(url.searchParams.get("prefix"), "mcp-plan/outlets/fixture install/");
  assert.equal(url.searchParams.get("continuation-token"), "next/token+value");
  assert.match(request.init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-access-id\//);
});

test("bucket lifecycle read is a signed read-only subresource request", () => {
  const request = signedR2LifecycleRequest(config, { now });
  const url = new URL(request.url);
  assert.equal(request.init.method, "GET");
  assert.equal(url.pathname, "/hung-phat");
  assert.equal(url.searchParams.has("lifecycle"), true);
  assert.match(request.init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-access-id\//);
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("../../../../", import.meta.url);
const mediaAuditWorkflowUrl = new URL(".github/workflows/mcp-r2-media-audit.yml", repositoryRoot);
const mediaAuditScriptUrl = new URL("mcp/apps/backend/scripts/production-media-audit.js", repositoryRoot);

function readSource(url) {
  return readFileSync(url, "utf8").replace(/\r\n/g, "\n");
}

test("Phase 9.4 media audit contract stays exact-main and mutation-free", () => {
  const workflow = readSource(mediaAuditWorkflowUrl);
  const script = readSource(mediaAuditScriptUrl);
  execFileSync(process.execPath, ["--check", fileURLToPath(mediaAuditScriptUrl)]);

  assert.match(workflow, /github\.event\.issue\.number == 391/);
  assert.match(workflow, /github\.event\.comment\.body == '\/audit-mcp-r2-media'/);
  assert.match(workflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /working-directory: mcp\/apps\/backend/);
  assert.match(workflow, /node mcp\/apps\/backend\/scripts\/production-media-audit\.js/);
  assert.match(workflow, /issues\/391\/comments/);
  assert.doesNotMatch(workflow, /container:(?:push|release)/);
  assert.doesNotMatch(workflow, /maintenance:(?:on|off)/);
  assert.doesNotMatch(workflow, /migration:migrate/);
  assert.doesNotMatch(workflow, /config:set/);

  assert.match(script, /BEGIN READ ONLY/);
  assert.match(script, /default_transaction_read_only=on/);
  assert.match(script, /signedR2ListRequest/);
  assert.match(script, /signedR2GetRequest/);
  assert.match(script, /signedR2LifecycleRequest/);
  assert.doesNotMatch(script, /signedR2DeleteRequest/);
  assert.doesNotMatch(script, /presignR2Put/);
  assert.doesNotMatch(script, /method:\s*[#'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.match(script, /MCP_MEDIA_COPY_REQUIRED/);
  assert.match(script, /MCP_MEDIA_RECONCILIATION_READY/);
  assert.match(script, /MCP_MEDIA_DB_MANIFEST_SHA256/);
  assert.match(script, /R2_CONTENT_MANIFEST_SHA256/);
});
