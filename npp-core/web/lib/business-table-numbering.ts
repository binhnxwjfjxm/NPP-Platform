export const BUSINESS_TABLE_SEQUENCE_HEADER = 'STT';

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} phải là số nguyên không âm.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} phải là số nguyên dương.`);
  }
}

/** Số bản ghi đứng trước trang hiện tại. Trang bắt đầu từ 1. */
export function businessTablePageOffset(page: number, pageSize: number): number {
  assertPositiveInteger(page, 'Trang');
  assertPositiveInteger(pageSize, 'Số dòng mỗi trang');
  return (page - 1) * pageSize;
}

/**
 * Số thứ tự của một dòng trong tập kết quả đang hiển thị.
 * rowIndex phải là vị trí sau khi đã lọc/sắp xếp; offset là số dòng của các trang trước.
 */
export function businessTableRowNumber(rowIndex: number, offset = 0): number {
  assertNonNegativeInteger(rowIndex, 'Vị trí dòng');
  assertNonNegativeInteger(offset, 'Số dòng trước trang');
  return offset + rowIndex + 1;
}
