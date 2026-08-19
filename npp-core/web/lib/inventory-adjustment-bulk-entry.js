export const MAX_BULK_INVENTORY_ADJUSTMENT_ROWS = 200;

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

function headerField(value) {
  const header = normalizeHeader(value);
  if (header === 'sku') return 'sku';
  if (header === 'ton thuc te' || header === 'so luong ton thuc te') return 'actualQuantity';
  if (header === 'vi tri' || header === 'ma vi tri') return 'locationCode';
  if (header === 'lo' || header === 'ma lo') return 'lotCode';
  return null;
}

export function parseBulkInventoryAdjustmentSheet(sheet) {
  if (!Array.isArray(sheet) || sheet.length < 2) {
    throw new Error('Tệp cần có dòng tiêu đề và ít nhất một dòng dữ liệu.');
  }
  const headers = sheet[0].map(headerField);
  if (!headers.includes('sku') || !headers.includes('actualQuantity')) {
    throw new Error('Tệp cần có hai cột bắt buộc: SKU và Tồn thực tế.');
  }
  const rows = sheet
    .slice(1)
    .map((cells, index) => ({ cells: Array.isArray(cells) ? cells : [], lineNumber: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => String(cell ?? '').trim()))
    .map(({ cells, lineNumber }) => {
      const row = { lineNumber, sku: '', actualQuantity: '', locationCode: '', lotCode: '' };
      headers.forEach((field, index) => {
        if (field) row[field] = String(cells[index] ?? '').trim();
      });
      return row;
    });
  if (rows.length === 0) throw new Error('Tệp chưa có dòng dữ liệu.');
  if (rows.length > MAX_BULK_INVENTORY_ADJUSTMENT_ROWS) {
    throw new Error(`Mỗi lần kiểm tra tối đa ${MAX_BULK_INVENTORY_ADJUSTMENT_ROWS} dòng.`);
  }
  return rows;
}

export function bulkInventoryAdjustmentTemplateCsv() {
  return '\uFEFFSKU,Tồn thực tế,Vị trí,Lô\n';
}