import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { PERMISSIONS, createBootstrapPrincipal, requirePermission } from '../src/request-context.js';
import { getPayableDocument, listPayableDocuments, listSupplierPayableBalances } from '../src/services/payable.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3082',
    INSTALLATION_ID: `payable-boundary-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: process.env.TEST_DATABASE_SSL_MODE || process.env.DATABASE_SSL_MODE || 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef', CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

function context(config, warehouseIds) {
  return {
    installationId: config.installationId,
    actorId: 'test:actor',
    employeeId: null,
    roles: ['test'],
    permissions: [PERMISSIONS.corePayableRead],
    scopes: { branchIds: [], warehouseIds, territoryIds: [] },
    requestId: `req_${randomUUID()}`,
    sourceApp: 'test',
    receivedAt: new Date().toISOString(),
  };
}

test('payable reads enforce permission, warehouse scope, installation isolation and append-only history', async () => {
  const config = testConfig();
  const pool = getPool(config);
  const branchId = randomUUID();
  const warehouseA = randomUUID();
  const warehouseB = randomUUID();
  const supplierId = randomUUID();
  const documentId = randomUUID();
  const ledgerId = randomUUID();
  const actor = 'test:fixture';
  try {
    const bootstrap = createBootstrapPrincipal(config);
    assert.equal(requirePermission({ permissions: [] }, PERMISSIONS.corePayableRead).ok, false);
    assert.equal(requirePermission(bootstrap, PERMISSIONS.corePayableRead).ok, true);

    await pool.query(
      `INSERT INTO shared.branches (id,installation_id,code,name,is_active,created_by,updated_by)
       VALUES ($1,$2,$3,$4,true,$5,$5)`,
      [branchId, config.installationId, `PB-${randomUUID().slice(0, 8)}`, 'Chi nhánh công nợ', actor],
    );
    await pool.query(
      `INSERT INTO shared.warehouses (id,installation_id,branch_id,code,name,warehouse_type,is_active,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6),($7,$2,$3,$8,$9,'main',true,$6,$6)`,
      [warehouseA, config.installationId, branchId, `PA-${randomUUID().slice(0, 8)}`, 'Kho A', actor, warehouseB, `PB-${randomUUID().slice(0, 8)}`, 'Kho B'],
    );
    await pool.query(
      `INSERT INTO shared.suppliers (id,installation_id,code,name,is_active,created_by,updated_by)
       VALUES ($1,$2,$3,$4,true,$5,$5)`,
      [supplierId, config.installationId, `PS-${randomUUID().slice(0, 8)}`, 'Nhà cung cấp phạm vi', actor],
    );
    await pool.query(
      `INSERT INTO accounting.payable_documents (
         id,installation_id,supplier_id,warehouse_id,direction,document_type,source_document_type,
         source_document_id,source_document_number,source_document_date,currency_code,payment_method_snapshot,
         payment_term_days_snapshot,due_date,original_amount,allocated_amount,remaining_amount,status,
         source_revision,posting_origin,posted_at,posted_by,created_at,updated_at,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,'DEBIT','GOODS_RECEIPT','GOODS_RECEIPT',$5,'GR-SCOPE-1','2026-07-30','VND','UNSPECIFIED',0,'2026-07-30',100,0,100,'open',1,'runtime',now(),$6,now(),now(),$6,$6)`,
      [documentId, config.installationId, supplierId, warehouseA, randomUUID(), actor],
    );
    await pool.query(
      `INSERT INTO accounting.payable_ledger_entries (
         id,installation_id,payable_document_id,supplier_id,currency_code,entry_type,amount,
         source_document_type,source_document_id,source_document_number,source_revision,
         document_status_after,actor_id,request_id,source_app,occurred_at,metadata
       ) SELECT $1,$2,$3,$4,'VND','GOODS_RECEIPT_POST',100,'GOODS_RECEIPT',source_document_id,
                source_document_number,1,'open',$5,$6,'test',now(),'{}'::jsonb
           FROM accounting.payable_documents WHERE installation_id=$2 AND id=$3`,
      [ledgerId, config.installationId, documentId, supplierId, actor, `req_${randomUUID()}`],
    );

    const emptyScope = await listPayableDocuments(pool, { requestContext: context(config, []), limit: 10, offset: 0 });
    assert.equal(emptyScope.ok, false);
    assert.equal(emptyScope.code, 'WAREHOUSE_SCOPE_DENIED');

    const scopedA = context(config, [warehouseA]);
    const scopedB = context(config, [warehouseB]);
    const balancesA = await listSupplierPayableBalances(pool, { requestContext: scopedA, limit: 10, offset: 0 });
    assert.equal(balancesA.ok, true);
    assert.equal(balancesA.balances.length, 1);
    assert.equal(balancesA.balances[0].balance, '100.000000');

    const balancesB = await listSupplierPayableBalances(pool, { requestContext: scopedB, limit: 10, offset: 0 });
    assert.equal(balancesB.ok, true);
    assert.equal(balancesB.balances.length, 0);

    const hiddenDetail = await getPayableDocument(pool, { requestContext: scopedB, id: documentId });
    assert.equal(hiddenDetail.ok, false);
    assert.equal(hiddenDetail.code, 'PAYABLE_DOCUMENT_NOT_FOUND');

    await assert.rejects(
      pool.query(`UPDATE accounting.payable_ledger_entries SET amount=999 WHERE installation_id=$1 AND id=$2`, [config.installationId, ledgerId]),
      /payable_history_is_append_only/,
    );

    await pool.query('SELECT accounting.rebuild_supplier_payable_balances()');
    const rebuilt = await pool.query(
      `SELECT balance::text FROM accounting.supplier_payable_balances
        WHERE installation_id=$1 AND supplier_id=$2 AND currency_code='VND'`,
      [config.installationId, supplierId],
    );
    assert.equal(rebuilt.rows[0].balance, '100.000000');

    const otherInstallation = { ...scopedA, installationId: `other-${randomUUID()}` };
    const isolated = await getPayableDocument(pool, { requestContext: otherInstallation, id: documentId });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'PAYABLE_DOCUMENT_NOT_FOUND');
  } finally {
    await closePool();
  }
});
