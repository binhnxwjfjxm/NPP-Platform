from pathlib import Path
from ftfy import fix_text


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    Path(path).write_text(value, encoding="utf-8", newline="\n")


def replace_required(value: str, old: str, new: str, label: str) -> str:
    if old not in value:
        raise SystemExit(f"missing target: {label}")
    return value.replace(old, new, 1)


ui_path = "npp-core/web/app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx"
ui = fix_text(read(ui_path))
ui = replace_required(
    ui,
    "    return `Ghi sổ ${identifier}? Hàng sẽ đi vào tồn kho ngay sau khi xác nhận.`;",
    "    return `Ghi sổ ${identifier}? Phần chấp nhận sẽ vào tồn kho; phần loại hoặc chốt thiếu chỉ được ghi nhận trên phiếu.`;",
    "post confirmation copy",
)
ui = ui.replace("<small>Đã vào tồn kho</small>", "<small>Đã ghi nhận nhập hàng và chênh lệch</small>")
ui = replace_required(
    ui,
    "        if (rejected > 0n && (!line.qualityReasonCode.trim() || !line.qualityNote.trim())) {\n          setError('Dòng có số lượng loại phải có lý do và ghi chú chất lượng.');",
    "        if ((rejected > 0n || line.finalizeLine) && (!line.qualityReasonCode.trim() || !line.qualityNote.trim())) {\n          setError('Dòng có hàng loại hoặc chốt thiếu phải có mã lý do và ghi chú chênh lệch.');",
    "variance reason validation",
)
ui = replace_required(
    ui,
    "              ...(decimalPositive(rejectedQuantity)\n                ? {",
    "              ...((decimalPositive(rejectedQuantity) || line.finalizeLine)\n                ? {",
    "variance reason payload",
)
ui = replace_required(
    ui,
    "                    const rejectedPositive = varianceAllowed && decimalPositive(line.rejectedQuantity);",
    "                    const rejectedPositive = varianceAllowed && decimalPositive(line.rejectedQuantity);\n                    const varianceReasonRequired = varianceAllowed && (rejectedPositive || line.finalizeLine);",
    "variance UI state",
)
ui = ui.replace("Lý do CL", "Lý do chênh lệch")
ui = ui.replace("Ghi chú CL", "Ghi chú chênh lệch")
ui = ui.replace(
    "disabled={editor.loading || !rejectedPositive}",
    "disabled={editor.loading || !varianceReasonRequired}",
)
ui = ui.replace(
    "placeholder={rejectedPositive ? 'VD: DAMAGED' : 'Chỉ mở khi có loại'}",
    "placeholder={varianceReasonRequired ? 'VD: DAMAGED hoặc SHORTAGE' : 'Chỉ mở khi có loại/chốt thiếu'}",
)
ui = ui.replace(
    "placeholder={rejectedPositive ? 'Ghi chú chất lượng' : 'Chỉ mở khi có loại'}",
    "placeholder={varianceReasonRequired ? 'Ghi chú chênh lệch' : 'Chỉ mở khi có loại/chốt thiếu'}",
)
bad_markers = ("KhÃ", "Ghi sá»", "Ä", "á»", "áº", "HÃ ng")
leftovers = [marker for marker in bad_markers if marker in ui]
if leftovers:
    raise SystemExit(f"UI still contains mojibake markers: {leftovers}")
write(ui_path, ui)

migration_path = "database/migrations/purchasing/023_goods_receipt_variance.sql"
migration = read(migration_path)
migration = replace_required(
    migration,
    "ALTER TABLE purchasing.goods_receipt_lines\n  DROP CONSTRAINT IF EXISTS goods_receipt_lines_conversion_check;",
    "ALTER TABLE purchasing.goods_receipt_lines\n  DROP CONSTRAINT IF EXISTS goods_receipt_lines_conversion_check,\n  DROP CONSTRAINT IF EXISTS goods_receipt_lines_base_quantity_check;\n\nALTER TABLE purchasing.goods_receipt_lines\n  ADD CONSTRAINT goods_receipt_lines_base_quantity_nonnegative_check CHECK (base_quantity >= 0);",
    "allow zero accepted base quantity",
)
write(migration_path, migration)

po_path = "npp-core/api/src/db/repositories/purchase-order.js"
po = read(po_path)
po = replace_required(
    po,
    "         - COALESCE(SUM(receipt_summary.accepted_quantity), 0::numeric)\n         - COALESCE(SUM(receipt_summary.rejected_quantity), 0::numeric)\n         - COALESCE(SUM(receipt_summary.shortage_closed_quantity), 0::numeric),",
    "         - COALESCE(SUM(receipt_summary.accepted_quantity), 0::numeric)\n         - COALESCE(SUM(receipt_summary.shortage_closed_quantity), 0::numeric),",
    "header remaining projection",
)
po = replace_required(
    po,
    "AND po.status IN ('approved', 'partially_received', 'fully_received')",
    "AND po.status IN ('approved', 'partially_received', 'fully_received', 'closed')",
    "closed PO reversal projection",
)
write(po_path, po)

