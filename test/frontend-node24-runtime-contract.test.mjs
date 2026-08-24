import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);
const readText = (path) => readFile(new URL(path, repoRoot), 'utf8');
const readJson = async (path) => JSON.parse(await readText(path));

test('frontend Vercel runtimes use Node 24 while backend root stays on Node 20', async () => {
  const [
    rootPackage,
    companyPackage,
    companyCi,
    companyProduction,
    deliveryCi,
    deliveryProduction,
    deliveryScript,
    retailCi,
    retailProduction,
    retailBootstrap,
  ] = await Promise.all([
    readJson('package.json'),
    readJson('npp-core/web/package.json'),
    readText('.github/workflows/company-web-node24-compatibility.yml'),
    readText('.github/workflows/vercel-production-manual.yml'),
    readText('.github/workflows/delivery-web-ci.yml'),
    readText('.github/workflows/vercel-delivery-production-manual.yml'),
    readText('delivery/web/scripts/deploy-production.sh'),
    readText('.github/workflows/retail-web-ci.yml'),
    readText('.github/workflows/vercel-retail-production-manual.yml'),
    readText('retail/web/scripts/bootstrap-project.sh'),
  ]);

  assert.equal(rootPackage.engines?.node, '20.x');
  assert.equal(companyPackage.engines, undefined);

  for (const [label, source] of [
    ['Công Ty compatibility CI', companyCi],
    ['Công Ty production workflow', companyProduction],
    ['Delivery CI', deliveryCi],
    ['Delivery production workflow', deliveryProduction],
    ['Retail CI', retailCi],
    ['Retail production workflow', retailProduction],
  ]) {
    assert.match(source, /node-version:\s*24/, `${label} must use Node 24`);
  }

  assert.match(companyCi, /npm run verify:core-web/);
  assert.match(deliveryScript, /nodeVersion:"24\.x"/);
  assert.match(deliveryScript, /\.nodeVersion' "\$settings_json"\)" = '24\.x'/);
  assert.match(retailBootstrap, /nodeVersion:"24\.x"/);
  assert.match(retailBootstrap, /\.nodeVersion' "\$settings_json"\)" = '24\.x'/);

  for (const [label, source] of [
    ['Delivery CI', deliveryCi],
    ['Delivery production workflow', deliveryProduction],
    ['Delivery Vercel configuration', deliveryScript],
    ['Retail CI', retailCi],
    ['Retail production workflow', retailProduction],
    ['Retail Vercel configuration', retailBootstrap],
  ]) {
    assert.doesNotMatch(source, /node-version:\s*20|nodeVersion:"20\.x"/, `${label} must not pin Node 20`);
  }
});
