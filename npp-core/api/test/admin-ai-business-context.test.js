import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Trợ lý Công Ty lấy cùng Báo cáo Kinh doanh canonical và không tự suy đoán số liệu', async () => {
  const source = await read('src/routes/admin-ai-assistant.js');
  assert.match(source, /salesReport\(/);
  assert.match(source, /DỮ LIỆU KINH DOANH CANONICAL CỦA CÔNG TY/);
  assert.match(source, /Không tự cộng chéo tiền tệ hoặc ĐVT/);
  assert.match(source, /không tự suy đoán số liệu/i);
});
