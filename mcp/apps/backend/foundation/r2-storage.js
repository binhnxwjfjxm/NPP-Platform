import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function encodePath(value) {
  return String(value).split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function timestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secret, dateStamp, region) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function credentialScope(dateStamp, region) {
  return `${dateStamp}/${region}/${SERVICE}/aws4_request`;
}

function canonicalQuery(entries) {
  return entries
    .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function r2BucketUrl(config) {
  const endpoint = new URL(config.endpoint);
  endpoint.pathname = `/${encodeURIComponent(config.bucket)}`;
  endpoint.search = "";
  return endpoint;
}

function r2ObjectUrl(config, objectKey) {
  const endpoint = r2BucketUrl(config);
  endpoint.pathname = `${endpoint.pathname}/${encodePath(objectKey)}`;
  return endpoint;
}

function signedR2Request(config, url, method, { queryEntries = [], now = new Date() } = {}) {
  const amzDate = timestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = credentialScope(dateStamp, config.region);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const query = canonicalQuery(queryEntries);
  url.search = query;
  const canonicalRequest = [
    method,
    url.pathname,
    query,
    `host:${url.host}\nx-amz-content-sha256:${UNSIGNED_PAYLOAD}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    UNSIGNED_PAYLOAD
  ].join("\n");
  const stringToSign = [ALGORITHM, amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign, "hex");
  return {
    url: url.toString(),
    init: {
      method,
      headers: {
        Authorization: `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        "x-amz-content-sha256": UNSIGNED_PAYLOAD,
        "x-amz-date": amzDate
      }
    }
  };
}

function signedR2ObjectRequest(config, objectKey, method, options = {}) {
  return signedR2Request(config, r2ObjectUrl(config, objectKey), method, options);
}

function presignR2Object(config, objectKey, method, signedHeaders, canonicalHeaders, { expiresSeconds = 300, now = new Date() } = {}) {
  const url = r2ObjectUrl(config, objectKey);
  const amzDate = timestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = credentialScope(dateStamp, config.region);
  const query = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders]
  ];
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD
  ].join("\n");
  const stringToSign = [ALGORITHM, amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign, "hex");
  query.push(["X-Amz-Signature", signature]);
  url.search = canonicalQuery(query);
  return {
    url: url.toString(),
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString()
  };
}

export function presignR2Put(config, objectKey, contentType, { expiresSeconds = 300, now = new Date() } = {}) {
  const signed = presignR2Object(
    config,
    objectKey,
    "PUT",
    "content-type;host",
    `content-type:${contentType}\nhost:${new URL(config.endpoint).host}\n`,
    { expiresSeconds, now }
  );
  return {
    putUrl: signed.url,
    expiresAt: signed.expiresAt,
    requiredHeaders: { "Content-Type": contentType }
  };
}

export function presignR2Get(config, objectKey, { expiresSeconds = 300, now = new Date() } = {}) {
  const endpoint = new URL(config.endpoint);
  const signed = presignR2Object(
    config,
    objectKey,
    "GET",
    "host",
    `host:${endpoint.host}\n`,
    { expiresSeconds, now }
  );
  return { getUrl: signed.url, expiresAt: signed.expiresAt };
}

export function signedR2GetRequest(config, objectKey, options = {}) {
  return signedR2ObjectRequest(config, objectKey, "GET", options);
}

export function signedR2HeadRequest(config, objectKey, options = {}) {
  return signedR2ObjectRequest(config, objectKey, "HEAD", options);
}

export function signedR2DeleteRequest(config, objectKey, options = {}) {
  return signedR2ObjectRequest(config, objectKey, "DELETE", options);
}

export function signedR2ListRequest(
  config,
  { prefix = "", continuationToken = null, maxKeys = 1000, now = new Date() } = {}
) {
  const boundedMaxKeys = Math.max(1, Math.min(Math.trunc(Number(maxKeys) || 1000), 1000));
  const queryEntries = [
    ["list-type", "2"],
    ["max-keys", String(boundedMaxKeys)]
  ];
  if (prefix) queryEntries.push(["prefix", String(prefix)]);
  if (continuationToken) queryEntries.push(["continuation-token", String(continuationToken)]);
  return signedR2Request(config, r2BucketUrl(config), "GET", { queryEntries, now });
}

export function signedR2LifecycleRequest(config, { now = new Date() } = {}) {
  return signedR2Request(config, r2BucketUrl(config), "GET", {
    queryEntries: [["lifecycle", ""]],
    now
  });
}
