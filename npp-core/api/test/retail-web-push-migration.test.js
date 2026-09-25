import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('migration 160 đăng ký bảng subscription Web Push của Retail', () => {
  const index = source('../src/migrations/index.js');
  const migration = source('../../../database/migrations/shared/160_retail_web_push_subscriptions.sql');
  assert.match(index, /160_retail_web_push_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.retail_web_push_subscriptions/);
  assert.match(migration, /FOREIGN KEY \(installation_id, user_id\)/);
  assert.match(migration, /endpoint_hash char\(64\)/);
  assert.match(migration, /disabled_at timestamptz/);
  assert.doesNotMatch(migration, /onesignal/i);
});

test('migration 160 production là VPS-only, exact-main, có backup và restore rehearsal', () => {
  const script = source('../scripts/vps-production-migrate-retail-web-push-160.sh');
  const workflow = source('../../../.github/workflows/vps-production-migration-160-manual.yml');
  assert.match(workflow, /\/migrate-vps-production-160/);
  assert.match(workflow, /Verify exact origin\/main SHA/);
  assert.match(workflow, /Fresh backup, restore rehearsal, migrate production and verify/);
  assert.match(workflow, /group: vps-production-db-migration/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /pg_restore --exit-on-error/);
  assert.match(script, /PRODUCTION_RERUN_NOOP=PASS/);
  assert.match(script, /RUNTIME_PRIVILEGES=PASS/);
});

test('deploy Công Ty tự tạo VAPID một lần trong env backend và không cần cấu hình Vercel', () => {
  const workflow = source('../../../.github/workflows/vps-company-backend-manual.yml');
  assert.match(workflow, /ensure_retail_web_push_runtime/);
  assert.match(workflow, /generateKeyPairSync/);
  assert.match(workflow, /RETAIL_WEB_PUSH_VAPID_PUBLIC_KEY/);
  assert.match(workflow, /RETAIL_WEB_PUSH_VAPID_PRIVATE_KEY/);
  assert.match(workflow, /RETAIL_WEB_PUSH_VAPID_SUBJECT=https:\/\/retail\.nguyenlieuhungphat\.com/);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_RETAIL_WEB_PUSH_VAPID_PRIVATE_KEY/);
});
