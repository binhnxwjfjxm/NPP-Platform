from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8', newline='\n')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def replace_in_section(path: str, start_marker: str, end_marker: str, old: str, new: str) -> None:
    text = read(path)
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    section = text[start:end]
    count = section.count(old)
    if count != 1:
        raise SystemExit(f'{path}: section expected one match, found {count}: {old[:120]!r}')
    write(path, text[:start] + section.replace(old, new, 1) + text[end:])


# Lock the parent document while checking whether return lines remain editable.
replace_once(
    'database/migrations/purchasing/024_supplier_return.sql',
    """  SELECT status INTO current_status
  FROM purchasing.supplier_returns
  WHERE installation_id = target_installation AND id = target_return;
""",
    """  SELECT status INTO current_status
  FROM purchasing.supplier_returns
  WHERE installation_id = target_installation AND id = target_return
  FOR NO KEY UPDATE;
""",
)

# Do not disable unrelated triggers or fabricate historical quality reasons.
write(
    'database/migrations/purchasing/026_goods_receipt_variance_remaining_fix.sql',
    """-- Phase 5.3 follow-up: keep goods receipt remaining quantity projection based on accepted quantity.
-- Only the draft-line immutability trigger is suspended for the deterministic backfill.

ALTER TABLE purchasing.goods_receipt_lines DISABLE TRIGGER goods_receipt_lines_draft_only;

ALTER TABLE purchasing.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_variance_check;

UPDATE purchasing.goods_receipt_lines
SET remaining_quantity_after = GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0)
WHERE remaining_quantity_after IS DISTINCT FROM GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM purchasing.goods_receipt_lines
     WHERE (rejected_quantity > 0 OR shortage_closed_quantity > 0)
       AND (
         quality_reason_code IS NULL
         OR quality_note IS NULL
         OR char_length(btrim(quality_reason_code)) NOT BETWEEN 1 AND 64
         OR char_length(btrim(quality_note)) NOT BETWEEN 1 AND 2000
       )
  ) THEN
    RAISE EXCEPTION 'goods_receipt_variance_reason_remediation_required';
  END IF;
END;
$$;

ALTER TABLE purchasing.goods_receipt_lines
  ADD CONSTRAINT goods_receipt_lines_variance_check CHECK (
    received_quantity = accepted_quantity + rejected_quantity
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND shortage_closed_quantity >= 0
    AND (
      (shortage_closed_quantity = 0 AND finalize_line = false)
      OR (
        finalize_line = true
        AND shortage_closed_quantity = GREATEST(remaining_quantity_before - accepted_quantity, 0)
      )
    )
    AND (
      (rejected_quantity = 0 AND shortage_closed_quantity = 0)
      OR (
        quality_reason_code IS NOT NULL
        AND quality_note IS NOT NULL
        AND char_length(btrim(quality_reason_code)) BETWEEN 1 AND 64
        AND char_length(btrim(quality_note)) BETWEEN 1 AND 2000
      )
    )
    AND base_quantity = round(accepted_quantity * conversion_to_base, 6)
    AND remaining_quantity_after = GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0)
  );

ALTER TABLE purchasing.goods_receipt_lines ENABLE TRIGGER goods_receipt_lines_draft_only;
""",
)

