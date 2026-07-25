import { loadConfig } from '../src/config.js';
import { createR2StorageAdapter } from '../src/storage/r2-adapter.js';
import { buildR2ObjectKey } from '../src/storage/object-key.js';

const config = loadConfig();
if (!config.r2StorageEnabled) {
  console.error('R2 storage is disabled. Set R2_STORAGE_ENABLED=true and provide required credentials to run this smoke script.');
  process.exit(1);
}

const adapter = createR2StorageAdapter(config);
const key = buildR2ObjectKey({
  installationId: config.installationId,
  namespace: 'smoke-test',
  objectName: 'r2-presign.txt',
});

const { url, expiresIn } = await adapter.getPresignedPutUrl({
  key,
  contentType: 'text/plain',
});

console.log(JSON.stringify({
  key,
  url,
  expiresIn,
}, null, 2));
