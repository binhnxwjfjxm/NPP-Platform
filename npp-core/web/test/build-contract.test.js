import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'));
}

async function readText(relativePath) {
  return readFile(new URL(relativePath, projectRoot), 'utf8');
}

test('core web package exposes independent build and verification scripts', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.name, 'npp-core-web');
  assert.equal(pkg.scripts.build, 'next build');
  assert.match(pkg.scripts.verify, /typecheck/);
  assert.match(pkg.scripts.verify, /build/);
});

test('Core web Vercel project cannot deploy automatically from Git pushes', async () => {
  const config = await readJson('vercel.json');
  assert.equal(config.git?.deploymentEnabled, false);
  assert.equal(config.builds, undefined);
  assert.equal(config.routes, undefined);
});

test('legacy repository-root Vercel config remains locked without nested routing', async () => {
  const config = await readJson('../../vercel.json');
  assert.equal(config.git?.deploymentEnabled, false);
  assert.equal(config.builds, undefined);
  assert.equal(config.routes, undefined);
  assert.equal(config.build, undefined);
});

test('manual production workflow deploys source from main only', async () => {
  const workflow = await readText('../../.github/workflows/vercel-production-manual.yml');
  assert.match(workflow, /DEPLOY_REF:\s+main/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /Validate Issue #5 trigger comment/);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /npx --yes vercel@latest deploy/);
  assert.doesNotMatch(workflow, /\bvercel build\b/);
  assert.doesNotMatch(workflow, /--prebuilt\b/);
  assert.doesNotMatch(workflow, /--archive=tgz\b/);
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.comment\.body/);
});
