from pathlib import Path

path = Path('npp-core/api/test/goods-receipt.test.js')
text = path.read_text(encoding='utf-8')
block = """    const reverseResponse = await fetch(`${baseUrl}/api/goods-receipts/${posted.id}/reverse`, {
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
    assert.equal(restoredPo.remainingQuantityTotal, '10.000000');
"""
if text.count(block) != 2:
    raise SystemExit(f'expected 2 duplicate reversal blocks, found {text.count(block)}')
text = text.replace(block + '\n' + block, block, 1)
path.write_text(text, encoding='utf-8', newline='\n')
