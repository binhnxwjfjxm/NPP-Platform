import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'));
}

test('core web package exposes independent build and verification scripts', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.name, 'npp-core-web');
  assert.equal(pkg.scripts.build, 'next build');
  assert.match(pkg.scripts.verify, /typecheck/);
  assert.match(pkg.scripts.verify, /build/);
});

test('core Vercel project cannot deploy automatically from Git pushes', async () => {
  const config = await readJson('vercel.json');
  assert.equal(config.git?.deploymentEnabled, false);
});

test('root Vercel project builds and preserves routes to Core web', async () => {
  const config = await readJson('../../vercel.json');
  assert.equal(config.version, 2);
  assert.equal(config.builds?.length, 1);
  assert.equal(config.builds[0]?.src, 'npp-core/web/package.json');
  assert.equal(config.builds[0]?.use, '@vercel/next');
  assert.equal(config.routes?.length, 1);
  assert.equal(config.routes[0]?.src, '/(.*)');
  assert.equal(config.routes[0]?.dest, 'npp-core/web/$1');
  assert.equal(config.build?.env?.NEXT_PUBLIC_CORE_API_URL, 'https://hung-phat-945da1547594.herokuapp.com');
  assert.equal(config.build?.env?.NEXT_PUBLIC_APP_NAME, 'NPP Core');
  assert.equal(config.git?.deploymentEnabled, false);
});
