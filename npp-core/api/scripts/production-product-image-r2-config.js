import { writeFile } from 'node:fs/promises';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const HEROKU_ACCEPT = 'application/vnd.heroku+json; version=3';
const SOURCE_APP = 'hung-phat-mcp';
const TARGET_APP = 'hung-phat';
const EXPECTED_BUCKET = 'hung-phat';
const PRODUCT_PREFIX = 'app-customer/products/';

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

async function herokuConfig(appName, apiKey, { method = 'GET', body = null } = {}) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}/config-vars`, {
    method,
    headers: {
      Accept: HEROKU_ACCEPT,
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) fail(method === 'GET' ? 'heroku_config_read_failed' : 'heroku_config_patch_failed');
  return response.json();
}

async function herokuApp(appName, apiKey) {
  const response = await fetch(`https://api.heroku.com/apps/${encodeURIComponent(appName)}`, {
    headers: { Accept: HEROKU_ACCEPT, Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) fail('heroku_app_read_failed');
  return response.json();
}

function assertR2Endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('source_r2_endpoint_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')) {
    fail('source_r2_endpoint_invalid');
  }
}

function assertPublicBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('source_r2_public_url_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password) fail('source_r2_public_url_invalid');
}

function resolveSourceR2(config) {
  const endpoint = text(config.R2_ENDPOINT);
  const accessKeyId = text(config.R2_ACCESS_KEY_ID);
  const secretAccessKey = text(config.R2_SECRET_ACCESS_KEY);
  const region = text(config.R2_REGION) || 'auto';
  const bucket = text(config.R2_BUCKET_NAME) || text(config.R2_BUCKET);
  const publicBaseUrl = text(config.CLOUDFLARE_R2_PUBLIC_URL) || text(config.R2_PUBLIC_BASE_URL);
  if (!endpoint || !accessKeyId || !secretAccessKey) fail('source_r2_credentials_missing');
  if (bucket !== EXPECTED_BUCKET) fail('source_r2_bucket_mismatch');
  if (!publicBaseUrl) fail('source_r2_public_url_missing');
  assertR2Endpoint(endpoint);
  assertPublicBase(publicBaseUrl);
  return Object.freeze({ endpoint, accessKeyId, secretAccessKey, region, bucket, publicBaseUrl: publicBaseUrl.replace(/\/+$/, '') });
}

function clientFor(r2) {
  return new S3Client({
    region: r2.region,
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
}

async function probeR2(r2, runId) {
  const client = clientFor(r2);
  const key = `_company-product-image-config-smoke/${runId}-${Date.now()}.txt`;
  let uploaded = false;
  try {
    let listed;
    try {
      listed = await client.send(new ListObjectsV2Command({ Bucket: r2.bucket, Prefix: PRODUCT_PREFIX, MaxKeys: 10 }));
    } catch {
      fail('source_r2_product_list_failed');
    }
    const sampleCount = Array.isArray(listed?.Contents) ? listed.Contents.length : 0;
    if (sampleCount < 1) fail('source_r2_product_images_not_found');

    try {
      await client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: 'company-product-image-config-smoke', ContentType: 'text/plain' }));
      uploaded = true;
      const head = await client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
      if (!Number.isInteger(head?.ContentLength) || head.ContentLength < 1) fail('source_r2_smoke_head_invalid');
    } catch (error) {
      if (error?.code && String(error.code).startsWith('source_r2_')) throw error;
      fail('source_r2_object_write_failed');
    }
    return sampleCount;
  } finally {
    if (uploaded) {
      try { await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })); } catch { fail('source_r2_smoke_cleanup_failed'); }
    }
    client.destroy();
  }
}

function desiredCoreConfig(r2) {
  return Object.freeze({
    R2_ENABLED: 'true',
    R2_ENDPOINT: r2.endpoint,
    R2_REGION: r2.region,
    R2_BUCKET: r2.bucket,
    R2_ACCESS_KEY_ID: r2.accessKeyId,
    R2_SECRET_ACCESS_KEY: r2.secretAccessKey,
    R2_PUBLIC_BASE_URL: r2.publicBaseUrl,
    R2_PRESIGNED_URL_MAX_SECONDS: '900',
    R2_MAX_OBJECT_BYTES: '5242880',
  });
}

function changedPatch(before, desired) {
  const patch = {};
  for (const [name, value] of Object.entries(desired)) {
    if (text(before?.[name]) !== value) patch[name] = value;
  }
  return patch;
}

function verifyCoreConfig(after, desired) {
  for (const [name, value] of Object.entries(desired)) {
    if (text(after?.[name]) !== value) fail(`core_${name.toLowerCase()}_not_applied`);
  }
}