service = 'npp-core/api/src/services/supplier-return.js'
replace_once(
    service,
    """function validateListInput(input) {
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  if (input.status && !RETURN_STATUSES.has(input.status)) return failure('INVALID_STATUS', 'Supplier return status is invalid');
  if (input.supplierId && !isUuid(input.supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID is invalid');
  if (input.warehouseId && !isUuid(input.warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID is invalid');
  if (input.warehouseId && !warehouseAllowed(input.requestContext, input.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  return { ok: true, search };
}
""",
    """function validateListInput(input) {
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  if (input.status && !RETURN_STATUSES.has(input.status)) return failure('INVALID_STATUS', 'Supplier return status is invalid');
  if (input.supplierId && !isUuid(input.supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID is invalid');
  if (input.warehouseId && !isUuid(input.warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID is invalid');
  if (input.warehouseId && !warehouseAllowed(input.requestContext, input.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const requestedLimit = Number(input.limit ?? 100);
  const requestedOffset = Number(input.offset ?? 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return failure('INVALID_PAGINATION', 'limit must be a positive integer');
  }
  if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
    return failure('INVALID_PAGINATION', 'offset must be a non-negative integer');
  }
  return {
    ok: true,
    search,
    limit: Math.min(requestedLimit, 200),
    offset: Math.min(requestedOffset, 100000),
  };
}
""",
)
replace_once(
    service,
    """  const supplierReturns = await repository.listSupplierReturns(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: warehouseScopeIds(input.requestContext),
    supplierId: input.supplierId || null,
    status: input.status || null,
    search: validation.search,
    limit: input.limit,
    offset: input.offset,
  });
""",
    """  const supplierReturns = await repository.listSupplierReturns(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: input.warehouseId ? [input.warehouseId.trim()] : warehouseScopeIds(input.requestContext),
    supplierId: input.supplierId || null,
    status: input.status || null,
    search: validation.search,
    limit: validation.limit,
    offset: validation.offset,
  });
""",
)
replace_in_section(
    service,
    'export async function submitSupplierReturn',
    'export async function approveSupplierReturn',
    """  const validation = await validateLines(client, {
""",
    """  const lockResult = await lockSourceReceiptLines(client, requestContext, current.raw.lines ?? []);
  if (!lockResult.ok) return lockResult;
  const validation = await validateLines(client, {
""",
)
replace_in_section(
    service,
    'export async function postSupplierReturn',
    'export async function reverseSupplierReturn',
    "movementType: 'SUPPLIER_RETURN',",
    "movementType: 'SUPPLIER_RETURN_ISSUE',",
)
replace_in_section(
    service,
    'export async function postSupplierReturn',
    'export async function reverseSupplierReturn',
    "reasonCode: 'SUPPLIER_RETURN',",
    "reasonCode: 'SUPPLIER_RETURN_ISSUE',",
)
replace_in_section(
    service,
    'export async function postSupplierReturn',
    'export async function reverseSupplierReturn',
    "reasonNote: current.raw.note ?? 'Supplier return posted',",
    "reasonNote: lineRows.map((line) => `${line.reason_code}: ${line.reason_note}`).join('; ').slice(0, 2000),",
)

# Convert expected negative-stock rejection into a stable business response.
replace_once(
    'npp-core/api/src/routes/supplier-returns.js',
    """  } catch {
    sendError(
      res,
      apiError('SUPPLIER_RETURN_TRANSACTION_FAILED', 'Supplier return transaction failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}
""",
    """  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('inventory_negative_stock_denied')) {
      sendError(
        res,
        apiError('INSUFFICIENT_STOCK', 'Insufficient unreserved stock for the supplier return', {}, false, 409),
        options.requestId,
        options.receivedAt,
      );
      return;
    }
    sendError(
      res,
      apiError('SUPPLIER_RETURN_TRANSACTION_FAILED', 'Supplier return transaction failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}
""",
)

