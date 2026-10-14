import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/retail-receipt-image.ts', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/retail-lot7.css', import.meta.url), 'utf8');

const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  strict: true,
} }).outputText;
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64');
const { receiptImageFilename } = await import(moduleUrl);

test('Tên ảnh phiếu bám theo số đơn, không chứa ký tự phá tên tệp', () => {
  assert.equal(receiptImageFilename('SO000123'), 'Phieu-ban-hang-SO000123.png');
  assert.equal(receiptImageFilename(null), 'Phieu-ban-hang-don-hang.png');
  assert.equal(receiptImageFilename('../INV:123'), 'Phieu-ban-hang-INV-123.png');
});

test('Chụp nguyên phiếu đang hiển thị, không dựng lại mẫu in thứ hai', () => {
  assert.match(workspace, /ref=\{receiptDocumentRef\} className="print-document"/);
  assert.match(workspace, /captureReceiptPng\(element\)/);
  assert.match(source, /toBlob\(documentElement,/);
  assert.match(source, /backgroundColor: '#ffffff'/);
  assert.match(source, /width,\s*height,\s*pixelRatio/);
});

test('Một nút chia sẻ ở màn xem trước; in hiện có và 2 điểm vào giữ nguyên', () => {
  assert.equal((workspace.match(/aria-label="Chia sẻ phiếu dưới dạng ảnh"/g) ?? []).length, 1);
  assert.match(workspace, /onClick=\{\(\) => void printNow\(\)\}>In<\/button>/);
  assert.match(workspace, /onClick=\{\(\) => void openPrintPreview\(\)\}>In phiếu<\/button>/);
  assert.match(workspace, /onClick=\{\(\) => void printOrderFromHistory\(item.id\)\}/);
  assert.match(workspace, /prepareOrderPrint\(sourceOrder\)/);
  assert.match(styles, /\.print-toolbar \.print-toolbar-actions/);
});

test('Dùng Web Share File PNG trực tiếp trên điện thoại, không chia sẻ PDF hay link', () => {
  assert.match(source, /new File\(\[blob\], receiptImageFilename\(orderNumber\), \{ type: 'image\/png' \}\)/);
  assert.match(source, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(source, /navigator\.share\(\{ files: \[file\], title:/);
  assert.match(source, /error\.name === 'AbortError'/);
  assert.match(source, /anchor\.download = file\.name/);
  assert.match(workspace, /receiptImageKey/);
  assert.match(workspace, /setReceiptImagePending\(true\)/);
});
