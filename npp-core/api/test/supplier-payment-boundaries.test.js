import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { PERMISSIONS, createBootstrapPrincipal, requirePermission } from '../src/request-context.js';
import { createSupplierPayment, listSupplierPayments } from '../src/services/supplier-payment.js';

function config() {
  return loadConfig({
    NODE_ENV:'test',HOST:'127.0.0.1',PORT:'3083',
    INSTALLATION_ID:`supplier-payment-boundary-${randomUUID()}`,
    DATABASE_URL:process.env.TEST_DATABASE_URL||process.env.DATABASE_URL||'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE:process.env.TEST_DATABASE_SSL_MODE||process.env.DATABASE_SSL_MODE||'disable',
    BACKEND_API_TOKEN:'test-token-0123456789abcdef',CORE_BOOTSTRAP_ACTOR_ID:'test:bootstrap',
    CORS_ORIGINS:'http://127.0.0.1:3003',
  });
}

function context(appConfig,warehouseIds) {
  return {
    installationId:appConfig.installationId,actorId:'test:actor',employeeId:null,roles:['test'],
    permissions:[
      PERMISSIONS.coreSupplierPaymentRead,PERMISSIONS.coreSupplierPaymentCreate,
      PERMISSIONS.coreSupplierPaymentReverse,PERMISSIONS.corePayableAllocationCreate,
      PERMISSIONS.corePayableAllocationReverse,
    ],
    scopes:{ branchIds:[],warehouseIds,territoryIds:[] },
    requestId:`req_${randomUUID()}`,sourceApp:'test',receivedAt:new Date().toISOString(),
  };
}

test('supplier payment permissions deny by default and reads stay installation/warehouse scoped',async()=>{
  const appConfig=config();
  const pool=getPool(appConfig);
  const actor='test:fixture';
  const code=randomUUID().slice(0,8).toUpperCase();
  const branchId=randomUUID();
  const warehouseA=randomUUID();
  const warehouseB=randomUUID();
  const supplierId=randomUUID();
  try {
    const bootstrap=createBootstrapPrincipal(appConfig);
    for (const permission of [
      PERMISSIONS.coreSupplierPaymentRead,PERMISSIONS.coreSupplierPaymentCreate,
      PERMISSIONS.coreSupplierPaymentReverse,PERMISSIONS.corePayableAllocationCreate,
      PERMISSIONS.corePayableAllocationReverse,
    ]) {
      assert.equal(requirePermission({ permissions:[] },permission).ok,false);
      assert.equal(requirePermission(bootstrap,permission).ok,true);
    }

    await pool.query(
      `INSERT INTO shared.branches(id,installation_id,code,name,is_active,created_by,updated_by)
       VALUES($1,$2,$3,$4,true,$5,$5)`,
      [branchId,appConfig.installationId,`BR-${code}`,`Chi nhánh ${code}`,actor],
    );
    await pool.query(
      `INSERT INTO shared.warehouses(id,installation_id,branch_id,code,name,warehouse_type,is_active,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,'main',true,$6,$6),($7,$2,$3,$8,$9,'main',true,$6,$6)`,
      [warehouseA,appConfig.installationId,branchId,`WA-${code}`,`Kho A ${code}`,actor,
        warehouseB,`WB-${code}`,`Kho B ${code}`],
    );
    await pool.query(
      `INSERT INTO shared.suppliers(id,installation_id,code,name,is_active,created_by,updated_by)
       VALUES($1,$2,$3,$4,true,$5,$5)`,
      [supplierId,appConfig.installationId,`SUP-${code}`,`Nhà cung cấp ${code}`,actor],
    );

    const scopedA=context(appConfig,[warehouseA]);
    const denied=await createSupplierPayment(pool,{
      requestContext:scopedA,idempotencyKey:`deny-${randomUUID()}`,
      payload:{ supplierId,warehouseId:warehouseB,paymentDate:'2026-07-30',currencyCode:'VND',paymentMethod:'BANK_TRANSFER',amount:'100' },
    });
    assert.equal(denied.ok,false);
    assert.equal(denied.code,'WAREHOUSE_SCOPE_DENIED');

    const created=await createSupplierPayment(pool,{
      requestContext:scopedA,idempotencyKey:`create-${randomUUID()}`,
      payload:{ supplierId,warehouseId:warehouseA,paymentDate:'2026-07-30',currencyCode:'VND',paymentMethod:'BANK_TRANSFER',amount:'100' },
    });
    assert.equal(created.ok,true);

    const visible=await listSupplierPayments(pool,{ requestContext:scopedA,limit:10,offset:0 });
    assert.equal(visible.ok,true);
    assert.equal(visible.supplierPayments.length,1);

    const hidden=await listSupplierPayments(pool,{ requestContext:context(appConfig,[warehouseB]),limit:10,offset:0 });
    assert.equal(hidden.ok,true);
    assert.equal(hidden.supplierPayments.length,0);

    const otherInstallation={ ...scopedA,installationId:`other-${randomUUID()}` };
    const isolated=await listSupplierPayments(pool,{ requestContext:otherInstallation,limit:10,offset:0 });
    assert.equal(isolated.ok,true);
    assert.equal(isolated.supplierPayments.length,0);
  } finally {
    await closePool();
  }
});