workspace = 'npp-core/web/app/purchasing/supplier-returns/SupplierReturnWorkspace.tsx'
replace_once(
    workspace,
    "returnQuantity: line.returnableQuantity ?? line.sourceAcceptedQuantity,",
    "returnQuantity: '',",
)
replace_once(
    workspace,
    """    const targetReceipt = receiptId
      ? initialGoodsReceipts.find((receipt) => receipt.id === receiptId) ?? firstReceipt
      : firstReceipt;
""",
    """    let targetReceipt = firstReceipt;
    if (receiptId) {
      const matchedReceipt = initialGoodsReceipts.find((receipt) => receipt.id === receiptId);
      if (!matchedReceipt) {
        setError('Không tìm thấy phiếu nhận hàng nguồn được yêu cầu trong phạm vi truy cập.');
        return;
      }
      targetReceipt = matchedReceipt;
    }
""",
)
replace_once(
    workspace,
    """    const sourceLinesResult = sourceLines.length > 0 ? sourceLines : null;
    if (!sourceLinesResult) {
      setError('Chưa có dòng nguồn để tạo phiếu trả.');
      return;
    }
    const supplierId = sourceLinesResult[0]?.sourceSupplierId ?? '';
    const warehouseId = sourceLinesResult[0]?.sourceWarehouseId ?? '';
    for (const line of editor.lines) {
      if (!line.sourceGoodsReceiptLineId) {
        setError('Vui lòng chọn đúng dòng phiếu nhận hàng cho từng mặt hàng.');
        return;
      }
      const quantity = Number(normalizeDecimalInput(line.returnQuantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError('Vui lòng nhập số lượng trả hợp lệ cho ít nhất một dòng.');
        return;
      }
      if (!line.reasonCode.trim() || !line.reasonNote.trim()) {
        setError('Mỗi dòng trả phải có mã lý do và ghi chú lý do.');
        return;
      }
    }
""",
    """    const sourceLinesResult = sourceLines.length > 0 ? sourceLines : null;
    if (!sourceLinesResult) {
      setError('Chưa có dòng nguồn để tạo phiếu trả.');
      return;
    }
    const supplierId = sourceLinesResult[0]?.sourceSupplierId ?? '';
    const warehouseId = sourceLinesResult[0]?.sourceWarehouseId ?? '';
    const selectedLines = editor.lines.filter((line) => {
      const quantity = Number(normalizeDecimalInput(line.returnQuantity));
      return Number.isFinite(quantity) && quantity > 0;
    });
    if (selectedLines.length === 0) {
      setError('Vui lòng nhập số lượng trả hợp lệ cho ít nhất một dòng.');
      return;
    }
    for (const line of selectedLines) {
      if (!line.sourceGoodsReceiptLineId) {
        setError('Vui lòng chọn đúng dòng phiếu nhận hàng cho từng mặt hàng.');
        return;
      }
      const quantity = Number(normalizeDecimalInput(line.returnQuantity));
      const returnable = Number(line.returnableQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(returnable) || quantity > returnable) {
        setError('Số lượng trả phải lớn hơn 0 và không vượt quá số lượng còn có thể trả.');
        return;
      }
      if (!line.reasonCode.trim() || !line.reasonNote.trim()) {
        setError('Mỗi dòng được chọn phải có mã lý do và ghi chú lý do.');
        return;
      }
    }
""",
)
replace_once(
    workspace,
    """        lines: editor.lines.map((line) => ({
""",
    """        lines: selectedLines.map((line) => ({
""",
)
replace_once(
    workspace,
    """    if (action === 'cancel' && !cancellationReason.trim()) {
      setError('Vui lòng nhập lý do hủy phiếu.');
      return;
    }
""",
    """    if (action === 'cancel' && !cancellationReason.trim()) {
      setError('Vui lòng nhập lý do hủy phiếu.');
      return;
    }
    if (action === 'reverse' && !reverseReason.trim()) {
      setError('Vui lòng nhập lý do đảo phiếu.');
      return;
    }
""",
)
replace_once(
    workspace,
    "reasonNote: reverseReason.trim() || supplierReturn.note?.trim() || 'Đảo phiếu',",
    "reasonNote: reverseReason.trim(),",
)
replace_once(
    workspace,
    '<input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} />',
    '<input data-testid="supplier-return-reverse-reason" value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} />',
)

replace_once(
    'npp-core/web/e2e/supplier-returns.spec.ts',
    """    await row.getByRole('button', { name: 'Đảo phiếu', exact: true }).click();
    await page.getByTestId('supplier-return-reverse-confirm').click();
""",
    """    await row.getByRole('button', { name: 'Đảo phiếu', exact: true }).click();
    await page.getByTestId('supplier-return-reverse-reason').fill('Đảo phiếu trả do kiểm thử');
    await page.getByTestId('supplier-return-reverse-confirm').click();
""",
)

e2e_path = 'npp-core/web/e2e/supplier-returns.spec.ts'
e2e = read(e2e_path)
if "test('hủy phiếu nháp với lý do bắt buộc'" not in e2e:
    closing = "  });\n});\n"
    if not e2e.endswith(closing):
        raise SystemExit('unexpected supplier return e2e ending')
    extra = """

  test('hủy phiếu nháp với lý do bắt buộc', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const editor = await openReturnEditor(page, fixture.goodsReceipt.documentNumber);
    const line = editor.getByRole('row').filter({ hasText: fixture.goodsReceipt.documentNumber }).first();
    await line.locator('input').nth(0).fill('1');
    await line.locator('input').nth(1).fill('OTHER');
    await line.locator('input').nth(2).fill('Hủy để kiểm thử');
    await editor.getByTestId('supplier-return-save').click();

    const row = page.getByTestId('supplier-returns-table').locator('tbody tr').first();
    await row.getByRole('button', { name: 'Hủy', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Phiếu chưa cấp số' });
    await dialog.locator('input').fill('Không tiếp tục trả hàng');
    await page.getByTestId('supplier-return-cancel-confirm').click();
    await expect(row).toContainText('Đã hủy');
  });

  test('mobile smoke mở được trình tạo phiếu trả', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const editor = await openReturnEditor(page, fixture.goodsReceipt.documentNumber);
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('supplier-return-save')).toBeVisible();
  });
"""
    e2e = e2e[:-len(closing)] + "  });" + extra + "\n});\n"
    write(e2e_path, e2e)

