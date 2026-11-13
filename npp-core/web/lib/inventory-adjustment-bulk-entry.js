import { INVENTORY_ADJUSTMENT_BULK_MAX_LINES } from '@npp/contracts';

export const MAX_BULK_INVENTORY_ADJUSTMENT_ROWS = INVENTORY_ADJUSTMENT_BULK_MAX_LINES;

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

// Chỉ ánh xạ các tên cột xác định rõ nghĩa; không suy đoán theo nội dung số liệu.
const HEADER_FIELDS = new Map([
  ['sku', 'sku'],
  ['ton thuc te', 'actualQuantity'],
  ['so luong ton thuc te', 'actualQuantity'],
  ['ton tt', 'actualQuantity'],
  ['vi tri', 'locationCode'],
  ['ma vi tri', 'locationCode'],
  ['lo', 'lotCode'],
  ['ma lo', 'lotCode'],
]);

const HEADER_LABELS = {
  sku: 'SKU',
  actualQuantity: 'Tồn thực tế',
  locationCode: 'Vị trí',
  lotCode: 'Lô',
};

function headerField(value) {
  return HEADER_FIELDS.get(normalizeHeader(value)) ?? null;
}

export function parseBulkInventoryAdjustmentSheet(sheet) {
  if (!Array.isArray(sheet) || sheet.length < 2) {
    throw new Error('Tệp cần có dòng tiêu đề và ít nhất một dòng dữ liệu.');
  }
  const headers = sheet[0].map(headerField);
  const firstColumnByField = new Map();
  headers.forEach((field, index) => {
    if (!field) return;
    const firstIndex = firstColumnByField.get(field);
    if (firstIndex !== undefined) {
      throw new Error(`Tệp có hai cột cùng nghĩa ${HEADER_LABELS[field]} (cột ${firstIndex + 1} và ${index + 1}). Chỉ giữ một cột để tránh ghi đè dữ liệu.`);
    }
    firstColumnByField.set(field, index);
  });
  if (!headers.includes('sku') || !headers.includes('actualQuantity')) {
    throw new Error('Tệp cần có hai cột bắt buộc: SKU và Tồn thực tế (có thể ghi Tồn TT).');
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
    throw new Error(`Mỗi lần kiểm tra tối đa ${MAX_BULK_INVENTORY_ADJUSTMENT_ROWS.toLocaleString('vi-VN')} dòng.`);
  }
  return rows;
}

export function bulkInventoryAdjustmentTemplateCsv() {
  return '\uFEFFSKU,Tồn thực tế\n';
}
