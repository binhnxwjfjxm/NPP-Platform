import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function text(value) {
  return String(value ?? '').trim();
}

function required(source, name) {
  const value = text(source?.[name]);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

export function buildCompanyR2Config(source = {}) {
  const bucket = text(source.R2_BUCKET_NAME) || text(source.R2_BUCKET);
  const publicBaseUrl = text(source.CLOUDFLARE_R2_PUBLIC_URL) || text(source.R2_PUBLIC_BASE_URL);
  if (!bucket) throw new Error('missing_r2_bucket');
  if (!publicBaseUrl) throw new Error('missing_r2_public_base_url');

  return Object.freeze({
    R2_ENABLED: 'true',
    R2_ENDPOINT: required(source, 'R2_ENDPOINT'),
    R2_REGION: text(source.R2_REGION) || 'auto',
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: required(source, 'R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: required(source, 'R2_SECRET_ACCESS_KEY'),
    R2_PUBLIC_BASE_URL: publicBaseUrl.replace(/\/+$/, ''),
    R2_CONTRACT_ROUTE_ENABLED: 'true',
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const sourceFile = text(process.env.R2_SOURCE_CONFIG_FILE);
  const targetFile = text(process.env.R2_TARGET_CONFIG_FILE);
  if (!sourceFile || !targetFile) throw new Error('r2_config_file_paths_required');
  const source = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const target = buildCompanyR2Config(source);
  writeFileSync(targetFile, JSON.stringify(target, null, 2) + '\n', { mode: 0o600 });
}
