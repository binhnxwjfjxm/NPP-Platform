import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function testEnv() {
  return {
    NODE_ENV:'test',HOST:'127.0.0.1',PORT:'3082',
    INSTALLATION_ID:`supplier-payment-test-${randomUUID()}`,
    DATABASE_URL:process.env.TEST_DATABASE_URL||process.env.DATABASE_URL||'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE:process.env.TEST_DATABASE_SSL_MODE||process.env.DATABASE_SSL_MODE||'disable',
    BACKEND_API_TOKEN:'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID:'test:bootstrap',
    CORS_ORIGINS:'http://127.0.0.1:3003',
  };
}

function closeServer(server) { return new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve())); }
function headers(config,key) { return { Authorization:`Bearer ${config.backendApiToken}`,'Content-Type':'application/json','Idempotency-Key':key }; }
function readHeaders(config) { return { Authorization:`Bearer ${config.backendApiToken}` }; }
async function responseData(response) { return (await response.json()).data; }
async function errorCode(response) { return (await response.json()).error.code; }

async function seed(pool,installationId) {
  const actor='test:fixture';
  const code=randomUUID().slice(0,8).toUpperCase();
  const ids={
    branchId:randomUUID(),warehouseId:randomUUID(),otherWarehouseId:randomUUID(),
    supplierId:randomUUID(),debitId:randomUUID(),debitSourceId:randomUUID(),
  };
  await pool.query(
    `INSERT INTO shared.branches(id,installation_id,code,name,is_active,created_by,updated_by)
     VALUES($1,$2,$3,$4,true,$5,$5)`,
    [ids.branchId,installationId,`BR-${code}`,`Chi nhánh ${code}`,actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses(id,installation_id,branch_id,code,name,warehouse_type,is_active,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,'main',true,$6,$6),($7,$2,$3,$8,$9,'main',true,$6,$6)`,
    [ids.warehouseId,installationId,ids.branchId,`WH-${code}`,`Kho ${code}`,actor,
      ids.otherWarehouseId,`WHX-${code}`,`Kho khác ${code}`],
  );
  await pool.query(
    `INSERT INTO shared.suppliers(id,installation_id,code,name,is_active,created_by,updated_by)
     VALUES($1,$2,$3,$4,true,$5,$5)`,
    [ids.supplierId,installationId,`SUP-${code}`,`Nhà cung cấp ${code}`,actor],
  );
  const series=await pool.query(
    `SELECT code,document_type FROM shared.document_number_series
      WHERE installation_id=$1 AND code='SUPPLIER_PAYMENT'`,
    [installationId],
  );
  assert.equal(series.rowCount,1);
  assert.equal(series.rows[0].document_type,'SUPPLIER_PAYMENT');

  await pool.query(
    `INSERT INTO accounting.payable_documents(
       id,installation_id,supplier_id,warehouse_id,direction,document_type,source_domain,
       source_document_type,source_document_id,source_document_number,source_document_date,
       currency_code,payment_method_snapshot,payment_term_days_snapshot,due_date,
       original_amount,allocated_amount,remaining_amount,status,source_revision,posting_origin,
       posted_at,posted_by,revision,created_by,updated_by
     ) VALUES($1,$2,$3,$4,'DEBIT','GOODS_RECEIPT','PURCHASING','GOODS_RECEIPT',$5,$6,
       '2026-07-30','VND','UNSPECIFIED',0,'2026-07-30',100000,0,100000,'open',1,'runtime',now(),$7,1,$7,$7)`,
    [ids.debitId,installationId,ids.supplierId,ids.warehouseId,ids.debitSourceId,`GR-${code}`,actor],
  );
  await pool.query(
    `INSERT INTO accounting.payable_ledger_entries(
       id,installation_id,payable_document_id,supplier_id,currency_code,entry_type,amount,
       source_document_type,source_document_id,source_document_number,source_revision,
       document_status_after,actor_id,request_id,source_app,occurred_at,metadata
     ) VALUES($1,$2,$3,$4,'VND','GOODS_RECEIPT_POST',100000,'GOODS_RECEIPT',$5,$6,1,
       'open',$7,$8,'test',now(),'{}'::jsonb)`,
    [randomUUID(),installationId,ids.debitId,ids.supplierId,ids.debitSourceId,`GR-${code}`,actor,`seed-${code}`],
  );
  return ids;
}

function paymentPayload(fixture,amount='60000',currencyCode='VND') {
  return {
    supplierId:fixture.supplierId,warehouseId:fixture.warehouseId,paymentDate:'2026-07-30',
    currencyCode,paymentMethod:'BANK_TRANSFER',amount,
    externalReference:`BANK-${randomUUID()}`,note:'Thanh toán kiểm thử Phase 5.6',
  };
}

async function createPayment(baseUrl,config,fixture,key,amount='60000',currencyCode='VND') {
  return fetch(`${baseUrl}/api/supplier-payments`,{
    method:'POST',headers:headers(config,key),body:JSON.stringify(paymentPayload(fixture,amount,currencyCode)),
  });
}

async function allocate(baseUrl,config,sourceId,targetId,amount,key) {
  return fetch(`${baseUrl}/api/payable-allocations`,{
    method:'POST',headers:headers(config,key),
    body:JSON.stringify({ sourcePayableDocumentId:sourceId,targetPayableDocumentId:targetId,amount,allocationDate:'2026-07-30' }),
  });
}

async function documentProjection(pool,installationId,ids) {
  const result=await pool.query(
    `SELECT id,status,allocated_amount::text,remaining_amount::text
       FROM accounting.payable_documents
      WHERE installation_id=$1 AND id=ANY($2::uuid[])`,
    [installationId,ids],
  );
  return new Map(result.rows.map((row)=>[row.id,row]));
}

async function supplierBalance(pool,installationId,supplierId,currencyCode='VND') {
  const result=await pool.query(
    `SELECT balance::text FROM accounting.supplier_payable_balances
      WHERE installation_id=$1 AND supplier_id=$2 AND currency_code=$3`,
    [installationId,supplierId,currencyCode],
  );
  return result.rows[0]?.balance ?? null;
}

test('Phase 5.6 posts, allocates and reverses immutable supplier payment facts',async()=>{
  const config=loadConfig(testEnv());
  const pool=getPool(config);
  let server;
  try {
    const fixture=await seed(pool,config.installationId);
    server=await startServer({ config });
    const baseUrl=`http://${config.host}:${config.port}`;

    const paymentKey=`payment-${randomUUID()}`;
    const payload=paymentPayload(fixture);
    let response=await fetch(`${baseUrl}/api/supplier-payments`,{
      method:'POST',headers:headers(config,paymentKey),body:JSON.stringify(payload),
    });
    assert.equal(response.status,201);
    const payment=await responseData(response);
    assert.equal(payment.documentType,'SUPPLIER_PAYMENT');
    assert.equal(payment.originalAmount,'60000.000000');
    assert.equal(payment.remainingAmount,'60000.000000');
    assert.match(payment.documentNumber,/^SP-202607-\d{6}$/);
    assert.equal(await supplierBalance(pool,config.installationId,fixture.supplierId),'40000.000000');

    response=await fetch(`${baseUrl}/api/supplier-payments`,{
      method:'POST',headers:headers(config,paymentKey),body:JSON.stringify(payload),
    });
    assert.equal(response.status,201);
    assert.equal((await responseData(response)).id,payment.id);

    response=await fetch(`${baseUrl}/api/supplier-payments`,{
      method:'POST',headers:headers(config,paymentKey),body:JSON.stringify({ ...payload,amount:'61000' }),
    });
    assert.equal(response.status,409);

    response=await allocate(baseUrl,config,payment.id,fixture.debitId,'50000',`allocation-${randomUUID()}`);
    assert.equal(response.status,201);
    const allocation=await responseData(response);
    assert.equal(allocation.amount,'50000.000000');
    assert.equal(allocation.reversed,false);
    assert.equal(await supplierBalance(pool,config.installationId,fixture.supplierId),'40000.000000');

    let byId=await documentProjection(pool,config.installationId,[payment.id,fixture.debitId]);
    assert.equal(byId.get(payment.id).allocated_amount,'50000.000000');
    assert.equal(byId.get(payment.id).remaining_amount,'10000.000000');
    assert.equal(byId.get(fixture.debitId).remaining_amount,'50000.000000');

    response=await allocate(baseUrl,config,payment.id,fixture.debitId,'11000',`over-${randomUUID()}`);
    assert.equal(response.status,409);
    assert.equal(await errorCode(response),'ALLOCATION_EXCEEDS_SOURCE');
    const afterFailedAllocation=await documentProjection(pool,config.installationId,[payment.id,fixture.debitId]);
    assert.deepEqual(afterFailedAllocation,byId);
    const allocationCount=await pool.query(
      `SELECT count(*)::int AS count FROM accounting.payable_allocations
        WHERE installation_id=$1 AND source_payable_document_id=$2`,
      [config.installationId,payment.id],
    );
    assert.equal(allocationCount.rows[0].count,1);

    response=await fetch(`${baseUrl}/api/supplier-payments/${payment.id}/reverse`,{
      method:'POST',headers:headers(config,`reverse-blocked-${randomUUID()}`),
      body:JSON.stringify({ reason:'Không được đảo khi còn phân bổ' }),
    });
    assert.equal(response.status,409);
    assert.equal(await errorCode(response),'PAYMENT_ALLOCATION_EXISTS');

    response=await fetch(`${baseUrl}/api/payable-allocations/${allocation.id}/reverse`,{
      method:'POST',headers:headers(config,`allocation-no-reason-${randomUUID()}`),body:JSON.stringify({}),
    });
    assert.equal(response.status,400);
    assert.equal(await errorCode(response),'ALLOCATION_REVERSAL_REASON_REQUIRED');

    const allocationReverseKey=`allocation-reverse-${randomUUID()}`;
    const allocationReversePayload={ reason:'Đảo phân bổ kiểm thử' };
    response=await fetch(`${baseUrl}/api/payable-allocations/${allocation.id}/reverse`,{
      method:'POST',headers:headers(config,allocationReverseKey),body:JSON.stringify(allocationReversePayload),
    });
    assert.equal(response.status,200);
    const reversedAllocation=await responseData(response);
    assert.equal(reversedAllocation.reversed,true);
    assert.equal(await supplierBalance(pool,config.installationId,fixture.supplierId),'40000.000000');

    response=await fetch(`${baseUrl}/api/payable-allocations/${allocation.id}/reverse`,{
      method:'POST',headers:headers(config,allocationReverseKey),body:JSON.stringify(allocationReversePayload),
    });
    assert.equal(response.status,200);
    assert.equal((await responseData(response)).reversalId,reversedAllocation.reversalId);
    response=await fetch(`${baseUrl}/api/payable-allocations/${allocation.id}/reverse`,{
      method:'POST',headers:headers(config,allocationReverseKey),body:JSON.stringify({ reason:'Lý do khác' }),
    });
    assert.equal(response.status,409);

    await assert.rejects(
      pool.query(
        `UPDATE accounting.payable_allocation_reversals SET reason='changed'
          WHERE installation_id=$1 AND allocation_id=$2`,
        [config.installationId,allocation.id],
      ),
      /payable_allocation_history_is_append_only/,
    );

    response=await fetch(`${baseUrl}/api/supplier-payments/${payment.id}/reverse`,{
      method:'POST',headers:headers(config,`payment-no-reason-${randomUUID()}`),body:JSON.stringify({}),
    });
    assert.equal(response.status,400);
    assert.equal(await errorCode(response),'PAYMENT_REVERSAL_REASON_REQUIRED');

    const paymentReverseKey=`payment-reverse-${randomUUID()}`;
    const paymentReversePayload={ reason:'Đảo thanh toán kiểm thử' };
    response=await fetch(`${baseUrl}/api/supplier-payments/${payment.id}/reverse`,{
      method:'POST',headers:headers(config,paymentReverseKey),body:JSON.stringify(paymentReversePayload),
    });
    assert.equal(response.status,200);
    const reversedPayment=await responseData(response);
    assert.equal(reversedPayment.status,'reversed');
    assert.equal(await supplierBalance(pool,config.installationId,fixture.supplierId),'100000.000000');

    response=await fetch(`${baseUrl}/api/supplier-payments/${payment.id}/reverse`,{
      method:'POST',headers:headers(config,paymentReverseKey),body:JSON.stringify(paymentReversePayload),
    });
    assert.equal(response.status,200);
    assert.equal((await responseData(response)).reversedAt,reversedPayment.reversedAt);
    response=await fetch(`${baseUrl}/api/supplier-payments/${payment.id}/reverse`,{
      method:'POST',headers:headers(config,paymentReverseKey),body:JSON.stringify({ reason:'Lý do đảo khác' }),
    });
    assert.equal(response.status,409);

    const creditId=randomUUID();
    const creditSourceId=randomUUID();
    await pool.query(
      `INSERT INTO accounting.payable_documents(
         id,installation_id,supplier_id,warehouse_id,direction,document_type,source_domain,
         source_document_type,source_document_id,source_document_number,source_document_date,
         currency_code,payment_method_snapshot,payment_term_days_snapshot,due_date,
         original_amount,allocated_amount,remaining_amount,status,source_revision,posting_origin,
         posted_at,posted_by,revision,created_by,updated_by
       ) VALUES($1,$2,$3,$4,'CREDIT','SUPPLIER_RETURN_CREDIT','PURCHASING','SUPPLIER_RETURN',$5,
         'SR-CREDIT','2026-07-30','VND','CREDIT_NOTE',0,'2026-07-30',30000,0,30000,'open',1,
         'runtime',now(),'test:fixture',1,'test:fixture','test:fixture')`,
      [creditId,config.installationId,fixture.supplierId,fixture.warehouseId,creditSourceId],
    );
    await pool.query(
      `INSERT INTO accounting.payable_ledger_entries(
         id,installation_id,payable_document_id,supplier_id,currency_code,entry_type,amount,
         source_document_type,source_document_id,source_document_number,source_revision,
         document_status_after,actor_id,request_id,source_app,occurred_at,metadata
       ) VALUES($1,$2,$3,$4,'VND','SUPPLIER_RETURN_POST',-30000,'SUPPLIER_RETURN',$5,'SR-CREDIT',1,
         'open','test:fixture',$6,'test',now(),'{}'::jsonb)`,
      [randomUUID(),config.installationId,creditId,fixture.supplierId,creditSourceId,`credit-${randomUUID()}`],
    );
    response=await allocate(baseUrl,config,creditId,fixture.debitId,'30000',`credit-allocation-${randomUUID()}`);
    assert.equal(response.status,201);
    const creditAllocation=await responseData(response);
    await assert.rejects(
      pool.query(
        `UPDATE accounting.payable_documents
            SET status='reversed',remaining_amount=0,reversed_at=now(),reversed_by='test',reversal_reason='blocked'
          WHERE installation_id=$1 AND id=$2`,
        [config.installationId,creditId],
      ),
      /payable_allocation_exists/,
    );
    await assert.rejects(
      pool.query(`UPDATE accounting.payable_allocations SET amount=1 WHERE installation_id=$1 AND id=$2`,[config.installationId,creditAllocation.id]),
      /payable_allocation_history_is_append_only/,
    );

    const usdResponse=await createPayment(baseUrl,config,fixture,`currency-${randomUUID()}`,'1000','USD');
    assert.equal(usdResponse.status,201);
    const usdPayment=await responseData(usdResponse);
    response=await allocate(baseUrl,config,usdPayment.id,fixture.debitId,'1000',`currency-allocation-${randomUUID()}`);
    assert.equal(response.status,409);
    assert.equal(await errorCode(response),'ALLOCATION_CURRENCY_MISMATCH');

    const paymentAResponse=await createPayment(baseUrl,config,fixture,`concurrent-a-${randomUUID()}`,'50000');
    const paymentBResponse=await createPayment(baseUrl,config,fixture,`concurrent-b-${randomUUID()}`,'50000');
    assert.equal(paymentAResponse.status,201);
    assert.equal(paymentBResponse.status,201);
    const paymentA=await responseData(paymentAResponse);
    const paymentB=await responseData(paymentBResponse);
    const concurrent=await Promise.all([
      allocate(baseUrl,config,paymentA.id,fixture.debitId,'50000',`concurrent-allocate-a-${randomUUID()}`),
      allocate(baseUrl,config,paymentB.id,fixture.debitId,'50000',`concurrent-allocate-b-${randomUUID()}`),
    ]);
    assert.deepEqual(concurrent.map((item)=>item.status).sort(),[201,409]);

    const beforeRebuild=await supplierBalance(pool,config.installationId,fixture.supplierId);
    await pool.query('SELECT accounting.rebuild_supplier_payable_balances()');
    const afterRebuild=await supplierBalance(pool,config.installationId,fixture.supplierId);
    assert.equal(afterRebuild,beforeRebuild);

    response=await fetch(`${baseUrl}/api/supplier-payments/${paymentA.id}`,{ headers:readHeaders(config) });
    assert.equal(response.status,200);
    assert.ok((await responseData(response)).ledgerEntries.length>=1);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
