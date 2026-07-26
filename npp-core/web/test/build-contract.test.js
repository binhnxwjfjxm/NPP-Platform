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

test('manual production workflow toggles the Core web project gate', async () => {
  const workflow = await readText('../../.github/workflows/vercel-production-manual.yml');
  assert.match(workflow, /const path = "npp-core\/web\/vercel\.json"/);
  assert.match(workflow, /git add npp-core\/web\/vercel\.json/);
  assert.match(workflow, /git show origin\/main:npp-core\/web\/vercel\.json/);
  assert.doesNotMatch(workflow, /const path = "vercel\.json"/);
});