# Exact canonical movement assertion and a separate draft-nonblocking regression.
api_test = 'npp-core/api/test/supplier-return.test.js'
replace_once(
    api_test,
    """    assert.equal(postedReturn.status, 'posted');
    assert.match(postedReturn.documentNumber, /^SR-202607-\\d{6}$/);

    const balanceAfterPost = await pool.query(
""",
    """    assert.equal(postedReturn.status, 'posted');
    assert.match(postedReturn.documentNumber, /^SR-202607-\\d{6}$/);
    const postedMovement = await pool.query(
      `SELECT movement_type, direction
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, postedReturn.inventoryMovementId],
    );
    assert.equal(postedMovement.rows[0].movement_type, 'SUPPLIER_RETURN_ISSUE');
    assert.equal(postedMovement.rows[0].direction, 'OUT');

    const balanceAfterPost = await pool.query(
""",
)
api_text = read(api_test)
if "test('draft supplier return does not block receipt reversal" not in api_text:
    api_text += """

test('draft supplier return does not block receipt reversal and cannot submit afterwards', async () => {
  const config = loadConfig(testEnv({ PORT: '3080' }));
  const pool = getPool(config);
  let server;
  try {
    const fixture = await seedFixture(pool, config.installationId);
    await pool.query(
      `UPDATE shared.product_variants
          SET unit_id = CASE WHEN id = $2 THEN $4::uuid ELSE $5::uuid END,
              conversion_to_base = CASE WHEN id = $2 THEN 1 ELSE 12 END,
              updated_at = now()
        WHERE installation_id = $1 AND id IN ($2::uuid, $3::uuid)`,
      [
        config.installationId,
        fixture.baseVariantId,
        fixture.cartonVariantId,
        fixture.unitId,
        fixture.cartonUnitId,
      ],
    );
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const purchaseOrder = await createApprovedPurchaseOrder(baseUrl, config, fixture);
    const goodsReceipt = await createPostedGoodsReceipt(baseUrl, config, fixture, purchaseOrder);
    const sourceResponse = await fetch(
      `${baseUrl}/api/supplier-returns/source-lines?goodsReceiptId=${goodsReceipt.id}`,
      { headers: readHeaders(config) },
    );
    assert.equal(sourceResponse.status, 200);
    const sourceLines = await data(sourceResponse);

    const createResponse = await fetch(`${baseUrl}/api/supplier-returns`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-draft-create-${randomUUID()}`),
      body: JSON.stringify({
        supplierId: fixture.supplierId,
        warehouseId: fixture.warehouseId,
        returnDate: '2026-07-29',
        lines: [{
          sourceGoodsReceiptLineId: sourceLines[0].sourceGoodsReceiptLineId,
          returnQuantity: '1',
          reasonCode: 'OTHER',
          reasonNote: 'Draft concurrency regression',
        }],
      }),
    });
    assert.equal(createResponse.status, 201);
    const draftReturn = await data(createResponse);

    const reverseResponse = await fetch(`${baseUrl}/api/goods-receipts/${goodsReceipt.id}/reverse`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-draft-gr-reverse-${randomUUID()}`),
      body: JSON.stringify({
        expectedRevision: goodsReceipt.revision,
        documentDate: '2026-07-29',
        reasonNote: 'Draft return must not block',
      }),
    });
    assert.equal(reverseResponse.status, 200);

    const submitResponse = await fetch(`${baseUrl}/api/supplier-returns/${draftReturn.id}/submit`, {
      method: 'POST',
      headers: mutationHeaders(config, `sr-draft-submit-${randomUUID()}`),
      body: JSON.stringify({ expectedRevision: draftReturn.revision }),
    });
    assert.equal(submitResponse.status, 409);
    assert.equal(await errorCode(submitResponse), 'SOURCE_RECEIPT_NOT_POSTED');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
"""
    write(api_test, api_text)

replace_once(
    'docs/operations/phase-5-4-supplier-return-decisions.md',
    '- Modal post/reverse phải cho phép đi tiếp với giá trị mặc định khi người dùng không nhập ghi chú lý do.',
    '- Ghi chú post là tùy chọn; modal reverse bắt buộc người dùng nhập lý do không rỗng và không tự tạo fallback.',
)
