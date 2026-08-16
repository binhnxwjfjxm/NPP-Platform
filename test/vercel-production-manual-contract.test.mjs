import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/vercel-production-manual.yml', import.meta.url),
  'utf8',
);

test('manual Vercel production workflow remains source deploy only', () => {
  assert.match(workflow, /DEPLOY_REF:\s+main/);
  assert.match(workflow, /PRODUCTION_URL:\s+https:\/\/npp-platform\.vercel\.app/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /Validate Issue #5 trigger comment/);
  assert.match(workflow, /trimmed_comment/);
  assert.match(workflow, /\/deploy-vercel-production/);
  assert.match(workflow, /npx --yes vercel@latest deploy/);
  assert.match(workflow, /--prod/);
  assert.match(workflow, /Smoke test production alias/);
  assert.match(workflow, /smoke_login_assets/);
  assert.match(workflow, /for attempt in \{1\.\.12\}/);
  assert.match(workflow, /Hệ thống điều hành Công Ty/);
  assert.doesNotMatch(workflow, /Welcome to Hung Phat Operations\./);
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.comment\.body/);
  assert.doesNotMatch(workflow, /\bvercel build\b/);
  assert.doesNotMatch(workflow, /--prebuilt\b/);
  assert.doesNotMatch(workflow, /--archive=tgz\b/);
  assert.doesNotMatch(workflow, /DEPLOYMENT_URL:\s+\$\{\{\s+steps\.deploy\.outputs\.url\s+\}\}/);
});
