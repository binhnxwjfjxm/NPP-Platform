import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const canonical = fileURLToPath(new URL('../../../BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx', import.meta.url));
const venue = fileURLToPath(new URL('../../../BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx', import.meta.url));
const script = fileURLToPath(new URL('../scripts/audit-pricing-workbooks.py', import.meta.url));

function runAudit() {
  const commands = process.platform === 'win32'
    ? [['py', ['-3', script, canonical, venue]], ['python', [script, canonical, venue]]]
    : [['python3', [script, canonical, venue]], ['python', [script, canonical, venue]]];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (!result.error && result.status === 0) return JSON.parse(result.stdout);
    if (result.error?.code !== 'ENOENT') {
      assert.fail(`pricing workbook audit failed: ${result.stderr || result.error?.message}`);
    }
  }
  assert.fail('Python runtime is required for pricing workbook audit');
}

test('Pricing source workbooks — canonical and venue price counts stay review-gated', () => {
  const audit = runAudit();
  assert.equal(audit.canonical.masterRows, 606);
  assert.equal(audit.canonical.uniqueBaseSkus, 606);
  assert.equal(audit.canonical.uniqueCartonSkus, 606);
  assert.deepEqual(audit.canonical.duplicateBaseSkus, []);
  assert.deepEqual(audit.canonical.duplicateCartonSkus, []);
  assert.equal(audit.canonical.basePriceAfterUpdatePositive, 563);
  assert.equal(audit.canonical.basePriceAfterUpdateMissingOrZero, 43);
  assert.equal(audit.canonical.cartonNormalizedPricePositive, 563);
  assert.equal(audit.canonical.cartonRetailPricePositive, 168);
  assert.equal(audit.venueChannel.mappedRows, 343);
  assert.equal(audit.venueChannel.uniqueSkus, 342);
  assert.equal(audit.venueChannel.duplicateSkuRows, 1);
  assert.equal(audit.venueChannel.positivePriceRows, 338);
  assert.equal(audit.venueChannel.missingOrZeroPriceRows, 5);
  assert.equal(audit.venueChannel.reviewRequiredRows, 69);
  assert.equal(audit.rules.deriveCartonFromRetailTimesConversion, false);
  assert.equal(audit.rules.ambiguousRowsBlocked, true);
});
