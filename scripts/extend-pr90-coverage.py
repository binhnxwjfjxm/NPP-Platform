from pathlib import Path

path = Path('npp-core/api/test/supplier-return.test.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)


conversion_block = """    const conversionChange = await fetch(`${baseUrl}/api/products/${fixture.productId}/variants/${fixture.cartonVariantId}/unit`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `sr-carton-unit-change-${randomUUID()}`),
      body: JSON.stringify({
        unitId: fixture.cartonUnitId,
        conversionToBase: '24',
        expectedUpdatedAt: cartonVariant.updated_at,
      }),
    });
    assert.equal(conversionChange.status, 200);

"""
replace_once(conversion_block, '')

create_block = """    const createReturn = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-create-${randomUUID()}`),
      body: JSON.stringify({
        supplierId: fixture.supplierId,
        warehouseId: fixture.warehouseId,
        returnDate: '2026-07-29',
        note: 'SR-RETURN-1',
        lines: [{
          sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
          returnQuantity: '1',
          reasonCode: 'DAMAGED',
          reasonNote: 'Thùng bị móp',
          note: 'Dòng trả',
        }],
      }),
    });
    assert.equal(createReturn.status, 201);
    const draftReturn = await data(createReturn);
    assert.equal(draftReturn.status, 'draft');

"""
create_replacement = """    const overReturnResponse = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-over-return-${randomUUID()}`),
      body: JSON.stringify({
        supplierId: fixture.supplierId,
        warehouseId: fixture.warehouseId,
        returnDate: '2026-07-29',
        lines: [{
          sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
          returnQuantity: '3',
          reasonCode: 'DAMAGED',
          reasonNote: 'Vượt số lượng có thể trả',
        }],
      }),
    });
    assert.equal(overReturnResponse.status, 400);
    assert.equal(await errorCode(overReturnResponse), 'RETURN_QUANTITY_EXCEEDS_RETURNABLE');

    const createKey = `sr-create-${randomUUID()}`;
    const createPayload = {
      supplierId: fixture.supplierId,
      warehouseId: fixture.warehouseId,
      returnDate: '2026-07-29',
      note: 'SR-RETURN-1',
      lines: [{
        sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
        returnQuantity: '1',
        reasonCode: 'DAMAGED',
        reasonNote: 'Thùng bị móp',
        note: 'Dòng trả',
      }],
    };
    const createReturn = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, createKey),
      body: JSON.stringify(createPayload),
    });
    assert.equal(createReturn.status, 201);
    const draftReturn = await data(createReturn);
    assert.equal(draftReturn.status, 'draft');

    const createReplay = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, createKey),
      body: JSON.stringify(createPayload),
    });
    assert.equal(createReplay.status, 201);
    assert.equal((await data(createReplay)).id, draftReturn.id);

    const createMismatch = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, createKey),
      body: JSON.stringify({ ...createPayload, note: 'Payload khác' }),
    });
    assert.equal(createMismatch.status, 409);

    const conversionChange = await fetch(`${baseUrl}/api/products/${fixture.productId}/variants/${fixture.cartonVariantId}/unit`, {
      method: 'PATCH',
      headers: mutationHeaders(config, `sr-carton-unit-change-${randomUUID()}`),
      body: JSON.stringify({
        unitId: fixture.cartonUnitId,
        conversionToBase: '24',
        expectedUpdatedAt: cartonVariant.updated_at,
      }),
    });
    assert.equal(conversionChange.status, 200);

"""
replace_once(create_block, create_replacement)

approve_block = """    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/approve`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-approve-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: submittedReturn.revision }),
    });
    assert.equal(response.status, 200);
    const approvedReturn = await data(response);

"""
approve_replacement = """    const staleApprove = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/approve`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-approve-stale-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draftReturn.revision }),
    });
    assert.equal(staleApprove.status, 409);
    assert.equal(await errorCode(staleApprove), 'CONFLICT');

    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/approve`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-approve-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: submittedReturn.revision }),
    });
    assert.equal(response.status, 200);
    const approvedReturn = await data(response);

"""
replace_once(approve_block, approve_replacement)

post_block = """    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-post-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: approvedReturn.revision,
        reasonNote: 'Ghi sổ trả hàng NCC',
        documentDate: '2026-07-29',
      }),
    });
    assert.equal(response.status, 200);
    const postedReturn = await data(response);
"""
post_replacement = """    const postKey = `sr-post-${randomUUID()}`;
    const postPayload = {
      expectedRevision: approvedReturn.revision,
      reasonNote: 'Ghi sổ trả hàng NCC',
      documentDate: '2026-07-29',
    };
    response = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, postKey),
      body: JSON.stringify(postPayload),
    });
    assert.equal(response.status, 200);
    const postedReturn = await data(response);

    const postReplay = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, postKey),
      body: JSON.stringify(postPayload),
    });
    assert.equal(postReplay.status, 200);
    assert.equal((await data(postReplay)).id, postedReturn.id);

    const postMismatch = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, postKey),
      body: JSON.stringify({ ...postPayload, reasonNote: 'Payload ghi sổ khác' }),
    });
    assert.equal(postMismatch.status, 409);
"""
replace_once(post_block, post_replacement)

reverse_marker = """    const reversedReturn = await data(response);
    assert.equal(reversedReturn.status, 'reversed');

"""
reverse_replacement = """    const reversedReturn = await data(response);
    assert.equal(reversedReturn.status, 'reversed');

    const secondReverse = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-second-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: reversedReturn.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Không được đảo lần hai',
      }),
    });
    assert.equal(secondReverse.status, 409);
    assert.equal(await errorCode(secondReverse), 'SUPPLIER_RETURN_LOCKED');

"""
replace_once(reverse_marker, reverse_replacement)

before_gr_reverse = """    response = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-gr-reverse-${randomUUID()}`),
"""
concurrent_block = """    async function createApprovedConcurrentReturn(label) {
      const createdResponse = await fetch(`${baseUrl}/api/supplier-returns`, {
        method: 'POST',
        headers: mutationHeaders(config, `sr-concurrent-create-${label}-${randomUUID()}`),
        body: JSON.stringify({
          supplierId: fixture.supplierId,
          warehouseId: fixture.warehouseId,
          returnDate: '2026-07-29',
          note: `Concurrent ${label}`,
          lines: [{
            sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
            returnQuantity: '2',
            reasonCode: 'OTHER',
            reasonNote: `Concurrent return ${label}`,
          }],
        }),
      });
      assert.equal(createdResponse.status, 201);
      const created = await data(createdResponse);
      const submittedResponse = await fetch(`${baseUrl}/api/supplier-returns/${created.id}/submit`, {
        method: 'POST',
        headers: mutationHeaders(config, `sr-concurrent-submit-${label}-${randomUUID()}`),
        body: JSON.stringify({ expectedRevision: created.revision }),
      });
      assert.equal(submittedResponse.status, 200);
      const submitted = await data(submittedResponse);
      const approvedResponse = await fetch(`${baseUrl}/api/supplier-returns/${created.id}/approve`, {
        method: 'POST',
        headers: mutationHeaders(config, `sr-concurrent-approve-${label}-${randomUUID()}`),
        body: JSON.stringify({ expectedRevision: submitted.revision }),
      });
      assert.equal(approvedResponse.status, 200);
      return data(approvedResponse);
    }

    const approvedA = await createApprovedConcurrentReturn('A');
    const approvedB = await createApprovedConcurrentReturn('B');
    const [postA, postB] = await Promise.all([
      fetch(`${baseUrl}/api/supplier-returns/${approvedA.id}/post`, {
        method: 'POST',
        headers: mutationHeaders(config, `sr-concurrent-post-A-${randomUUID()}`),
        body: JSON.stringify({ expectedRevision: approvedA.revision, documentDate: '2026-07-29' }),
      }),
      fetch(`${baseUrl}/api/supplier-returns/${approvedB.id}/post`, {
        method: 'POST',
        headers: mutationHeaders(config, `sr-concurrent-post-B-${randomUUID()}`),
        body: JSON.stringify({ expectedRevision: approvedB.revision, documentDate: '2026-07-29' }),
      }),
    ]);
    const concurrentResponses = [postA, postB];
    const successfulPost = concurrentResponses.find((item) => item.status === 200);
    const rejectedPost = concurrentResponses.find((item) => item.status !== 200);
    assert.ok(successfulPost);
    assert.ok(rejectedPost);
    const concurrentPosted = await data(successfulPost);
    assert.equal(await errorCode(rejectedPost), 'RETURN_QUANTITY_EXCEEDS_RETURNABLE');

    const failedApproved = postA.status === 200 ? approvedB : approvedA;
    const movementCountBeforeCancel = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND source_document_id = $2`,
      [config.installationId, failedApproved.id],
    );
    assert.equal(movementCountBeforeCancel.rows[0].count, 0);
    const cancelResponse = await fetch(`${baseUrl}/api/supplier-returns/${failedApproved.id}/cancel`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-concurrent-cancel-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: failedApproved.revision, reason: 'Phiếu còn lại vượt số lượng có thể trả' }),
    });
    assert.equal(cancelResponse.status, 200);
    assert.equal((await data(cancelResponse)).status, 'cancelled');
    const movementCountAfterCancel = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND source_document_id = $2`,
      [config.installationId, failedApproved.id],
    );
    assert.equal(movementCountAfterCancel.rows[0].count, 0);

    const concurrentReverse = await fetch(`${baseUrl}/api/supplier-returns/${concurrentPosted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-concurrent-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: concurrentPosted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Hoàn tác concurrent post để tiếp tục kiểm thử',
      }),
    });
    assert.equal(concurrentReverse.status, 200);

    response = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-gr-reverse-${randomUUID()}`),
"""
replace_once(before_gr_reverse, concurrent_block)

path.write_text(text, encoding='utf-8', newline='\n')