test_path = "npp-core/api/test/goods-receipt.test.js"
tests = read(test_path)
tests = tests.replace(
    "assert.equal(await errorCode(response), 'INVALID_QUALITY_REASON_CODE');",
    "assert.equal(await errorCode(response), 'INVALID_VARIANCE_REASON_CODE');",
    1,
)
close_anchor = """    assert.equal(closedPo.shortageClosedQuantityTotal, '8.000000');
    assert.equal(closedPo.remainingQuantityTotal, '0.000000');"""
close_replacement = """    assert.equal(closedPo.shortageClosedQuantityTotal, '8.000000');
    assert.equal(closedPo.remainingQuantityTotal, '0.000000');

    const reverseResponse = await fetch(`${baseUrl}/api/goods-receipts/${posted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-close-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: posted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu chốt thiếu để kiểm tra phục hồi projection',
      }),
    });
    assert.equal(reverseResponse.status, 200);
    const reversed = await data(reverseResponse);
    assert.equal(reversed.status, 'reversed');

    const restoredResponse = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const restoredPo = await data(restoredResponse);
    assert.equal(restoredPo.status, 'approved');
    assert.equal(restoredPo.acceptedQuantityTotal, '0.000000');
    assert.equal(restoredPo.rejectedQuantityTotal, '0.000000');
    assert.equal(restoredPo.shortageClosedQuantityTotal, '0.000000');
    assert.equal(restoredPo.remainingQuantityTotal, '10.000000');"""
tests = replace_required(tests, close_anchor, close_replacement, "shortage reversal test")

rejected_test = """

test('Goods receipt can post and reverse a fully rejected delivery without inventory movement', async () => {
  const config = loadConfig(testEnv({ PORT: '3078', INSTALLATION_ID: `goods-receipt-rejected-${randomUUID()}` }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const approved = await createApprovedPo(baseUrl, config, fixture);

    let response = await fetch(`${baseUrl}/api/goods-receipts`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-rejected-${randomUUID()}`),
      body: JSON.stringify(receiptPayload(approved, fixture, '2', 'DELIVERY-REJECTED', {
        acceptedQuantity: '0',
        rejectedQuantity: '2',
        qualityReasonCode: 'DAMAGED',
        qualityNote: 'Toàn bộ hàng giao bị loại tại cửa nhận',
      })),
    });
    assert.equal(response.status, 201);
    const draft = await data(response);
    assert.equal(draft.lines[0].baseQuantity, '0.000000');

    response = await fetch(`${baseUrl}/api/goods-receipts/${draft.id}/post`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-rejected-post-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draft.revision }),
    });
    assert.equal(response.status, 200);
    const posted = await data(response);
    assert.equal(posted.inventoryMovementId, null);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const unchangedPo = await data(response);
    assert.equal(unchangedPo.status, 'approved');
    assert.equal(unchangedPo.acceptedQuantityTotal, '0.000000');
    assert.equal(unchangedPo.rejectedQuantityTotal, '2.000000');
    assert.equal(unchangedPo.remainingQuantityTotal, '10.000000');

    const movementCount = await pool.query(
      `SELECT count(*)::int AS count FROM inventory.inventory_movements
       WHERE installation_id = $1 AND source_document_id = $2`,
      [config.installationId, posted.id],
    );
    assert.equal(movementCount.rows[0].count, 0);

    response = await fetch(`${baseUrl}/api/goods-receipts/${posted.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `gr-rejected-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: posted.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Đảo phiếu toàn bộ bị loại',
      }),
    });
    assert.equal(response.status, 200);
    const reversed = await data(response);
    assert.equal(reversed.inventoryReversalMovementId, null);

    response = await fetch(`${baseUrl}/api/purchase-orders/${approved.id}`, { headers: readHeaders(config) });
    const restoredPo = await data(response);
    assert.equal(restoredPo.status, 'approved');
    assert.equal(restoredPo.rejectedQuantityTotal, '0.000000');
    assert.equal(restoredPo.remainingQuantityTotal, '10.000000');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
"""
permission_anchor = "test('Goods receipt variance requires explicit permission even when create is allowed'"
if rejected_test.strip() not in tests:
    tests = tests.replace(permission_anchor, rejected_test + "\n" + permission_anchor, 1)
write(test_path, tests)

e2e_path = "npp-core/web/e2e/goods-receipts.spec.ts"
e2e = read(e2e_path)
e2e = e2e.replace(
    "    await expect(detail).toContainText('6');\n    const receiptSummaryTable",
    "    await expect(detail).toContainText('11');\n    const receiptSummaryTable",
    1,
)
write(e2e_path, e2e)