async function waitForHealth(baseUrl) {
  const root = baseUrl.replace(/\/$/, '');
  const deadline = Date.now() + 120000;
  let lastLive = 0;
  let lastReady = 0;
  while (Date.now() < deadline) {
    try {
      const [live, ready] = await Promise.all([
        fetch(`${root}/health/live`, { redirect: 'manual' }),
        fetch(`${root}/health/ready`, { redirect: 'manual' }),
      ]);
      lastLive = live.status;
      lastReady = ready.status;
      if (lastLive === 200 && lastReady === 200) return { live: lastLive, ready: lastReady };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  fail(`core_health_failed_${lastLive}_${lastReady}`);
}

async function waitForProductImageIndex(baseUrl, backendToken) {
  const root = baseUrl.replace(/\/$/, '');
  const deadline = Date.now() + 120000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${root}/api/products/images`, {
        headers: { Authorization: `Bearer ${backendToken}`, Accept: 'application/json' },
      });
      lastStatus = response.status;
      const payload = await response.json().catch(() => null);
      if (response.ok && Array.isArray(payload?.data?.codes) && typeof payload?.data?.baseUrl === 'string') {
        if (payload.data.codes.length < 1) fail('core_product_image_index_empty');
        return payload.data.codes.length;
      }
    } catch (error) {
      if (error?.code === 'core_product_image_index_empty') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  fail(`core_product_image_index_failed_${lastStatus}`);
}

async function main() {
  const apiKey = text(process.env.HEROKU_API_KEY);
  const sourceApp = text(process.env.R2_SOURCE_APP);
  const targetApp = text(process.env.R2_TARGET_APP);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA);
  const evidenceFile = text(process.env.COMPANY_PRODUCT_IMAGE_R2_EVIDENCE_FILE);
  const runId = text(process.env.GITHUB_RUN_ID) || 'manual';
  if (!apiKey || !sourceApp || !targetApp || !auditedMainSha || !evidenceFile) fail('company_product_image_r2_environment_incomplete');
  if (sourceApp !== SOURCE_APP || targetApp !== TARGET_APP) fail('company_product_image_r2_app_boundary_invalid');

  const [sourceConfig, targetBefore] = await Promise.all([
    herokuConfig(sourceApp, apiKey),
    herokuConfig(targetApp, apiKey),
  ]);
  const r2 = resolveSourceR2(sourceConfig);
  const sourceImageSampleCount = await probeR2(r2, runId);
  const desired = desiredCoreConfig(r2);
  const patch = changedPatch(targetBefore, desired);
  const changed = Object.keys(patch).length > 0;
  if (changed) await herokuConfig(targetApp, apiKey, { method: 'PATCH', body: patch });

  const targetAfter = await herokuConfig(targetApp, apiKey);
  verifyCoreConfig(targetAfter, desired);
  const backendToken = text(targetAfter.BACKEND_API_TOKEN);
  if (!backendToken) fail('core_backend_token_missing');
  const app = await herokuApp(targetApp, apiKey);
  const webUrl = text(app.web_url);
  if (!webUrl) fail('core_web_url_missing');
  const health = await waitForHealth(webUrl);
  const indexCount = await waitForProductImageIndex(webUrl, backendToken);

  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `R2_SOURCE_APP=${sourceApp}`,
    `R2_TARGET_APP=${targetApp}`,
    `COMPANY_PRODUCT_IMAGE_R2_CONFIG_CHANGED=${changed}`,
    'COMPANY_PRODUCT_IMAGE_R2_SECRET_CONFIG_PRESENT=true',
    'COMPANY_PRODUCT_IMAGE_R2_SHARED_BUCKET_VERIFIED=true',
    `COMPANY_PRODUCT_IMAGE_R2_SOURCE_SAMPLE_COUNT=${sourceImageSampleCount}`,
    `COMPANY_PRODUCT_IMAGE_INDEX_COUNT=${indexCount}`,
    `CORE_HEALTH_LIVE=${health.live}`,
    `CORE_HEALTH_READY=${health.ready}`,
  ].join('\n') + '\n';
  await writeFile(evidenceFile, evidence, { mode: 0o600 });
  process.stdout.write(evidence);
}

main().catch(async (error) => {
  const code = text(error?.code) || 'company_product_image_r2_config_failed';
  const evidenceFile = text(process.env.COMPANY_PRODUCT_IMAGE_R2_EVIDENCE_FILE);
  const auditedMainSha = text(process.env.AUDITED_MAIN_SHA) || 'unknown';
  const evidence = [
    `AUDITED_MAIN_SHA=${auditedMainSha}`,
    `COMPANY_PRODUCT_IMAGE_R2_CONFIG_ERROR=${code}`,
    'COMPANY_PRODUCT_IMAGE_R2_READY=false',
  ].join('\n') + '\n';
  if (evidenceFile) {
    try { await writeFile(evidenceFile, evidence, { mode: 0o600 }); } catch {}
  }
  process.stderr.write(evidence);
  process.exitCode = 1;
});
